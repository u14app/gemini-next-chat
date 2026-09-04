import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "@/types";
import { AGENT_WORKSPACE_LIMITS } from "@/config/limits";
import {
  createAgentRun,
  type ToolExecutionRecord,
  type ToolResultReference,
} from "@/lib/agent/run";
import { hashToolArguments } from "@/lib/agent/toolArguments";
import { normalizeToolResultEnvelope } from "@/lib/agent/toolResult";
import { boundHistoryForRequest } from "@/lib/chat/requestContextBudget";
import { sanitizeCheckpointToolCall } from "@/lib/research/checkpointCodec";
import {
  readCommittedResearchToolResult,
  readResearchCheckpointJson,
} from "@/lib/research/runtime/readLocalResearchJson";
import { projectResearchArchiveMaterial } from "@/lib/research/runtime/wave/archiveEvidence";
import { prepareResearchResultHistory } from "@/services/api/chat/researchResultHistory";
import { hashWorkspaceBlob } from "@/services/workspace/workspaceManifest";

const mocks = vi.hoisted(() => ({
  files: new Map<string, Blob>(),
  write: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/utils/opfs", () => ({
  resolveOPFSBlob: (...args: unknown[]) => mocks.read(...args),
}));
vi.mock("@/services/workspace/sessionWorkspace", () => ({
  writeWorkspaceText: (...args: unknown[]) => mocks.write(...args),
}));

beforeEach(() => {
  mocks.files.clear();
  mocks.read
    .mockReset()
    .mockImplementation(async (url: string) => mocks.files.get(url) ?? null);
  mocks.write
    .mockReset()
    .mockImplementation(async (session: string, path: string, text: string) => {
      const blob = new Blob([text]);
      mocks.files.set(`opfs://chat/workspace/${session}/${path}`, blob);
      return {
        ok: true,
        value: {
          contentHash: await hashWorkspaceBlob(blob),
          revision: "revision-1",
        },
      };
    });
});

function committed(reference: ToolResultReference) {
  const run = createAgentRun({
    sessionId: "session",
    workflowKind: "research",
  });
  run.toolExecutions = [
    {
      callId: "read-1",
      status: "committed",
      resultRefs: [reference],
    } as ToolExecutionRecord,
  ];
  return { sessionId: "session", run, callId: "read-1", reference };
}

