import { describe, expect, it, vi } from "vitest";
import {
  applyLocalPayload,
  collectSyncConflicts,
  createSyncDocument,
  deriveAutomergeActorId,
  loadAutomerge,
  loadSyncDocument,
  mergeSyncDocuments,
  readSyncDocumentPayload,
  saveSyncDocument,
} from "@/lib/sync/crdt";

const ACTOR_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACTOR_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("sync CRDT documents", () => {
  it("initializes embedded WASM without fetching the default asset URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const api = await loadAutomerge();

      expect(api.isWasmInitialized()).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("converges concurrent entity additions without last-write-wins loss", async () => {
    const original = await createSyncDocument(
      "settings",
      "settings",
      { items: [{ id: "base", label: "Base" }], tone: "neutral" },
      ACTOR_A,
    );
    const bytes = await saveSyncDocument(original);
    const leftBase = await loadSyncDocument(bytes, ACTOR_B);
    const rightBase = await loadSyncDocument(bytes, ACTOR_C);
    const left = await applyLocalPayload(leftBase, {
      items: [
        { id: "base", label: "Base" },
        { id: "left", label: "Left" },
      ],
      tone: "neutral",
    });
    const right = await applyLocalPayload(rightBase, {
      items: [
        { id: "base", label: "Base" },
        { id: "right", label: "Right" },
      ],
      tone: "neutral",
    });

    const merged = await mergeSyncDocuments(left, right);
    const payload = readSyncDocumentPayload(merged) as {
      items: Array<{ id: string }>;
    };
    expect(payload.items.map((item) => item.id).sort()).toEqual([
      "base",
      "left",
      "right",
    ]);
  });

  it("surfaces concurrent scalar assignments for explicit resolution", async () => {
    const original = await createSyncDocument(
      "core-settings",
      "core-settings",
      { theme: "system" },
      ACTOR_A,
    );
    const bytes = await saveSyncDocument(original);
    const light = await applyLocalPayload(
      await loadSyncDocument(bytes, ACTOR_B),
      { theme: "light" },
    );
    const dark = await applyLocalPayload(
      await loadSyncDocument(bytes, ACTOR_C),
      { theme: "dark" },
    );
    const merged = await mergeSyncDocuments(light, dark);
    const conflicts = await collectSyncConflicts(merged);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].documentId).toBe("core-settings");
    expect(conflicts[0].values.sort()).toEqual(["dark", "light"]);
  });

  it("derives distinct collision-resistant actors from the complete device ID", async () => {
    const zActor = await deriveAutomergeActorId("zzzz");
    const yActor = await deriveAutomergeActorId("yyyy");

    expect(zActor).toMatch(/^[0-9a-f]{64}$/);
    expect(yActor).toMatch(/^[0-9a-f]{64}$/);
    expect(zActor).not.toBe(yActor);
    expect(zActor).not.toMatch(/^0+$/);
    expect(yActor).not.toMatch(/^0+$/);

    const original = await createSyncDocument(
      "actor-compatibility",
      "settings",
      { devices: [] },
      "legacy-device",
    );
    const bytes = await saveSyncDocument(original);
    const left = await applyLocalPayload(
      await loadSyncDocument(bytes, "zzzz"),
      { devices: [{ id: "z" }] },
    );
    const right = await applyLocalPayload(
      await loadSyncDocument(bytes, "yyyy"),
      { devices: [{ id: "y" }] },
    );
    const merged = readSyncDocumentPayload(
      await mergeSyncDocuments(left, right),
    ) as { devices: Array<{ id: string }> };

    expect(merged.devices.map((device) => device.id).sort()).toEqual([
      "y",
      "z",
    ]);
  });

  it("keeps concurrent root and child messages reachable in the message tree", async () => {
    const parentNode = {
      id: "parent",
      message: {
        id: "parent",
        role: "user",
        content: "parent",
        timestamp: 1,
      },
      childMessageIds: [] as string[],
    };
    const original = await createSyncDocument(
      "session-messages:tree",
      "session-messages",
      {
        nodesById: { parent: parentNode },
        rootMessageIds: ["parent"],
        activeRootMessageId: "parent",
      },
      ACTOR_A,
    );
    const bytes = await saveSyncDocument(original);

    const makeBranch = async (actor: string, rootId: string, childId: string) =>
      applyLocalPayload(await loadSyncDocument(bytes, actor), {
        nodesById: {
          parent: {
            ...parentNode,
            childMessageIds: [childId],
            activeChildMessageId: childId,
          },
          [rootId]: {
            id: rootId,
            message: {
              id: rootId,
              role: "user",
              content: rootId,
              timestamp: 2,
            },
            childMessageIds: [],
          },
          [childId]: {
            id: childId,
            message: {
              id: childId,
              role: "model",
              content: childId,
              timestamp: 3,
            },
            parentMessageId: "parent",
            childMessageIds: [],
          },
        },
        rootMessageIds: ["parent", rootId],
        activeRootMessageId: rootId,
      });

    const merged = readSyncDocumentPayload(
      await mergeSyncDocuments(
        await makeBranch(ACTOR_B, "root-left", "child-left"),
        await makeBranch(ACTOR_C, "root-right", "child-right"),
      ),
    ) as {
      nodesById: Record<
        string,
        { childMessageIds: string[]; parentMessageId?: string }
      >;
      rootMessageIds: string[];
    };

    expect([...merged.rootMessageIds].sort()).toEqual([
      "parent",
      "root-left",
      "root-right",
    ]);
    expect([...merged.nodesById.parent.childMessageIds].sort()).toEqual([
      "child-left",
      "child-right",
    ]);
    for (const id of [
      ...merged.rootMessageIds,
      ...merged.nodesById.parent.childMessageIds,
    ]) {
      expect(merged.nodesById[id]).toBeDefined();
    }
  });
});
