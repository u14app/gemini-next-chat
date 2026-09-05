import "server-only";
import { safeFetchJson } from "@/lib/security/safeFetch";
import { getSafeUrlPolicy } from "@/lib/security/urlPolicy";
import { isShareStorageAvailable } from "./config";
import { sha256 } from "./crypto";
import {
  assertShareSize,
  ShareMutationSchema,
  SharedConversationSchema,
  utf8Bytes,
} from "./schema";
import {
  SHARE_LIMITS,
  ShareError,
  type PublicShare,
  type ShareAsset,
  type ShareMetadata,
  type ShareMutation,
} from "./types";

// A single hash is the publication boundary: content and all media have one TTL.
// Validate before the first write; never delete the old snapshot before HSET.
export const SHARE_MUTATION_SCRIPT = `
local key, receiptKey, mode, owner, now = KEYS[1], KEYS[2], ARGV[1], ARGV[2], tonumber(ARGV[3])
local receipt = redis.call('GET', receiptKey)
if receipt and string.sub(receipt, 9) ~= owner then return {'forbidden'} end
local old = redis.call('HMGET', key, 'ownerHash', 'state', 'revision', 'createdAt', 'expiresAt', 'operationId', 'digest', 'updatedAt')
if old[1] and old[1] ~= owner then return {'forbidden'} end
if mode == 'revoke' then
  redis.call('SET', receiptKey, 'revoked:' .. owner)
  redis.call('DEL', key)
  return {'revoked'}
end
if receipt and string.sub(receipt, 1, 8) == 'revoked:' then return {'missing'} end
if mode == 'create' and receipt and not old[1] then return {'missing'} end
local op, digest, expected, requestedExpiry = ARGV[4], ARGV[5], tonumber(ARGV[6]), ARGV[7]
if old[2] == 'revoked' then return {'missing'} end
if old[5] and tonumber(old[5]) > 0 and tonumber(old[5]) <= now then return {'missing'} end
if old[6] == op then
  if old[7] ~= digest then return {'conflict'} end
  return {'ok', old[3], old[4], old[5], old[8]}
end
if mode == 'create' and old[1] then return {'conflict'} end
if mode == 'update' and not old[1] then return {'missing'} end
if expected ~= tonumber(old[3] or '0') then return {'conflict'} end
local snapshot, assets = ARGV[8], cjson.decode(ARGV[9])
local revision, createdAt = expected + 1, old[4] or tostring(now)
local expiresAt = old[5] or '0'
if requestedExpiry ~= '' then expiresAt = requestedExpiry end
if tonumber(expiresAt) > 0 and tonumber(expiresAt) <= now then return {'missing'} end
local fields = redis.call('HKEYS', key)
local write = {key, 'ownerHash', owner, 'state', 'active', 'revision', tostring(revision), 'createdAt', createdAt, 'expiresAt', expiresAt, 'updatedAt', tostring(now), 'operationId', op, 'digest', digest, 'snapshot', snapshot}
local keep = {}
for _, asset in ipairs(assets) do
  local field = 'asset:' .. asset.id
  keep[field] = true
  table.insert(write, field)
  table.insert(write, cjson.encode(asset))
end
-- Reserve the ID permanently before storing content. A failed first publish
-- may consume its ID, but a delayed request can never revive an expired URL.
if not receipt then redis.call('SET', receiptKey, 'created:' .. owner) end
if not old[1] then
  redis.call('HSET', key, 'preparing', '1')
  if tonumber(expiresAt) > 0 then redis.call('PEXPIREAT', key, expiresAt) end
end
redis.call('HSET', unpack(write))
redis.call('HDEL', key, 'preparing')
for _, field in ipairs(fields) do
  if string.sub(field, 1, 6) == 'asset:' and not keep[field] then redis.call('HDEL', key, field) end
end
if tonumber(expiresAt) > 0 then redis.call('PEXPIREAT', key, expiresAt) else redis.call('PERSIST', key) end
return {'ok', tostring(revision), createdAt, expiresAt, tostring(now)}
`;

export type ShareRedisCommand = (
  args: (string | number)[],
  maxResponseBytes?: number,
) => Promise<unknown>;

