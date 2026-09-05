import { getPublicShare, readShareResponse } from "./public";
export { getPublicShare } from "./public";
import { appDb } from "@/store/storage/storageConfig";
import { signedApiFetch } from "@/lib/api/client";
import { runWithAppDataWriteLock } from "@/lib/data/appRestoreJournal";
import {
  encryptLocalSecret,
  decryptLocalSecret,
  type LocalEncryptedSecretEnvelope,
} from "@/lib/security/localSecrets";
import { randomShareToken, sha256 } from "@/lib/sharing/crypto";
import {
  assertShareSize,
  ShareMutationSchema,
  utf8Bytes,
} from "@/lib/sharing/schema";
import {
  SHARE_LIMITS,
  SHARE_OWNER_HEADER,
  ShareError,
  type PreparedSessionShare,
  type PublicShare,
  type ShareExpiry,
  type ShareMetadata,
  type ShareMutation,
} from "@/lib/sharing/types";

// This prefix is deliberately outside Session, export keys and synced documents.
export const SESSION_SHARE_STORAGE_PREFIX = "private_session_share_v1_";
interface ShareBinding {
  id: string;
  sessionId: string;
  secret?: LocalEncryptedSecretEnvelope;
  metadata?: ShareMetadata;
  deleting?: boolean;
  pending?: {
    operationId: string;
    digest: string;
    expectedRevision: number;
    expiresIn?: ShareExpiry;
  };
}

const queues = new Map<string, Promise<unknown>>();
function shareMetadata(share: PublicShare): ShareMetadata {
  const { id, revision, createdAt, updatedAt, expiresAt } = share;
  return { id, revision, createdAt, updatedAt, expiresAt };
}
function bindingKey(sessionId: string) {
  return `${SESSION_SHARE_STORAGE_PREFIX}${sessionId}`;
}
function secretContext(id: string) {
  return `local:share:${id}:owner`;
}

async function withSessionLock<T>(
  sessionId: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(sessionId) ?? Promise.resolve();
  const task = previous
    .catch(() => undefined)
    .then(() => {
      if (typeof navigator !== "undefined" && navigator.locks?.request)
        return navigator.locks.request(`neo-share:${sessionId}`, action);
      return action();
    });
  queues.set(sessionId, task);
  try {
    return await task;
  } finally {
    if (queues.get(sessionId) === task) queues.delete(sessionId);
  }
}

export async function getSessionShare(
  sessionId: string,
): Promise<ShareMetadata | null> {
  const binding = await appDb.getItem<ShareBinding>(bindingKey(sessionId));
  if (!binding || binding.deleting) return null;
  if (binding.metadata)
    return binding.metadata.expiresAt !== null &&
      binding.metadata.expiresAt <= Date.now()
      ? null
      : binding.metadata;
  try {
    const metadata = shareMetadata(await getPublicShare(binding.id));
    return metadata;
  } catch (error) {
    if (error instanceof ShareError && error.status === 404) return null;
    throw error;
  }
}

export async function publishSessionShare(
  input: PreparedSessionShare & {
    sessionId: string;
    expiresIn?: ShareExpiry;
    signal?: AbortSignal;
  },
): Promise<ShareMetadata> {
  return runWithAppDataWriteLock(() =>
    withSessionLock(input.sessionId, async () => {
      input.signal?.throwIfAborted();
      assertShareSize(input);
      let binding = await appDb.getItem<ShareBinding>(
        bindingKey(input.sessionId),
      );
      if (binding?.deleting)
        throw new ShareError(
          "SHARE_SESSION_DELETED",
          "This conversation is being deleted.",
        );
      if (
        binding?.metadata?.expiresAt &&
        binding.metadata.expiresAt <= Date.now()
      )
        binding = null;
      if (!binding) {
        const id = randomShareToken();
        const token = randomShareToken();
        const secret = await encryptLocalSecret(token, secretContext(id));
        if (!secret)
          throw new ShareError(
            "SHARE_CREDENTIAL_UNAVAILABLE",
            "Could not save the share management credential.",
          );
        binding = { id, sessionId: input.sessionId, secret };
        await appDb.setItem(bindingKey(input.sessionId), binding);
      }
      const token = await decryptLocalSecret(
        binding.secret,
        secretContext(binding.id),
      );
      if (!token)
        throw new ShareError(
          "SHARE_CREDENTIAL_UNAVAILABLE",
          "This browser cannot manage the share.",
        );
      const digest = await sha256(
        JSON.stringify({
          snapshot: input.snapshot,
          assets: input.assets,
          expiresIn: input.expiresIn,
        }),
      );
      if (binding.pending && binding.pending.digest !== digest) {
        try {
          const metadata = shareMetadata(
            await getPublicShare(binding.id, input.signal),
          );
          binding.metadata = metadata;
        } catch (error) {
          if (!(error instanceof ShareError && error.status === 404))
            throw error;
        }
        binding.pending = undefined;
      }
      const pending = binding.pending ?? {
        operationId: randomShareToken(),
        digest,
        expectedRevision: binding.metadata?.revision ?? 0,
        ...(input.expiresIn ? { expiresIn: input.expiresIn } : {}),
      };
      const body: ShareMutation = ShareMutationSchema.parse({
        id: binding.id,
        operationId: pending.operationId,
        expectedRevision: pending.expectedRevision,
        ...(pending.expiresIn ? { expiresIn: pending.expiresIn } : {}),
        snapshot: input.snapshot,
        assets: input.assets,
      });
      const serialized = JSON.stringify(body);
      if (utf8Bytes(serialized) > SHARE_LIMITS.requestBytes)
        throw new ShareError(
          "SHARE_TOO_LARGE",
          "The share exceeds the 4 MiB request limit.",
          413,
        );
      binding.pending = pending;
      await appDb.setItem(bindingKey(input.sessionId), binding);
      try {
        const isCreate = pending.expectedRevision === 0;
        const response = await signedApiFetch(
          isCreate ? "/api/shares" : `/api/shares/${binding.id}`,
          {
            method: isCreate ? "POST" : "PUT",
            headers: {
              "Content-Type": "application/json",
              [SHARE_OWNER_HEADER]: token,
            },
            body: serialized,
            cache: "no-store",
            signal: input.signal,
          },
        );
        const metadata = await readShareResponse<ShareMetadata>(response);
        await appDb.setItem(bindingKey(input.sessionId), {
          ...binding,
          metadata,
          pending: undefined,
        });
        return metadata;
      } catch (error) {
        if (error instanceof ShareError && error.status === 404) {
          // An expired/consumed ID must never be retried as a new publication.
          // The next explicit publish receives a fresh ID and owner credential.
          await appDb.removeItem(bindingKey(input.sessionId));
        }
        if (error instanceof ShareError && error.status === 409) {
          const metadata = shareMetadata(
            await getPublicShare(binding.id, input.signal),
          );
          await appDb.setItem(bindingKey(input.sessionId), {
            ...binding,
            metadata,
            pending: undefined,
          });
        }
        throw error;
      }
    }),
  );
}

