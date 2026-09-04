import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createResearchExtensionRepository,
  setResearchExtensionRepositoryForTests,
} from "@/services/research/extensionRepository";
import {
  freezeResearchSourceContracts,
  assertFrozenResearchSourceContracts,
  getFrozenResearchSourceContracts,
} from "@/lib/plugin/researchSources/contracts";
import { RESEARCH_SOURCE_PLUGINS } from "@/lib/plugin/researchSources/catalog";
import type {
  ResearchSourceSnapshot,
  ResearchTask,
} from "@/lib/research/types";
const snapshot = {
  pluginIds: ["arxiv"],
  toolIds: ["search_arxiv", "read_arxiv"],
} as ResearchSourceSnapshot;
const task = {
  id: "task",
  sessionId: "session",
  status: "plan_ready",
} as ResearchTask;
const providers = () => structuredClone(RESEARCH_SOURCE_PLUGINS);
beforeEach(() => {
  setResearchExtensionRepositoryForTests(
    createResearchExtensionRepository({ indexedDb: new IDBFactory() }),
  );
});
afterEach(() => {
  setResearchExtensionRepositoryForTests(undefined);
});

describe("frozen specialized source contracts", () => {
  it("detects schema changes and excludes credential configuration", async () => {
    const plugins = providers();
    await freezeResearchSourceContracts(task, snapshot, plugins, {
      arxiv: { auth: { type: "bearer", value: "private" } },
    });
    expect(
      JSON.stringify(await getFrozenResearchSourceContracts(task.id, snapshot)),
    ).not.toContain("private");
    await expect(
      assertFrozenResearchSourceContracts(task.id, snapshot, plugins),
    ).resolves.toBeUndefined();
    plugins[0].functions[0].parameters = {
      type: "object",
      properties: { changed: { type: "string" } },
    };
    await expect(
      assertFrozenResearchSourceContracts(task.id, snapshot, plugins),
    ).rejects.toThrow(/changed/);
  });
  it("does not replace an approved function when expansion refreshes settings", async () => {
    const plugins = providers();
    await freezeResearchSourceContracts(task, snapshot, plugins, {});
    const old = await getFrozenResearchSourceContracts(task.id, snapshot);
    plugins[0].functions[0].parameters = {
      type: "object",
      properties: { changed: { type: "string" } },
    };
    await freezeResearchSourceContracts(
      { ...task, status: "researching" },
      {
        ...snapshot,
        pluginIds: ["arxiv", "pubmed"],
        toolIds: [...snapshot.toolIds, "search_pubmed"],
      },
      plugins,
      {},
    );
    expect(
      (await getFrozenResearchSourceContracts(task.id, snapshot)).search_arxiv,
    ).toEqual(old.search_arxiv);
    await expect(
      assertFrozenResearchSourceContracts(task.id, snapshot, plugins),
    ).rejects.toThrow(/changed/);
  });
  it("denies missing snapshot and revoked functions", async () => {
    await expect(
      getFrozenResearchSourceContracts(task.id, snapshot),
    ).rejects.toThrow(/missing/);
    await freezeResearchSourceContracts(task, snapshot, providers(), {});
    await expect(
      assertFrozenResearchSourceContracts(task.id, snapshot, []),
    ).rejects.toThrow(/changed/);
  });
  it("requires durable storage only when specialized providers are selected", async () => {
    setResearchExtensionRepositoryForTests(
      createResearchExtensionRepository({ indexedDb: null }),
    );
    await expect(
      freezeResearchSourceContracts(
        task,
        { ...snapshot, pluginIds: [] },
        providers(),
        {},
      ),
    ).resolves.toBeUndefined();
    await expect(
      freezeResearchSourceContracts(task, snapshot, providers(), {}),
    ).rejects.toThrow(/persistent/);
  });
});