describe("Research committed result bodies", () => {
  it("persists redacted full JSON before returning its exact committed reference", async () => {
    const raw = {
      ok: true,
      sourceId: "source-1",
      content: "BODY ".repeat(15_000),
      apiKey: "private-test-key",
    };
    const prepared = await prepareResearchResultHistory(
      "session",
      "read-1",
      raw,
    );
    expect(mocks.write).toHaveBeenCalledWith(
      "session",
      "tool-results/read-1.json",
      expect.any(String),
      "create",
    );
    expect(mocks.write.mock.calls[0][2]).not.toContain("private-test-key");
    expect(JSON.stringify(prepared.value).length).toBeLessThanOrEqual(8_000);
    const loaded = await readCommittedResearchToolResult(
      committed(prepared.resultRef!),
    );
    expect(loaded).toMatchObject({
      ok: true,
      value: { sourceId: "source-1", content: raw.content },
    });
    const envelope = normalizeToolResultEnvelope(prepared.value, {
      trust: "external_untrusted",
      provenance: { origin: "builtin", toolName: "fetch_url" },
    });
    const checkpoint = sanitizeCheckpointToolCall({
      id: "read-1",
      name: "fetch_url",
      args: {},
      status: "success",
      result: envelope,
    });
    expect(await hashToolArguments(checkpoint.result)).toBe(
      await hashToolArguments(envelope),
    );
  });

  it("keeps a small sanitized result exact and retains bounded fallback excerpts when storage is full", async () => {
    const small = { ok: true, sourceId: "small", content: "Readable body" };
    expect(
      await prepareResearchResultHistory("session", "small", small),
    ).toEqual({ value: small });
    expect(mocks.write).not.toHaveBeenCalled();
    mocks.write.mockResolvedValue({ ok: false, error: { code: "quota" } });
    const prepared = await prepareResearchResultHistory("session", "large", {
      sources: ["first", "second"].map((sourceId) => ({
        content: '\n"\\'.repeat(9_000),
        metadata: { sourceId },
      })),
    });
    expect(prepared.resultRef).toBeUndefined();
    expect(JSON.stringify(prepared.value).length).toBeLessThanOrEqual(8_000);
    expect(prepared.value).toMatchObject({
      bodyStatus: "excerpt",
      researchSourceExcerpts: [
        { sourceId: "first", text: expect.any(String) },
        { sourceId: "second", text: expect.any(String) },
      ],
    });
  });

  it("rejects uncommitted, cross-session, unregistered, or traversing references before reading", async () => {
    const reference = {
      kind: "workspace_file" as const,
      id: "tool-results/read-1.json",
      contentHash: "sha256:expected",
    };
    const valid = committed(reference);
    const inputs = [
      { ...valid, sessionId: "other-session" },
      { ...valid, callId: "other-call" },
      {
        ...valid,
        reference: { ...reference, contentHash: "sha256:different" },
      },
      committed({ ...reference, id: "tool-results/../secret.json" }),
      {
        ...valid,
        run: {
          ...valid.run,
          toolExecutions: [
            { ...valid.run.toolExecutions[0], status: "failed" as const },
          ],
        },
      },
    ];
    for (const input of inputs)
      expect(await readCommittedResearchToolResult(input)).toEqual({
        ok: false,
        reason: "scope_denied",
      });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("checks actual Blob hash and size and safely degrades missing or invalid JSON", async () => {
    const path = "tool-results/read-1.json";
    const original = new Blob(['{"content":"original"}']);
    const args = committed({
      kind: "workspace_file",
      id: path,
      contentHash: await hashWorkspaceBlob(original),
    });
    expect(await readCommittedResearchToolResult(args)).toEqual({
      ok: false,
      reason: "missing",
    });
    mocks.files.set(
      `opfs://chat/workspace/session/${path}`,
      new Blob(['{"content":"tampered"}']),
    );
    expect(await readCommittedResearchToolResult(args)).toEqual({
      ok: false,
      reason: "hash_mismatch",
    });
    mocks.files.set(
      `opfs://chat/workspace/session/${path}`,
      new Blob([new Uint8Array(AGENT_WORKSPACE_LIMITS.maxFileBytes + 1)]),
    );
    expect(await readCommittedResearchToolResult(args)).toEqual({
      ok: false,
      reason: "too_large",
    });
    mocks.files.set(
      "opfs://chat/workspace/session/research/checkpoints/invalid.json",
      new Blob(["{"]),
    );
    expect(
      await readResearchCheckpointJson(
        "session",
        "research/checkpoints/invalid.json",
      ),
    ).toEqual({ ok: false, reason: "invalid_json" });
    const controller = new AbortController();
    controller.abort();
    await expect(
      readCommittedResearchToolResult({ ...args, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fairly bounds escaped tool bodies and survives the actual request context limiter", () => {
    const materials = Array.from({ length: 8 }, (_, index) => ({
      id: `read-${index}`,
      name: "fetch_url",
      sources: [
        {
          sourceId: `source-${index}`,
          sourceKey: `S${index + 1}`,
          text: `SOURCE_${index} ` + '\n"\\'.repeat(20_000),
          truncated: false,
        },
      ],
    }));
    for (const maxChars of [2_000, 9_600, 48_000]) {
      const projected = projectResearchArchiveMaterial(materials, maxChars);
      expect(JSON.stringify(projected.calls).length).toBeLessThanOrEqual(
        maxChars,
      );
      expect(
        projected.calls.every((call) => JSON.stringify(call).length <= 8_000),
      ).toBe(true);
      expect(projected.availableSourceKeys.size).toBeGreaterThan(0);
      expect(Object.isFrozen(projected.calls)).toBe(true);
      if (maxChars !== 9_600) continue;
      expect(projected.availableSourceKeys.size).toBe(8);
      const history: Message[] = [
        { id: "host", role: "user", content: "Source excerpts", timestamp: 1 },
        {
          id: "body",
          role: "model",
          content: "Read completed",
          toolCalls: [...projected.calls],
          timestamp: 2,
        },
      ];
      const bounded = boundHistoryForRequest(history, {
        newMessage: "Archive",
        systemInstruction: "Closed book",
        attachments: [],
      });
      expect(bounded[1].toolCalls).toEqual(projected.calls);
    }
  });
});