async function redisCommand(
  args: (string | number)[],
  maxResponseBytes = 1024 * 1024,
): Promise<unknown> {
  if (!isShareStorageAvailable())
    throw new ShareError("SHARING_UNAVAILABLE", "Sharing is unavailable.", 503);
  const body = JSON.stringify(args);
  if (utf8Bytes(body) > SHARE_LIMITS.redisRequestBytes)
    throw new ShareError(
      "SHARE_TOO_LARGE",
      "The share exceeds the storage request limit.",
      413,
    );
  try {
    const { response, data } = await safeFetchJson<{
      result?: unknown;
      error?: string;
    }>(
      process.env.UPSTASH_REDIS_REST_URL!.trim().replace(/\/+$/, ""),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN!.trim()}`,
          "Content-Type": "application/json",
        },
        body,
        cache: "no-store",
      },
      {
        policy: getSafeUrlPolicy("sharedStore"),
        timeoutMs: 10_000,
        maxResponseBytes,
      },
    );
    if (!response.ok || data.error || !("result" in data))
      throw new Error("Share storage request failed");
    return data.result;
  } catch (error) {
    if (error instanceof ShareError) throw error;
    throw new ShareError(
      "SHARE_STORAGE_UNAVAILABLE",
      "Share storage is temporarily unavailable. Your previous share has not been replaced.",
      503,
    );
  }
}

function key(id: string) {
  return `neo:share:v1:{${id}}`;
}
function receiptKey(id: string) {
  return `neo:share-receipt:v1:{${id}}`;
}
function missing(): never {
  throw new ShareError(
    "SHARE_NOT_FOUND",
    "This share is unavailable or has expired.",
    404,
  );
}

function metadata(id: string, values: unknown[]): ShareMetadata {
  const [revision, createdAt, expiresAt, updatedAt] = values.map(Number);
  if (
    ![revision, createdAt, expiresAt, updatedAt].every(Number.isSafeInteger) ||
    revision < 1 ||
    createdAt < 0 ||
    updatedAt < 0 ||
    expiresAt < 0
  ) {
    throw new ShareError(
      "SHARE_STORAGE_INVALID",
      "This share could not be read.",
      503,
    );
  }
  return { id, revision, createdAt, updatedAt, expiresAt: expiresAt || null };
}

function assertActive(values: unknown[], now: number) {
  if (
    values[0] !== "active" ||
    (Number(values[2]) > 0 && Number(values[2]) <= now)
  )
    missing();
}

function signatureMatches(bytes: Uint8Array, mime: ShareAsset["mimeType"]) {
  const ascii = (offset: number, text: string) =>
    [...text].every(
      (character, index) => bytes[offset + index] === character.charCodeAt(0),
    );
  if (mime === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => bytes[index] === byte,
    );
  if (mime === "image/jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/gif") return ascii(0, "GIF87a") || ascii(0, "GIF89a");
  if (mime === "image/webp") return ascii(0, "RIFF") && ascii(8, "WEBP");
  return (
    ascii(4, "ftyp") &&
    [8, 12, 16, 20, 24, 28].some(
      (offset) => ascii(offset, "avif") || ascii(offset, "avis"),
    )
  );
}

export function decodeShareAsset(asset: ShareAsset): Uint8Array {
  return Uint8Array.from(atob(asset.data), (character) =>
    character.charCodeAt(0),
  );
}

export function createShareRepository(
  command: ShareRedisCommand = redisCommand,
  clock: () => number = Date.now,
) {
  return {
    async publish(
      input: ShareMutation,
      token: string,
      mode: "create" | "update",
    ): Promise<ShareMetadata> {
      const body = ShareMutationSchema.parse(input);
      assertShareSize(body);
      for (const asset of body.assets) {
        const bytes = decodeShareAsset(asset);
        if (
          !signatureMatches(bytes, asset.mimeType) ||
          (await sha256(bytes)) !== asset.id
        ) {
          throw new ShareError(
            "SHARE_INVALID_IMAGE",
            "The shared image does not match its type or hash.",
          );
        }
      }
      const now = clock();
      const duration = body.expiresIn ?? (mode === "create" ? "1d" : undefined);
      const expiry =
        duration === undefined
          ? ""
          : duration === "forever"
            ? "0"
            : String(
                now + { "1d": 1, "7d": 7, "30d": 30 }[duration] * 86_400_000,
              );
      const result = await command([
        "EVAL",
        SHARE_MUTATION_SCRIPT,
        2,
        key(body.id),
        receiptKey(body.id),
        mode,
        await sha256(token),
        now,
        body.operationId,
        await sha256(JSON.stringify(body)),
        body.expectedRevision,
        expiry,
        JSON.stringify(body.snapshot),
        JSON.stringify(body.assets),
      ]);
      if (!Array.isArray(result))
        throw new ShareError(
          "SHARE_STORAGE_INVALID",
          "Share storage returned an invalid response.",
          503,
        );
      if (result[0] === "missing") missing();
      if (result[0] === "forbidden")
        throw new ShareError(
          "SHARE_FORBIDDEN",
          "This browser cannot manage this share.",
          403,
        );
      if (result[0] === "conflict")
        throw new ShareError(
          "SHARE_CONFLICT",
          "The share changed. Refresh its state and try again.",
          409,
        );
      if (result[0] !== "ok")
        throw new ShareError(
          "SHARE_STORAGE_INVALID",
          "Share storage returned an invalid response.",
          503,
        );
      return metadata(body.id, result.slice(1));
    },
    async get(id: string): Promise<PublicShare> {
      const result = await command(
        [
          "HMGET",
          key(id),
          "state",
          "revision",
          "expiresAt",
          "snapshot",
          "createdAt",
          "updatedAt",
        ],
        2 * 1024 * 1024,
      );
      if (!Array.isArray(result)) missing();
      assertActive(result, clock());
      if (typeof result[3] !== "string") missing();
      const snapshot = SharedConversationSchema.parse(JSON.parse(result[3]));
      return {
        ...metadata(id, [result[1], result[4], result[2], result[5]]),
        snapshot,
      };
    },
    async getAsset(
      id: string,
      assetId: string,
      revision: number,
    ): Promise<ShareAsset> {
      const result = await command([
        "HMGET",
        key(id),
        "state",
        "revision",
        "expiresAt",
        `asset:${assetId}`,
      ]);
      if (!Array.isArray(result)) missing();
      assertActive(result, clock());
      if (Number(result[1]) !== revision)
        throw new ShareError(
          "SHARE_CHANGED",
          "This share was updated. Refresh to view it.",
          409,
        );
      if (typeof result[3] !== "string") missing();
      const { ShareAssetSchema } = await import("./schema");
      return ShareAssetSchema.parse(JSON.parse(result[3]));
    },
    async revoke(id: string, token: string): Promise<void> {
      const result = await command([
        "EVAL",
        SHARE_MUTATION_SCRIPT,
        2,
        key(id),
        receiptKey(id),
        "revoke",
        await sha256(token),
        clock(),
      ]);
      if (!Array.isArray(result) || result[0] !== "revoked")
        throw new ShareError(
          "SHARE_FORBIDDEN",
          "This browser cannot revoke this share.",
          403,
        );
    },
  };
}

export const shareRepository = createShareRepository();
