import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Collection } from "../types";
import {
  createKnowledgeCollectionAttachment,
  createKnowledgeFileAttachment,
} from "../lib/utils/knowledgeAttachments";
import type { BuiltinToolContext } from "../services/api/chat/builtinTools";

const mocks = vi.hoisted(() => ({
  retrieveKnowledgeSources: vi.fn(),
}));

vi.mock("../lib/knowledge/retrieveKnowledgeSources", () => ({
  retrieveKnowledgeSources: mocks.retrieveKnowledgeSources,
}));

import { createKnowledgeSearchBinding } from "../services/api/chat/builtinTools/knowledgeSearch";

function createContext(
  overrides: Partial<BuiltinToolContext> = {},
): BuiltinToolContext {
  return {
    sessionId: "session-1",
    model: "openai:test-model",
    emit: {},
    knowledgeScope: {
      attachments: [
        createKnowledgeFileAttachment({
          collectionId: "collection-1",
          fileId: "file-1",
          fileName: "one.md",
        }),
        createKnowledgeFileAttachment({
          collectionId: "collection-2",
          fileId: "file-2",
          fileName: "two.md",
        }),
      ],
      collections: [
        { id: "collection-1" },
        { id: "collection-2" },
      ] as Collection[],
      ragConfig: { enabled: false },
    },
    ...overrides,
  };
}

