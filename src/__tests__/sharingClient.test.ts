import { beforeEach, describe, expect, it, vi } from "vitest";
const { records, send } = vi.hoisted(() => ({
  records: new Map<string, unknown>(),
  send: vi.fn(),
}));
vi.mock("@/store/storage/storageConfig", () => ({
  appDb: {
    getItem: vi.fn(async (key: string) => records.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: unknown) => {
      records.set(key, structuredClone(value));
      return value;
    }),
    removeItem: vi.fn(async (key: string) => {
      records.delete(key);
    }),
    keys: vi.fn(async () => [...records.keys()]),
  },
}));
vi.mock("@/lib/api/client", () => ({ signedApiFetch: send }));
vi.mock("@/lib/data/appRestoreJournal", () => ({
  runWithAppDataWriteLock: (action: () => Promise<unknown>) => action(),
}));
import {
  getSessionShare,
  cancelSessionShareDeletion,
  publishSessionShare,
  revokeSessionShare,
  revokeSessionShareBeforeDelete,
  revokeAllSessionSharesBeforeDelete,
  withSessionSharesRemoved,
  SESSION_SHARE_STORAGE_PREFIX,
} from "@/services/sharing/client";
import type { PreparedSessionShare } from "@/lib/sharing/types";

const prepared: PreparedSessionShare = {
  snapshot: {
    schemaVersion: 1,
    title: "Example",
    createdAt: 1,
    messages: [
      {
        id: "m",
        role: "user",
        timestamp: 1,
        blocks: [{ type: "text", content: "Hi" }],
      },
    ],
  },
  assets: [],
};
const metadata = (id: string, revision = 1) => ({
  id,
  revision,
  createdAt: 1,
  updatedAt: 1,
  expiresAt: null,
});

beforeEach(() => {
  records.clear();
  send.mockReset();
  vi.unstubAllGlobals();
});