async function revoke(sessionId: string, deleting: boolean): Promise<void> {
  return withSessionLock(sessionId, async () => {
    const binding = await appDb.getItem<ShareBinding>(bindingKey(sessionId));
    if (!binding || (binding.deleting && !binding.secret)) return;
    const token = await decryptLocalSecret(
      binding.secret,
      secretContext(binding.id),
    );
    if (!token)
      throw new ShareError(
        "SHARE_CREDENTIAL_UNAVAILABLE",
        "Cannot revoke the share without this browser's management credential.",
      );
    if (deleting)
      await appDb.setItem(bindingKey(sessionId), {
        ...binding,
        deleting: true,
      });
    try {
      await readShareResponse(
        await signedApiFetch(`/api/shares/${binding.id}`, {
          method: "DELETE",
          headers: { [SHARE_OWNER_HEADER]: token },
          cache: "no-store",
        }),
      );
      if (deleting) {
        // Keep a tiny session tombstone so a stale tab cannot publish it again.
        await appDb.setItem(bindingKey(sessionId), {
          id: binding.id,
          sessionId,
          deleting: true,
        });
      } else {
        await appDb.removeItem(bindingKey(sessionId));
      }
    } catch (error) {
      if (deleting) await appDb.setItem(bindingKey(sessionId), binding);
      throw error;
    }
  });
}

export function revokeSessionShare(sessionId: string): Promise<void> {
  return runWithAppDataWriteLock(() => revoke(sessionId, false));
}
export function revokeSessionShareBeforeDelete(
  sessionId: string,
): Promise<void> {
  return revoke(sessionId, true);
}

/** Local deletion failed after revocation; the restored conversation may share again. */
export async function cancelSessionShareDeletion(
  sessionId: string,
): Promise<void> {
  await withSessionLock(sessionId, async () => {
    const binding = await appDb.getItem<ShareBinding>(bindingKey(sessionId));
    if (binding?.deleting && !binding.secret)
      await appDb.removeItem(bindingKey(sessionId));
  });
}

async function revokeBatch(sessionIds: string[]): Promise<string[]> {
  const revoked: string[] = [];
  try {
    for (const sessionId of sessionIds) {
      await revokeSessionShareBeforeDelete(sessionId);
      revoked.push(sessionId);
    }
    return revoked;
  } catch (error) {
    for (const sessionId of revoked)
      await cancelSessionShareDeletion(sessionId);
    throw error;
  }
}

export async function revokeAllSessionSharesBeforeDelete(): Promise<void> {
  const keys = (await appDb.keys()).filter((key) =>
    key.startsWith(SESSION_SHARE_STORAGE_PREFIX),
  );
  await revokeBatch(
    keys.map((key) => key.slice(SESSION_SHARE_STORAGE_PREFIX.length)),
  );
  // Callers hold the exclusive app-data lock. Reset/restore may keep IDs.
  for (const key of keys) await appDb.removeItem(key);
}

export async function revokeSharesMissingFromSessions(
  sessionIds: ReadonlySet<string>,
): Promise<string[]> {
  const keys = (await appDb.keys()).filter((key) =>
    key.startsWith(SESSION_SHARE_STORAGE_PREFIX),
  );
  return revokeBatch(
    keys
      .map((key) => key.slice(SESSION_SHARE_STORAGE_PREFIX.length))
      .filter((sessionId) => !sessionIds.has(sessionId)),
  );
}

/** A failed sync apply restores local sessions; their revoked links stay revoked. */
export async function withSessionSharesRemoved<T>(
  remainingSessionIds: ReadonlySet<string>,
  operation: () => Promise<T>,
): Promise<T> {
  const revoked = await revokeSharesMissingFromSessions(remainingSessionIds);
  try {
    return await operation();
  } catch (error) {
    for (const sessionId of revoked)
      await cancelSessionShareDeletion(sessionId);
    throw error;
  }
}