describe("search_knowledge built-in", () => {
  beforeEach(() => {
    mocks.retrieveKnowledgeSources.mockReset();
    mocks.retrieveKnowledgeSources.mockResolvedValue({ sources: [] });
  });

  it("bounds planning queries and passages without charging the research source budget", async () => {
    mocks.retrieveKnowledgeSources.mockResolvedValue({
      sources: Array.from({ length: 10 }, (_, i) => ({
        title: `Note ${i}`,
        content: "Concept",
        url: `knowledge://collection-1/${i}`,
      })),
    });
    const queryBudget = { remainingQueries: 2, maxResultsPerQuery: 5 };
    const binding = createKnowledgeSearchBinding({ queryBudget });
    const result = await binding.execute(
      { query: "unknown concept" },
      createContext(),
    );
    expect((result as { sources: unknown[] }).sources).toHaveLength(5);
    expect(mocks.retrieveKnowledgeSources.mock.calls[0][0].ragConfig.topK).toBe(
      5,
    );
    await binding.execute({ query: "second concept" }, createContext());
    await expect(
      binding.execute({ query: "third concept" }, createContext()),
    ).resolves.toMatchObject({
      error: { code: "RESEARCH_QUERY_BUDGET_EXHAUSTED" },
    });
    expect(mocks.retrieveKnowledgeSources).toHaveBeenCalledTimes(2);
  });

  it("stops an expired planning lookup before reading the knowledge store", async () => {
    const binding = createKnowledgeSearchBinding({
      queryBudget: {
        remainingQueries: 2,
        maxResultsPerQuery: 5,
        deadlineAt: Date.now() - 1,
      },
    });
    await expect(
      binding.execute({ query: "concept" }, createContext()),
    ).resolves.toMatchObject({ error: { code: "RESEARCH_RECON_TIMEOUT" } });
    expect(mocks.retrieveKnowledgeSources).not.toHaveBeenCalled();
  });

  it("intersects collection_ids without widening a file-only scope", async () => {
    const binding = createKnowledgeSearchBinding();

    await binding.execute(
      { query: "release policy", collection_ids: ["collection-1", "hidden"] },
      createContext(),
    );

    expect(mocks.retrieveKnowledgeSources).toHaveBeenCalledTimes(1);
    const options = mocks.retrieveKnowledgeSources.mock.calls[0]?.[0];
    expect(options.scopeAttachments).toHaveLength(1);
    expect(options.scopeAttachments[0]).toMatchObject({
      fileName: "one.md",
    });
  });

  it("rejects collection filters outside the selected scope", async () => {
    const binding = createKnowledgeSearchBinding();

    await expect(
      binding.execute(
        { query: "release policy", collection_ids: ["hidden"] },
        createContext(),
      ),
    ).resolves.toMatchObject({
      error: { code: "KNOWLEDGE_SEARCH_SCOPE_UNAVAILABLE" },
    });
    expect(mocks.retrieveKnowledgeSources).not.toHaveBeenCalled();
  });

  it("bounds results and emits knowledge citations with fallback warnings", async () => {
    const content = "x".repeat(25_000);
    mocks.retrieveKnowledgeSources.mockResolvedValue({
      sources: Array.from({ length: 30 }, (_, index) => ({
        title: `Source ${index}`,
        url: "",
        content,
      })),
      ragError: {
        code: "RAG_VECTOR_FALLBACK",
        message: "Keyword fallback",
      },
    });
    const emit = vi.fn();
    const binding = createKnowledgeSearchBinding();

    const result = await binding.execute(
      { query: "release policy" },
      createContext({ emit: { knowledgeSources: emit } }),
    );

    expect(result).toMatchObject({
      sources: expect.any(Array),
      warning: { code: "RAG_VECTOR_FALLBACK" },
    });
    expect(
      (result as { sources: Array<{ content: string }> }).sources,
    ).toHaveLength(20);
    expect(
      (result as { sources: Array<{ content: string }> }).sources[0]?.content,
    ).toHaveLength(20_000);
    expect(
      (
        result as {
          sources: Array<{
            url: string;
            metadata?: Record<string, unknown>;
          }>;
        }
      ).sources[0],
    ).toMatchObject({
      url: "knowledge://search/release%20policy/1",
      metadata: {
        sourceId: expect.stringMatching(/^source-/),
        retrievalKind: "attachment",
        externalUntrusted: true,
      },
    });
    expect(emit).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ code: "RAG_VECTOR_FALLBACK" }),
    );
  });

  it("caps formal knowledge evidence by the shared Research source budget", async () => {
    mocks.retrieveKnowledgeSources.mockResolvedValue({
      sources: Array.from({ length: 5 }, (_, index) => ({
        title: `Source ${index}`,
        url: `knowledge://collection-1/${index}`,
        content: `Evidence ${index}`,
      })),
    });
    const onSourceBodiesRead = vi.fn();
    const sourceBudget = {
      remainingSourceBodies: 2,
      onSourceBodiesRead,
    };

    const result = (await createKnowledgeSearchBinding({
      sourceBudget,
    }).execute({ query: "release policy" }, createContext())) as {
      sources: unknown[];
    };

    expect(result.sources).toHaveLength(2);
    expect(sourceBudget.remainingSourceBodies).toBe(0);
    expect(onSourceBodiesRead).toHaveBeenCalledWith([
      "knowledge://collection-1/0",
      "knowledge://collection-1/1",
    ]);
  });

  it("reports retrieval failures to the message knowledge channel", async () => {
    mocks.retrieveKnowledgeSources.mockRejectedValue(
      new Error("vector unavailable"),
    );
    const emit = vi.fn();
    const binding = createKnowledgeSearchBinding();

    await expect(
      binding.execute(
        { query: "release policy" },
        createContext({ emit: { knowledgeSources: emit } }),
      ),
    ).resolves.toMatchObject({
      error: {
        code: "KNOWLEDGE_SEARCH_FAILED",
        message: "vector unavailable",
      },
    });
    expect(emit).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ code: "RAG_QUERY_FAILED" }),
    );
  });

  it("shares one request-scoped lexical cache across refined queries", async () => {
    const binding = createKnowledgeSearchBinding();
    const context = createContext({
      knowledgeScope: {
        attachments: [
          createKnowledgeCollectionAttachment({
            collectionId: "collection-1",
            collectionName: "Docs",
          }),
        ],
        collections: [{ id: "collection-1" }] as Collection[],
        ragConfig: { enabled: false },
      },
    });

    await binding.execute({ query: "first query" }, context);
    await binding.execute({ query: "refined query" }, context);

    const firstCache =
      mocks.retrieveKnowledgeSources.mock.calls[0]?.[0].lexicalCache;
    const secondCache =
      mocks.retrieveKnowledgeSources.mock.calls[1]?.[0].lexicalCache;
    expect(firstCache).toBeInstanceOf(Map);
    expect(secondCache).toBe(firstCache);
  });
});
