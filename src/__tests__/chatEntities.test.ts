import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_LIMITS,
  CHAT_ENTITY_LIMITS,
  CONTEXT_COMPRESSION_LIMITS,
} from "../config/limits";
import {
  normalizeSession,
  normalizeSessionTitle,
  normalizeWorkspace,
} from "../lib/chat/entities";
import type { Session, Workspace } from "../types";

describe("chat entity normalization", () => {
  it("normalizes generated session titles", () => {
    expect(normalizeSessionTitle('```text\n1. "Launch plan"\n```')).toBe(
      "Launch plan",
    );
    expect(normalizeSessionTitle("Title:\u0007\n- Fallback title")).toBe(
      "Fallback title",
    );
    expect(normalizeSessionTitle("x".repeat(200))).toHaveLength(
      CHAT_ENTITY_LIMITS.maxSessionTitleChars,
    );
    expect(normalizeSessionTitle("\u0000\n```")).toBe("New Chat");
  });

  it("normalizes session metadata and plugin refs", () => {
    const session = normalizeSession({
      id: "s1",
      title: ` ${"t".repeat(CHAT_ENTITY_LIMITS.maxSessionTitleChars + 10)}`,
      messageCount: -10,
      updatedAt: Number.NaN,
      model: "model",
      systemInstruction: "i".repeat(
        CHAT_ENTITY_LIMITS.maxSessionSystemInstructionChars + 1,
      ),
      config: {
        activePlugins: ["search", "search", "", "image"],
        activeSkills: ["clarity-rewrite", "clarity-rewrite", "", "summary"],
      },
      compression: {
        compressedContent: "c".repeat(
          CONTEXT_COMPRESSION_LIMITS.maxCompressedContentChars + 10,
        ),
        lastCompressedMessageId: "m".repeat(160),
        includedMemoryIds: ["memory-1", "memory-1", "", "memory-2"],
      },
    } as Session);

    expect(session.title).toHaveLength(CHAT_ENTITY_LIMITS.maxSessionTitleChars);
    expect(session.messageCount).toBe(0);
    expect(session.updatedAt).toEqual(expect.any(Number));
    expect(session.systemInstruction).toHaveLength(
      CHAT_ENTITY_LIMITS.maxSessionSystemInstructionChars,
    );
    expect(session.config?.activePlugins).toEqual(["search", "image"]);
    expect(session.config?.activeSkills).toEqual([
      "clarity-rewrite",
      "summary",
    ]);
    expect(session.compression?.compressedContent).toHaveLength(
      CONTEXT_COMPRESSION_LIMITS.maxCompressedContentChars,
    );
    expect(session.compression?.lastCompressedMessageId).toHaveLength(120);
    expect(session.compression?.includedMemoryIds).toEqual([]);
  });

  it("treats legacy compression records without memory ids as an empty set", () => {
    const session = normalizeSession({
      id: "legacy",
      title: "Legacy",
      messageCount: 2,
      updatedAt: 1,
      model: "model",
      compression: {
        compressedContent: "Existing summary",
        lastCompressedMessageId: "m1",
      },
    });

    expect(session.compression).toEqual({
      compressedContent: "Existing summary",
      lastCompressedMessageId: "m1",
      includedMemoryIds: [],
    });
  });

  it("preserves explicit empty capability overrides", () => {
    expect(
      normalizeSession({
        id: "s1",
        title: "New Chat",
        messageCount: 0,
        updatedAt: 1,
        model: "model",
        config: {
          useSearch: true,
          useAgentMode: true,
        },
      } as Session).config,
    ).toEqual({
      chatMode: "agent",
      useSearch: true,
      useAgentMode: true,
      useDeepResearch: false,
    });

    expect(
      normalizeSession({
        id: "s2",
        title: "New Chat",
        messageCount: 0,
        updatedAt: 1,
        model: "model",
        config: {
          activePlugins: [],
          activeSkills: [],
        },
      } as Session).config,
    ).toEqual({ activePlugins: [], activeSkills: [] });

    expect(
      normalizeSession({
        id: "s3",
        title: "New Chat",
        messageCount: 0,
        updatedAt: 1,
        model: "model",
        config: {
          useAgentMode: "yes",
        },
      } as unknown as Session).config,
    ).toEqual({});
  });

  it("normalizes workspace metadata, references, and files", () => {
    const workspace = normalizeWorkspace({
      id: "w1",
      name: ` ${"w".repeat(CHAT_ENTITY_LIMITS.maxWorkspaceNameChars + 10)}`,
      systemPrompt: "p".repeat(
        CHAT_ENTITY_LIMITS.maxWorkspaceSystemPromptChars + 1,
      ),
      knowledgeCollectionIds: [" kb1 ", "kb1", "", "kb2"],
      files: [
        {
          id: "a1",
          fileName: "x".repeat(ATTACHMENT_LIMITS.maxFileNameChars + 1),
          mimeType: "text/plain",
          url: "opfs://workspace/file.txt",
        },
        {
          id: "bad",
          fileName: "",
          mimeType: "text/plain",
          url: "opfs://workspace/bad.txt",
        },
        {
          id: "missing",
          fileName: "restored.txt",
          mimeType: "text/plain",
          localFileMissing: true,
          localFileError: "The file was not included in the backup.",
        },
      ],
      color: "not-a-color",
      activePlugins: ["reader", "reader"],
      activeSkills: ["meeting-minutes", "meeting-minutes", ""],
      enableSearch: "yes",
      enableReasoning: true,
      createdAt: Number.NaN,
    } as unknown as Workspace);

    expect(workspace.name).toHaveLength(
      CHAT_ENTITY_LIMITS.maxWorkspaceNameChars,
    );
    expect(workspace.systemPrompt).toHaveLength(
      CHAT_ENTITY_LIMITS.maxWorkspaceSystemPromptChars,
    );
    expect(workspace.knowledgeCollectionIds).toEqual(["kb1", "kb2"]);
    expect(workspace.files).toHaveLength(2);
    expect(workspace.files[0]?.fileName).toHaveLength(
      ATTACHMENT_LIMITS.maxFileNameChars,
    );
    expect(workspace.files[1]).toMatchObject({
      id: "missing",
      fileName: "restored.txt",
      localFileMissing: true,
      localFileError: "The file was not included in the backup.",
    });
    expect(workspace.color).toBe("blue");
    expect(workspace.activePlugins).toEqual(["reader"]);
    expect(workspace.activeSkills).toEqual(["meeting-minutes"]);
    expect(workspace.enableSearch).toBe(false);
    expect(workspace.enableReasoning).toBe(true);
    expect(workspace.createdAt).toEqual(expect.any(Number));
  });
});