describe("private session share lifecycle", () => {
  it("releases an expired pending ID and uses a new link on the next explicit publish", async () => {
    send.mockRejectedValueOnce(new TypeError("response lost"));
    await expect(
      publishSessionShare({ sessionId: "s", ...prepared }),
    ).rejects.toThrow();
    const oldId = JSON.parse(send.mock.calls[0][1].body).id;
    send.mockResolvedValueOnce(
      Response.json(
        { error: "Expired", code: "SHARE_NOT_FOUND" },
        { status: 404 },
      ),
    );
    await expect(
      publishSessionShare({ sessionId: "s", ...prepared }),
    ).rejects.toMatchObject({ status: 404 });
    expect(records.size).toBe(0);
    send.mockImplementationOnce(async (_url, options) =>
      Response.json(metadata(JSON.parse(options.body).id)),
    );
    expect(
      (await publishSessionShare({ sessionId: "s", ...prepared })).id,
    ).not.toBe(oldId);
  });

  it("unblocks already-revoked live sessions when a later batch revocation fails", async () => {
    send.mockImplementation(async (_url, options) =>
      Response.json(metadata(JSON.parse(options.body).id)),
    );
    const first = await publishSessionShare({ sessionId: "a", ...prepared });
    await publishSessionShare({ sessionId: "b", ...prepared });
    send.mockResolvedValueOnce(Response.json({ revoked: true }));
    send.mockRejectedValueOnce(new TypeError("second revoke offline"));
    await expect(revokeAllSessionSharesBeforeDelete()).rejects.toThrow(
      "second revoke offline",
    );
    expect(records.has(`${SESSION_SHARE_STORAGE_PREFIX}a`)).toBe(false);
    expect(records.get(`${SESSION_SHARE_STORAGE_PREFIX}b`)).toHaveProperty(
      "secret",
    );
    expect(
      (await publishSessionShare({ sessionId: "a", ...prepared })).id,
    ).not.toBe(first.id);
  });

  it("unblocks a restored local session if sync application rolls back after revocation", async () => {
    send.mockImplementation(async (_url, options) =>
      options.method === "DELETE"
        ? Response.json({ revoked: true })
        : Response.json(metadata(JSON.parse(options.body).id)),
    );
    const first = await publishSessionShare({ sessionId: "a", ...prepared });
    await expect(
      withSessionSharesRemoved(new Set(), async () => {
        throw new Error("sync journal rollback");
      }),
    ).rejects.toThrow("sync journal rollback");
    expect(records.has(`${SESSION_SHARE_STORAGE_PREFIX}a`)).toBe(false);
    expect(
      (await publishSessionShare({ sessionId: "a", ...prepared })).id,
    ).not.toBe(first.id);
  });
  it("saves the management credential before publishing but never exposes it from the public interface", async () => {
    send.mockImplementation(async (_url, options) => {
      const binding = records.get(`${SESSION_SHARE_STORAGE_PREFIX}s`) as {
        secret: { ciphertext: string };
        id: string;
      };
      expect(binding.secret.ciphertext).toBeTruthy();
      expect(JSON.stringify(binding)).not.toContain(
        options.headers["x-neo-share-owner"],
      );
      return Response.json(metadata(binding.id));
    });
    const result = await publishSessionShare({ sessionId: "s", ...prepared });
    expect(await getSessionShare("s")).toEqual(result);
    expect(Object.keys(result)).not.toContain("secret");
  });

  it("retries an unknown create result with the same id and operation", async () => {
    send.mockRejectedValueOnce(new TypeError("network unavailable"));
    await expect(
      publishSessionShare({ sessionId: "s", ...prepared }),
    ).rejects.toThrow();
    send.mockImplementationOnce(async (_url, options) =>
      Response.json(metadata(JSON.parse(options.body).id)),
    );
    await publishSessionShare({ sessionId: "s", ...prepared });
    expect(send.mock.calls[1][1].body).toBe(send.mock.calls[0][1].body);
  });

  it("uses the original link and revision on manual content update", async () => {
    send.mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      return Response.json(metadata(body.id, body.expectedRevision + 1));
    });
    const first = await publishSessionShare({ sessionId: "s", ...prepared });
    const second = await publishSessionShare({ sessionId: "s", ...prepared });
    expect(second.id).toBe(first.id);
    expect(second.revision).toBe(2);
    expect(send.mock.calls[1][1].method).toBe("PUT");
    expect(JSON.parse(send.mock.calls[1][1].body).expiresIn).toBeUndefined();
  });

  it("preserves the binding and prevents local deletion when revocation fails", async () => {
    send.mockImplementationOnce(async (_url, options) =>
      Response.json(metadata(JSON.parse(options.body).id)),
    );
    await publishSessionShare({ sessionId: "s", ...prepared });
    const before = structuredClone(
      records.get(`${SESSION_SHARE_STORAGE_PREFIX}s`),
    );
    send.mockResolvedValueOnce(
      Response.json(
        { code: "SHARE_STORAGE_UNAVAILABLE", error: "Unavailable" },
        { status: 503 },
      ),
    );
    await expect(revokeSessionShareBeforeDelete("s")).rejects.toMatchObject({
      status: 503,
    });
    expect(records.get(`${SESSION_SHARE_STORAGE_PREFIX}s`)).toEqual(before);
  });

  it("blocks stale tabs from publishing after deletion and revokes only once", async () => {
    send.mockImplementationOnce(async (_url, options) =>
      Response.json(metadata(JSON.parse(options.body).id)),
    );
    await publishSessionShare({ sessionId: "s", ...prepared });
    send.mockResolvedValueOnce(Response.json({ revoked: true }));
    await revokeSessionShareBeforeDelete("s");
    await revokeSessionShareBeforeDelete("s");
    expect(await getSessionShare("s")).toBeNull();
    await expect(
      publishSessionShare({ sessionId: "s", ...prepared }),
    ).rejects.toMatchObject({ code: "SHARE_SESSION_DELETED" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("allows sharing a restored conversation when local deletion failed after revocation", async () => {
    send.mockImplementation(async (_url, options) =>
      options.method === "DELETE"
        ? Response.json({ revoked: true })
        : Response.json(metadata(JSON.parse(options.body).id)),
    );
    const first = await publishSessionShare({ sessionId: "s", ...prepared });
    await revokeSessionShareBeforeDelete("s");
    await cancelSessionShareDeletion("s");
    const next = await publishSessionShare({ sessionId: "s", ...prepared });
    expect(next.id).not.toBe(first.id);
  });

  it("manual revoke allows later creation of a new link", async () => {
    send.mockImplementation(async (_url, options) =>
      options.method === "DELETE"
        ? Response.json({ revoked: true })
        : Response.json(metadata(JSON.parse(options.body).id)),
    );
    const first = await publishSessionShare({ sessionId: "s", ...prepared });
    await revokeSessionShare("s");
    const next = await publishSessionShare({ sessionId: "s", ...prepared });
    expect(next.id).not.toBe(first.id);
  });

  it("bulk clear does not discard bindings when any revoke fails", async () => {
    send.mockImplementation(async (_url, options) =>
      Response.json(metadata(JSON.parse(options.body).id)),
    );
    await publishSessionShare({ sessionId: "s", ...prepared });
    send.mockRejectedValueOnce(new TypeError("offline"));
    await expect(revokeAllSessionSharesBeforeDelete()).rejects.toThrow(
      "offline",
    );
    expect(records.size).toBe(1);
  });
});
