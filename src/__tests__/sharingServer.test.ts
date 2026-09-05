import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/security/safeFetch", () => ({ safeFetchJson: vi.fn() }));
import {
  createShareRepository,
  SHARE_MUTATION_SCRIPT,
} from "@/lib/sharing/server";
import { sha256 } from "@/lib/sharing/crypto";
import { safeFetchJson } from "@/lib/security/safeFetch";
import { SHARE_LIMITS, type ShareMutation } from "@/lib/sharing/types";
import { isPublicShareRead } from "@/lib/sharing/types";
import {
  getApiRateLimitPolicy,
  isApiProofProtectedRoute,
} from "@/lib/security/apiRoutePolicy";

const id = "s".repeat(43);
const token = "t".repeat(43);
const input = (): ShareMutation => ({
  id,
  operationId: "o".repeat(43),
  expectedRevision: 0,
  snapshot: {
    schemaVersion: 1,
    title: "Shared conversation",
    createdAt: 1000,
    messages: [
      {
        id: "message",
        role: "model",
        timestamp: 1000,
        blocks: [{ type: "text", content: "Hello" }],
      },
    ],
  },
  assets: [],
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("share Redis interface", () => {
  it("can revoke stored snapshots through Redis while sharing is disabled", async () => {
    vi.stubEnv("SHARING_ENABLED", "false");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-only-token");
    vi.mocked(safeFetchJson).mockResolvedValue({
      response: new Response(),
      data: { result: ["revoked"] },
      url: "https://redis.example.test",
    });

    await createShareRepository().revoke(id, token);

    expect(safeFetchJson).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(safeFetchJson).mock.calls[0];
    expect(url).toBe("https://redis.example.test");
    expect(JSON.parse(String(init?.body)).slice(3, 7)).toEqual([
      `neo:share:v1:{${id}}`,
      `neo:share-receipt:v1:{${id}}`,
      "revoke",
      await sha256(token),
    ]);
  });

  it("publishes a bounded single-key snapshot with hashed owner and a default one-day expiry", async () => {
    const command = vi
      .fn()
      .mockResolvedValue(["ok", "1", "1000", "86401000", "1000"]);
    const result = await createShareRepository(command, () => 1000).publish(
      input(),
      token,
      "create",
    );
    expect(result).toEqual({
      id,
      revision: 1,
      createdAt: 1000,
      updatedAt: 1000,
      expiresAt: 86401000,
    });
    const args = command.mock.calls[0][0];
    expect(args.slice(0, 5)).toEqual([
      "EVAL",
      SHARE_MUTATION_SCRIPT,
      2,
      `neo:share:v1:{${id}}`,
      `neo:share-receipt:v1:{${id}}`,
    ]);
    expect(args[6]).toBe(await sha256(token));
    expect(args[11]).toBe("86401000");
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it.each([
    ["7d", 7],
    ["30d", 30],
    ["forever", 0],
  ] as const)("supports %s expiry", async (expiresIn, days) => {
    const command = vi
      .fn()
      .mockResolvedValue([
        "ok",
        "1",
        "1000",
        String(days ? 1000 + days * 86400000 : 0),
        "1000",
      ]);
    await createShareRepository(command, () => 1000).publish(
      { ...input(), expiresIn },
      token,
      "create",
    );
    expect(command.mock.calls[0][0][11]).toBe(
      String(days ? 1000 + days * 86400000 : 0),
    );
  });

  it("keeps expiry when updating and passes the expected revision", async () => {
    const command = vi
      .fn()
      .mockResolvedValue(["ok", "3", "1000", "9000", "2000"]);
    await createShareRepository(command, () => 2000).publish(
      { ...input(), expectedRevision: 2 },
      token,
      "update",
    );
    expect(command.mock.calls[0][0].slice(10, 12)).toEqual([2, ""]);
  });

  it("rejects secret-bearing fields before sending any data to Redis", async () => {
    const command = vi.fn();
    const unsafe = input();
    Object.assign(unsafe.snapshot.messages[0], {
      toolCalls: [{ auth: { value: "secret" } }],
    });
    await expect(
      createShareRepository(command).publish(unsafe, token, "create"),
    ).rejects.toThrow();
    expect(command).not.toHaveBeenCalled();
  });

  it("counts UTF-8 bytes rather than characters", async () => {
    const command = vi.fn();
    const oversized = input();
    oversized.snapshot.messages[0].blocks = [
      {
        type: "text",
        content: "中".repeat(Math.ceil(SHARE_LIMITS.snapshotBytes / 3)),
      },
    ];
    await expect(
      createShareRepository(command).publish(oversized, token, "create"),
    ).rejects.toMatchObject({ status: 413 });
    expect(command).not.toHaveBeenCalled();
  });

  it("validates image bytes, MIME and digest before publication", async () => {
    const command = vi.fn();
    const body = input();
    body.assets = [
      { id: "a".repeat(64), mimeType: "image/png", data: btoa("not a PNG") },
    ];
    await expect(
      createShareRepository(command).publish(body, token, "create"),
    ).rejects.toMatchObject({ code: "SHARE_INVALID_IMAGE" });
    expect(command).not.toHaveBeenCalled();
  });

  it.each(["missing", "forbidden", "conflict"])(
    "fails closed on %s mutation",
    async (status) => {
      const command = vi.fn().mockResolvedValue([status]);
      await expect(
        createShareRepository(command).publish(input(), token, "create"),
      ).rejects.toMatchObject({
        status: { missing: 404, forbidden: 403, conflict: 409 }[status],
      });
    },
  );

  it("reads control fields and snapshot together without the owner credential", async () => {
    const command = vi
      .fn()
      .mockResolvedValue([
        "active",
        "2",
        "9000",
        JSON.stringify(input().snapshot),
        "1000",
        "2000",
      ]);
    const result = await createShareRepository(command, () => 3000).get(id);
    expect(result.revision).toBe(2);
    expect(command.mock.calls[0][0]).toEqual([
      "HMGET",
      `neo:share:v1:{${id}}`,
      "state",
      "revision",
      "expiresAt",
      "snapshot",
      "createdAt",
      "updatedAt",
    ]);
    expect(JSON.stringify(result)).not.toContain("owner");
  });

  it.each([
    ["revoked", "2", "9000"],
    ["active", "2", "3000"],
    [null, null, null],
  ])("does not serve revoked, expired or absent content", async (...values) => {
    const command = vi
      .fn()
      .mockResolvedValue([
        ...values,
        JSON.stringify(input().snapshot),
        "1000",
        "2000",
      ]);
    await expect(
      createShareRepository(command, () => 3000).get(id),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("does not mix an old page revision with new images", async () => {
    const command = vi.fn().mockResolvedValue(["active", "3", "0", "{}"]);
    await expect(
      createShareRepository(command).getAsset(id, "a".repeat(64), 2),
    ).rejects.toMatchObject({ code: "SHARE_CHANGED", status: 409 });
    expect(command).toHaveBeenCalledTimes(1);
  });

  it("keeps revocation and conditional update in the same atomic script without delete-before-write", () => {
    expect(
      SHARE_MUTATION_SCRIPT.slice(
        SHARE_MUTATION_SCRIPT.indexOf("local op, digest"),
      ),
    ).not.toContain("redis.call('DEL'");
    expect(SHARE_MUTATION_SCRIPT.indexOf("old[2] == 'revoked'")).toBeLessThan(
      SHARE_MUTATION_SCRIPT.indexOf("redis.call('HSET', unpack(write))"),
    );
    expect(SHARE_MUTATION_SCRIPT.indexOf("expected ~= tonumber")).toBeLessThan(
      SHARE_MUTATION_SCRIPT.indexOf("redis.call('HSET', unpack(write))"),
    );
  });
});

describe("share route protection", () => {
  it("exempts only exact public reads and preserves protected mutations", () => {
    expect(isPublicShareRead(`/api/shares/${id}`, "GET")).toBe(true);
    expect(
      isPublicShareRead(`/api/shares/${id}/assets/${"a".repeat(64)}`, "GET"),
    ).toBe(true);
    for (const method of ["POST", "PUT", "DELETE"]) {
      expect(isPublicShareRead(`/api/shares/${id}`, method)).toBe(false);
      expect(isApiProofProtectedRoute(`/api/shares/${id}`, method)).toBe(true);
    }
    expect(isPublicShareRead(`/api/shares/${id}/owner`, "GET")).toBe(false);
    expect(getApiRateLimitPolicy(`/api/shares/${id}`, "GET")).not.toBeNull();
  });
});

describe("expired share IDs remain consumed", () => {
  function fixture() {
    let now = 1000;
    type Stored = {
      owner: string;
      revision: number;
      createdAt: number;
      updatedAt: number;
      expiresAt: number;
      snapshot: string;
      operationId: string;
      digest: string;
    };
    const content = new Map<string, Stored>();
    const receipts = new Map<string, { owner: string; revoked: boolean }>();
    const command = vi.fn(async (args: (string | number)[]) => {
      // Model Redis actually removing expired content, not merely returning an expired field.
      for (const [key, value] of content)
        if (value.expiresAt && value.expiresAt <= now) content.delete(key);
      if (args[0] === "HMGET") {
        const value = content.get(String(args[1]));
        return value
          ? [
              "active",
              value.revision,
              value.expiresAt,
              value.snapshot,
              value.createdAt,
              value.updatedAt,
            ]
          : [null, null, null, null, null, null];
      }
      expect(args[2]).toBe(2);
      const [
        ,
        ,
        ,
        keyValue,
        receiptValue,
        mode,
        ownerValue,
        ,
        operationValue,
        digestValue,
        expectedValue,
        expiryValue,
        snapshotValue,
      ] = args;
      const key = String(keyValue),
        receiptKey = String(receiptValue),
        owner = String(ownerValue);
      const receipt = receipts.get(receiptKey);
      const old = content.get(key);
      if (receipt && receipt.owner !== owner) return ["forbidden"];
      if (mode === "revoke") {
        receipts.set(receiptKey, { owner, revoked: true });
        content.delete(key);
        return ["revoked"];
      }
      if (
        receipt?.revoked ||
        (mode === "create" && receipt && !old) ||
        (mode === "update" && !old)
      )
        return ["missing"];
      if (old?.operationId === operationValue)
        return old.digest === digestValue
          ? ["ok", old.revision, old.createdAt, old.expiresAt, old.updatedAt]
          : ["conflict"];
      if (
        (old && mode === "create") ||
        Number(expectedValue) !== (old?.revision ?? 0)
      )
        return ["conflict"];
      receipts.set(receiptKey, { owner, revoked: false });
      const value: Stored = {
        owner,
        revision: Number(expectedValue) + 1,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
        expiresAt:
          expiryValue === "" ? (old?.expiresAt ?? 0) : Number(expiryValue),
        snapshot: String(snapshotValue),
        operationId: String(operationValue),
        digest: String(digestValue),
      };
      content.set(key, value);
      return [
        "ok",
        value.revision,
        value.createdAt,
        value.expiresAt,
        value.updatedAt,
      ];
    });
    return {
      repository: createShareRepository(command, () => now),
      content,
      receipts,
      advance: (time: number) => {
        now = time;
      },
    };
  }

  it("rejects a delayed lost-response create after Redis deletes the expiring content hash", async () => {
    const f = fixture();
    await f.repository.publish(input(), token, "create");
    f.advance(1000 + 86400000);
    await expect(f.repository.get(id)).rejects.toMatchObject({ status: 404 });
    expect(f.content.size).toBe(0);
    expect(f.receipts.size).toBe(1);
    await expect(
      f.repository.publish(input(), token, "create"),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.content.size).toBe(0);
  });

  it("retains revocation after the former finite lifetime ends", async () => {
    const f = fixture();
    await f.repository.publish(input(), token, "create");
    await f.repository.revoke(id, token);
    f.advance(1000 + 86400000 * 40);
    await expect(
      f.repository.publish(input(), token, "create"),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.content.size).toBe(0);
    expect([...f.receipts.values()][0].revoked).toBe(true);
  });

  it("sets initial expiry before writing publicly readable finite content", () => {
    const start = SHARE_MUTATION_SCRIPT.indexOf("if not old[1] then");
    const expiry = SHARE_MUTATION_SCRIPT.indexOf(
      "redis.call('PEXPIREAT'",
      start,
    );
    const publication = SHARE_MUTATION_SCRIPT.indexOf(
      "redis.call('HSET', unpack(write))",
    );
    expect(expiry).toBeGreaterThan(start);
    expect(expiry).toBeLessThan(publication);
    expect(SHARE_MUTATION_SCRIPT).not.toContain("PEXPIREAT', receiptKey");
  });
});
