import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_INPUT_LIMITS } from "../config/limits";
import { CHAT_INPUT_TRUNCATION_NOTICE } from "../lib/utils/chatInput";

const mocks = vi.hoisted(() => ({
  resolveOPFSUrl: vi.fn(),
  generateRAGSearchQueries: vi.fn(),
  queryRAG: vi.fn(),
}));

vi.mock("../utils/opfs", () => ({
  resolveOPFSUrl: mocks.resolveOPFSUrl,
}));

vi.mock("../services/api/chatService", () => ({
  generateRAGSearchQueries: mocks.generateRAGSearchQueries,
}));

vi.mock("../services/api/ragService", () => ({
  queryRAG: mocks.queryRAG,
}));

import { processMessageForSending } from "../lib/chat/messageProcessor";
import {
  createKnowledgeCollectionAttachment,
  createKnowledgeFileAttachment,
} from "../lib/utils/knowledgeAttachments";

const encodeText = (value: string) => btoa(unescape(encodeURIComponent(value)));

describe("message preprocessing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.resolveOPFSUrl.mockReset();
    mocks.generateRAGSearchQueries.mockReset();
    mocks.queryRAG.mockReset();
    mocks.resolveOPFSUrl.mockResolvedValue("blob:http://localhost/kb-file");
    mocks.generateRAGSearchQueries.mockResolvedValue(["knowledge query"]);
    mocks.queryRAG.mockResolvedValue([]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("knowledge file text", { status: 200 }),
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  it("keeps final model text within the chat request limit after context injection", async () => {
    const result = await processMessageForSending({
      text: "u".repeat(API_INPUT_LIMITS.maxChatTextChars - 200),
      attachments: [
        {
          id: "att_1",
          mimeType: "text/plain",
          fileName: "large.txt",
          data: encodeText("c".repeat(10_000)),
        },
      ],
      selectedModel: "provider:model",
      modelMetadata: {
        model: { attachment: false },
      },
      customModelMetadata: {},
      ragConfig: { enabled: false },
      knowledgeCollections: [],
    });

    expect(result.finalText.length).toBeLessThanOrEqual(
      API_INPUT_LIMITS.maxChatTextChars,
    );
    expect(result.finalText.endsWith(CHAT_INPUT_TRUNCATION_NOTICE)).toBe(true);
    expect(result.userMessage.content).toHaveLength(
      API_INPUT_LIMITS.maxChatTextChars - 200,
    );
  });

  it("converts text attachments into prompt context even when the model supports attachments", async () => {
    const result = await processMessageForSending({
      text: "Read this",
      attachments: [
        {
          id: "att_text",
          mimeType: "text/markdown",
          fileName: "brief.md",
          data: encodeText("Project notes"),
        },
      ],
      selectedModel: "provider:model",
      modelMetadata: {
        model: { attachment: true },
      },
      customModelMetadata: {},
      ragConfig: { enabled: false },
      knowledgeCollections: [],
    });

    expect(result.finalAttachments).toEqual([]);
    expect(result.finalText).toContain('name="brief.md"');
    expect(result.finalText).toContain("Project notes");
    expect(result.userMessage.attachments).toHaveLength(1);
  });

  it("keeps workspace knowledge out of the persisted user attachments while using it for context", async () => {
    const result = await processMessageForSending({
      text: "What changed?",
      attachments: [],
      selectedModel: "provider:model",
      modelMetadata: {
        model: { attachment: false },
      },
      customModelMetadata: {},
      ragConfig: { enabled: false },
      knowledgeCollections: [
        {
          id: "collection_1",
          name: "Workspace KB",
          files: [
            {
              id: "file_1",
              name: "notes.md",
              type: "text/plain",
              uploadedAt: 1,
              path: "opfs://kb/notes",
            },
          ],
        },
      ],
      workspaceKnowledgeCollectionIds: ["collection_1"],
    });

    expect(result.userMessage.attachments).toEqual([]);
    expect(result.finalText).toContain("Workspace KB");
  });

  it("deduplicates manual and workspace knowledge sources", async () => {
    const manual = createKnowledgeCollectionAttachment({
      collectionId: "collection_1",
      collectionName: "Manual KB",
    });

    const result = await processMessageForSending({
      text: "Use the docs",
      attachments: [manual],
      selectedModel: "provider:model",
      modelMetadata: {
        model: { attachment: false },
      },
      customModelMetadata: {},
      ragConfig: { enabled: false },
      knowledgeCollections: [
        {
          id: "collection_1",
          name: "Manual KB",
          files: [],
        },
      ],
      workspaceKnowledgeCollectionIds: ["collection_1"],
    });

    expect(
      result.userMessage.attachments?.filter(
        (attachment) =>
          attachment.mimeType === "application/vnd.neo-chat.collection",
      ),
    ).toHaveLength(1);
  });

  it("handles selected knowledge files without treating them as normal attachments", async () => {
    const fileAttachment = createKnowledgeFileAttachment({
      collectionId: "collection_1",
      fileId: "file_1",
      fileName: "notes.md",
    });

    const result = await processMessageForSending({
      text: "Summarize notes",
      attachments: [fileAttachment],
      selectedModel: "provider:model",
      modelMetadata: {
        model: { attachment: false },
      },
      customModelMetadata: {},
      ragConfig: { enabled: false },
      knowledgeCollections: [
        {
          id: "collection_1",
          name: "Manual KB",
          files: [
            {
              id: "file_1",
              name: "notes.md",
              type: "text/plain",
              uploadedAt: 1,
              path: "opfs://kb/notes",
            },
          ],
        },
      ],
    });

    expect(result.userMessage.attachments).toEqual([fileAttachment]);
    expect(result.finalAttachments).toEqual([]);
    expect(result.finalText).toContain("notes.md");
  });

  it("uses RAG retrieval for indexed knowledge file attachments", async () => {
    const controller = new AbortController();
    mocks.queryRAG.mockResolvedValue([
      {
        title: "notes.md",
        url: "#",
        content: "Indexed notes content",
        metadata: { collectionId: "collection_1", fileId: "file_1" },
      },
      {
        title: "other.md",
        url: "#",
        content: "Other file content",
        metadata: { collectionId: "collection_1", fileId: "file_2" },
      },
    ]);

    const fileAttachment = createKnowledgeFileAttachment({
      collectionId: "collection_1",
      fileId: "file_1",
      fileName: "notes.md",
    });

    const result = await processMessageForSending({
      text: "Summarize notes",
      attachments: [fileAttachment],
      selectedModel: "provider:model",
      modelMetadata: {
        model: { attachment: false },
      },
      customModelMetadata: {},
      ragConfig: {
        enabled: true,
        useDefaultVectorStore: true,
        serverVectorStoreAvailable: true,
      },
      knowledgeCollections: [
        {
          id: "collection_1",
          name: "Manual KB",
          files: [
            {
              id: "file_1",
              name: "notes.md",
              type: "text/plain",
              status: "indexed",
              ragId: "file_1",
              ragChunkCount: 1,
              uploadedAt: 1,
              path: "opfs://kb/notes",
            },
          ],
        },
      ],
      signal: controller.signal,
    });

    expect(mocks.generateRAGSearchQueries).toHaveBeenCalledWith(
      "Summarize notes",
      controller.signal,
    );
    expect(mocks.queryRAG).toHaveBeenCalledWith(
      "knowledge query",
      "collection_1",
      controller.signal,
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.finalText).toContain("Indexed notes content");
    expect(result.finalText).not.toContain("Other file content");
    expect(result.ragSources).toHaveLength(1);
  });

  it("keeps selected knowledge local when the chat-level RAG toggle is off", async () => {
    const fileAttachment = createKnowledgeFileAttachment({
      collectionId: "collection_1",
      fileId: "file_1",
      fileName: "notes.md",
    });

    const result = await processMessageForSending({
      text: "Summarize notes",
      attachments: [fileAttachment],
      selectedModel: "provider:model",
      modelMetadata: {
        model: { attachment: false },
      },
      customModelMetadata: {},
      ragConfig: {
        enabled: true,
        useDefaultVectorStore: true,
        serverVectorStoreAvailable: true,
      },
      ragEnabled: false,
      knowledgeCollections: [
        {
          id: "collection_1",
          name: "Manual KB",
          files: [
            {
              id: "file_1",
              name: "notes.md",
              type: "text/plain",
              status: "indexed",
              ragId: "file_1",
              ragChunkCount: 1,
              uploadedAt: 1,
              path: "opfs://kb/notes",
            },
          ],
        },
      ],
    });

    expect(mocks.queryRAG).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalled();
    expect(result.finalText).toContain("knowledge file text");
    expect(result.ragSources).toEqual([]);
  });

  it("defers selected knowledge while preserving ordinary attachment processing", async () => {
    const fileAttachment = createKnowledgeFileAttachment({
      collectionId: "collection_1",
      fileId: "file_1",
      fileName: "notes.md",
    });

    const result = await processMessageForSending({
      text: "Compare these notes",
      attachments: [
        fileAttachment,
        {
          id: "brief",
          mimeType: "text/plain",
          fileName: "brief.txt",
          data: encodeText("ordinary attachment content"),
        },
      ],
      selectedModel: "provider:model",
      modelMetadata: {
        model: { attachment: false },
      },
      customModelMetadata: {},
      ragConfig: {
        enabled: true,
        useDefaultVectorStore: true,
        serverVectorStoreAvailable: true,
      },
      deferKnowledgeRetrieval: true,
      knowledgeCollections: [
        {
          id: "collection_1",
          name: "Manual KB",
          files: [
            {
              id: "file_1",
              name: "notes.md",
              type: "text/plain",
              status: "indexed",
              ragId: "file_1",
              uploadedAt: 1,
              path: "opfs://kb/notes",
            },
          ],
        },
      ],
    });

    expect(mocks.generateRAGSearchQueries).not.toHaveBeenCalled();
    expect(mocks.queryRAG).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.finalText).toContain("ordinary attachment content");
    expect(result.finalText).not.toContain("knowledge file text");
    expect(result.knowledgeScope).toEqual([fileAttachment]);
    expect(result.ragSources).toEqual([]);
  });

  it("defers ordinary attachment reading for Research planning", async () => {
    const attachment = {
      id: "brief",
      mimeType: "text/plain",
      fileName: "brief.txt",
      data: encodeText("must remain unread before approval"),
    };

    const result = await processMessageForSending({
      text: "Prepare a research plan",
      attachments: [attachment],
      selectedModel: "provider:model",
      modelMetadata: { model: { attachment: false } },
      customModelMetadata: {},
      ragConfig: { enabled: false },
      deferKnowledgeRetrieval: true,
      deferAttachmentReading: true,
      knowledgeCollections: [],
    });

    expect(result.finalText).toBe("Prepare a research plan");
    expect(result.finalText).not.toContain("must remain unread");
    expect(result.finalAttachments).toEqual([]);
    expect(result.userMessage.attachments).toEqual([attachment]);
  });

  it("returns a deduplicated workspace knowledge scope when retrieval is deferred", async () => {
    const manual = createKnowledgeCollectionAttachment({
      collectionId: "collection_1",
      collectionName: "Manual KB",
    });

    const result = await processMessageForSending({
      text: "Use the docs",
      attachments: [manual],
      selectedModel: "provider:model",
      modelMetadata: { model: { attachment: false } },
      customModelMetadata: {},
      ragConfig: { enabled: false },
      deferKnowledgeRetrieval: true,
      knowledgeCollections: [
        {
          id: "collection_1",
          name: "Manual KB",
          files: [],
        },
      ],
      workspaceKnowledgeCollectionIds: ["collection_1"],
    });

    expect(result.knowledgeScope).toHaveLength(1);
    expect(result.knowledgeScope[0]).toMatchObject({
      mimeType: "application/vnd.neo-chat.collection",
      data: "collection_1",
    });
    expect(result.finalText).toBe("Use the docs");
  });

  it("returns a structured RAG error when knowledge lookup fails", async () => {
    mocks.queryRAG.mockRejectedValue(new Error("vector store unavailable"));

    const collectionAttachment = createKnowledgeCollectionAttachment({
      collectionId: "collection_1",
      collectionName: "Manual KB",
    });

    const result = await processMessageForSending({
      text: "Use the docs",
      attachments: [collectionAttachment],
      selectedModel: "provider:model",
      modelMetadata: {
        model: { attachment: false },
      },
      customModelMetadata: {},
      ragConfig: {
        enabled: true,
        useDefaultVectorStore: true,
        serverVectorStoreAvailable: true,
      },
      knowledgeCollections: [
        {
          id: "collection_1",
          name: "Manual KB",
          files: [],
        },
      ],
    });

    expect(result.ragError).toMatchObject({
      code: "RAG_QUERY_FAILED",
    });
    expect(result.ragError?.message).toMatch(/knowledge base/i);
    expect(result.finalText).toContain("[Knowledge Base Error]");
  });

  it("limits RAG query concurrency and preserves successful partial results", async () => {
    const collectionIds = Array.from(
      { length: 6 },
      (_, index) => `collection_${index + 1}`,
    );
    let activeQueries = 0;
    let maxActiveQueries = 0;
    mocks.queryRAG.mockImplementation(
      async (_query: string, collectionId: string) => {
        activeQueries += 1;
        maxActiveQueries = Math.max(maxActiveQueries, activeQueries);
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        activeQueries -= 1;
        if (collectionId === "collection_2") {
          throw new Error("one collection unavailable");
        }
        return [
          {
            title: collectionId,
            url: "#",
            content: `Result from ${collectionId}`,
            metadata: {
              collectionId,
              fileId: `rag_${collectionId}`,
            },
          },
        ];
      },
    );

    const result = await processMessageForSending({
      text: "Use all docs",
      attachments: collectionIds.map((collectionId) =>
        createKnowledgeCollectionAttachment({
          collectionId,
          collectionName: collectionId,
        }),
      ),
      selectedModel: "provider:model",
      modelMetadata: { model: { attachment: false } },
      customModelMetadata: {},
      ragConfig: {
        enabled: true,
        useDefaultVectorStore: true,
        serverVectorStoreAvailable: true,
      },
      knowledgeCollections: collectionIds.map((id) => ({
        id,
        files: [
          {
            id: `file_${id}`,
            ragId: `rag_${id}`,
            name: `${id}.md`,
            type: "text/markdown",
            status: "indexed",
            uploadedAt: 1,
          },
        ],
      })),
    });

    expect(maxActiveQueries).toBeLessThanOrEqual(4);
    expect(result.ragSources).toHaveLength(5);
    expect(result.ragError).toBeUndefined();
  });

  it("keeps unindexed knowledge file attachments on the local context path when RAG is enabled", async () => {
    const fileAttachment = createKnowledgeFileAttachment({
      collectionId: "collection_1",
      fileId: "file_1",
      fileName: "notes.md",
    });

    const result = await processMessageForSending({
      text: "Summarize notes",
      attachments: [fileAttachment],
      selectedModel: "provider:model",
      modelMetadata: {
        model: { attachment: false },
      },
      customModelMetadata: {},
      ragConfig: {
        enabled: true,
        useDefaultVectorStore: true,
        serverVectorStoreAvailable: true,
      },
      knowledgeCollections: [
        {
          id: "collection_1",
          name: "Manual KB",
          files: [
            {
              id: "file_1",
              name: "notes.md",
              type: "text/plain",
              status: "saved",
              uploadedAt: 1,
              path: "opfs://kb/notes",
            },
          ],
        },
      ],
    });

    expect(mocks.queryRAG).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalled();
    expect(result.finalText).toContain("knowledge file text");
    expect(result.ragSources).toEqual([]);
  });
});
