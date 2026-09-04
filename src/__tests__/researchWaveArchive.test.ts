import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createEvidenceSource,
  collectAgentEvidenceRecords,
  getEvidenceMetadata,
} from "@/lib/agent/evidence";
import type { AgentEvidenceRecord, ToolResultReference } from "@/lib/agent/run";
import { hashToolArguments } from "@/lib/agent/toolArguments";
import { normalizeToolResultEnvelope } from "@/lib/agent/toolResult";
import { StructuredOutputCapabilityError } from "@/lib/chat/responseFormat";
import {
  createResearchReportRun,
  createResearchTask,
  sanitizeCheckpointToolCall,
  type ResearchEvidence,
  type ResearchPlanVersion,
} from "@/lib/research";
import { collectTaskEvidence } from "@/lib/research/runtime/evidenceCollection";
import type { ResearchExecutionContext } from "@/lib/research/runtime/executionContext";
import { archiveWave } from "@/lib/research/runtime/wave/archiveWave";
import { readCheckpoint } from "@/lib/research/runtime/checkpointStorage";
import type { ResearchWaveContext } from "@/lib/research/runtime/wave/waveContext";
import { hashWorkspaceBlob } from "@/services/workspace/workspaceManifest";

const mocks = vi.hoisted(() => ({
  stream: vi.fn(),
  native: true,
  records: [] as AgentEvidenceRecord[],
  log: vi.fn(),
  files: new Map<string, string>(),
  refs: new Map<string, ToolResultReference[]>(),
}));
vi.mock("@/services/api/chatService", () => ({
  streamChatResponse: (...args: unknown[]) => mocks.stream(...args),
}));
vi.mock("@/store/core/agentRunStore", () => ({
  useAgentRunStore: {
    getState: () => ({
      runsById: {
        "agent-run": {
          id: "agent-run",
          sessionId: "session",
          evidence: mocks.records,
          toolExecutions: mocks.records.map((record) => ({
            callId: record.toolCallId,
            toolName: "fetch_url",
            status: "committed",
            resultRefs: mocks.refs.get(record.toolCallId || ""),
          })),
        },
      },
    }),
  },
}));
vi.mock("@/lib/utils/model", () => ({
  parseModelString: () => ({ providerId: "provider", modelName: "model" }),
  resolveProviderModelMetadata: () => ({}),
  supportsStructuredOutput: () => mocks.native,
}));
vi.mock("@/lib/utils/devLogger", () => ({
  logDevError: (...args: unknown[]) => mocks.log(...args),
}));
vi.mock("@/utils/opfs", () => ({
  resolveOPFSBlob: async (url: string) => {
    const value = mocks.files.get(url);
    return value === undefined ? null : new Blob([value]);
  },
}));
vi.mock("@/services/workspace/sessionWorkspace", () => ({
  readWorkspaceText: async (sessionId: string, path: string) => {
    const value = mocks.files.get(`opfs://chat/workspace/${sessionId}/${path}`);
    return value === undefined
      ? { ok: false }
      : { ok: true, value: { content: value.slice(0, 60_000) } };
  },
}));

const packet = (
  nodeKey: string,
  sourceKey: string,
  claim = "A sourced claim",
) => ({
  nodeKey,
  learnings: [
    {
      claim,
      importance: "major",
      stance: "supports",
      finding: claim,
      sourceKeys: [sourceKey],
    },
  ],
  sourceAssessments: [],
  followUps: [],
});
const output = (...packets: ReturnType<typeof packet>[]) =>
  JSON.stringify({ packets });

function fixture() {
  const plan: ResearchPlanVersion = {
    id: "plan",
    version: 1,
    title: "Review",
    summary: "Review",
    objective: "Review",
    scope: {
      audience: "Engineers",
      includes: ["Review"],
      excludes: [],
      allowedSourceTypes: ["web"],
    },
    assumptions: [],
    deliverable: {
      kind: "research_report",
      description: "Findings",
      requiredSections: ["Findings"],
    },
    strategy: {
      initialBreadth: 2,
      maxDepth: 2,
      maxQueries: 16,
      resultsPerQuery: 5,
    },
    steps: ["A", "B"].map((key) => ({
      id: `step-${key}`,
      title: key,
      objective: key,
      questions: [key],
      queryTopics: [key],
      sourcePriorities: [
        { sourceType: "web" as const, priority: "high" as const },
      ],
      evidenceCriteria: ["Read sources"],
      priority: "high" as const,
    })),
    completionCriteria: ["Review sources"],
    recon: {
      status: "completed",
      sourceFeasibility: "verified",
      startedAt: 1,
      completedAt: 2,
      timeoutMs: 30_000,
      queryLimit: 2,
      resultsPerQuery: 5,
      usage: { queryCount: 0, resultCount: 0, wallTimeMs: 1 },
      queries: [],
    },
    createdAt: 1,
  };
  const task = createResearchTask({
    id: "task",
    sessionId: "session",
    goal: "Review",
    now: 1,
  });
  const run = createResearchReportRun({
    id: "run",
    taskId: task.id,
    plan,
    now: 1,
  });
  const evidence: ResearchEvidence = {
    id: "evidence-A",
    sourceId: "source-A",
    stepId: run.nodes[0].stepId,
    nodeId: run.nodes[0].id,
    locator: "https://example.test/source",
    sourceType: "web",
    contentHash: "sha256:body",
    retrievedAt: 1,
    claimIds: [],
    agentRunId: "agent-run",
    toolCallId: "fixture-read",
  };
  task.evidence = [evidence];
  task.executionRunIds = ["agent-run"];
  mocks.records = [
    {
      sourceId: evidence.sourceId,
      url: evidence.locator,
      contentHash: evidence.contentHash,
      retrievedAt: 1,
      retrievalKind: "fetch",
      toolCallId: "fixture-read",
    },
  ];
  const controller = new AbortController();
  const ctx = {
    taskId: task.id,
    task,
    controller,
    plan,
    researchModel: "provider:model",
    settings: {},
    chatConfig: {},
    effective: { systemInstruction: "Host policy" },
    store: { tasksById: { [task.id]: task } },
  } as unknown as ResearchExecutionContext;
  const wave = {
    ctx,
    activeRun: run,
    agentRunId: "agent-run",
    nodeIds: [run.nodes[1].id],
    wavePrompt: "Committed research work",
    latestContent: "A factual handoff",
    latestToolCalls: [
      {
        id: "fixture-read",
        name: "fetch_url",
        args: { url: evidence.locator },
        status: "success",
        result: normalizeToolResultEnvelope(
          {
            ok: true,
            sourceId: evidence.sourceId,
            content: "A factual source body.",
          },
          {
            trust: "external_untrusted",
            provenance: { origin: "builtin", toolName: "fetch_url" },
          },
        ),
      },
    ],
    queryBudget: { remainingQueries: 3 },
    sourceBudget: { remainingSourceBodies: 5 },
  } as unknown as ResearchWaveContext;
  return { task, run, wave, evidence, controller };
}

beforeEach(() => {
  mocks.stream.mockReset();
  mocks.log.mockReset();
  mocks.records = [];
  mocks.native = true;
  mocks.files.clear();
  mocks.refs.clear();
});

describe("Research evidence collection and wave archive", () => {
  it("freezes a verified local body across repair and diagnoses missing S1 without renumbering S2", async () => {
    const { wave, evidence } = fixture();
    wave.latestToolCalls[0].result = { omitted: true };
    const second = {
      ...evidence,
      id: "evidence-B",
      sourceId: "source-B",
      toolCallId: "read-B",
    };
    mocks.records.push({
      ...mocks.records[0],
      sourceId: second.sourceId,
      toolCallId: second.toolCallId,
    });
    const path = "tool-results/read-B.json";
    const body = JSON.stringify({
      ok: true,
      sourceId: "source-B",
      content: "FROZEN_LOCAL_BODY " + "detail ".repeat(10_000),
    });
    mocks.files.set(`opfs://chat/workspace/session/${path}`, body);
    mocks.refs.set("read-B", [
      {
        kind: "workspace_file",
        id: path,
        contentHash: await hashWorkspaceBlob(new Blob([body])),
      },
    ]);
    mocks.stream
      .mockImplementationOnce(async () => {
        mocks.files.set(
          `opfs://chat/workspace/session/${path}`,
          '{"content":"changed after first archive"}',
        );
        return output(packet("N1", "invented-source"));
      })
      .mockResolvedValueOnce(output(packet("N1", "S2")));
    const collected = {
      evidence: [evidence, second],
      newEvidenceIds: [],
      touchedEvidenceIds: [evidence.id, second.id],
      searchOnlyCount: 0,
    };
    const archived = await archiveWave(wave, collected);
    expect(archived.packets[0].learnings[0].sourceIds).toEqual(["source-B"]);
    expect(mocks.stream.mock.calls[0][2]).toBe(mocks.stream.mock.calls[1][2]);
    expect(JSON.stringify(mocks.stream.mock.calls[0][2])).toContain(
      "FROZEN_LOCAL_BODY",
    );
    expect(mocks.stream.mock.calls[0][3]).toContain(
      'body_unavailable or no excerpt space: ["S1"]',
    );
    expect(mocks.stream.mock.calls[0][17].responseFormat).toBe(
      mocks.stream.mock.calls[1][17].responseFormat,
    );
    expect(mocks.log).toHaveBeenCalledWith(
      "Deep Research source body unavailable",
      { sourceKeys: ["S1"], reason: "body_unavailable" },
    );
    expect(collected.evidence).toHaveLength(2);
  });

  it("preserves a real successful envelope through checkpoint readback and closed-book archive", async () => {
    const { task, run, wave } = fixture();
    task.evidence = [];
    const body = "BODY_MARKER: the measured efficiency was 87 percent.";
    const source = await createEvidenceSource(
      { url: "https://example.test/read", title: "Measurement", content: body },
      { kind: "fetch", retrievedAt: 7 },
    );
    const metadata = getEvidenceMetadata(source)!;
    const raw = {
      ok: true,
      url: source.url,
      title: source.title,
      content: body,
      sourceId: metadata.sourceId,
      retrievedAt: metadata.retrievedAt,
      contentHash: metadata.contentHash,
    };
    const result = normalizeToolResultEnvelope(raw, {
      trust: "external_untrusted",
      provenance: { origin: "builtin", toolName: "fetch_url" },
    });
    const call = {
      id: "read-body",
      name: "fetch_url",
      args: { url: source.url },
      status: "success" as const,
      isError: false,
      result,
    };
    const beforeHash = await hashToolArguments(result);
    mocks.records = collectAgentEvidenceRecords(raw, {
      toolCallId: call.id,
      defaultKind: "fetch",
    });
    const collected = await collectTaskEvidence({
      task,
      runIds: ["agent-run"],
      webSources: [],
      knowledgeSources: [],
      defaultStepId: run.nodes[1].stepId,
      defaultNodeId: run.nodes[1].id,
    });
    const path = "research/checkpoints/body.json";
    task.checkpoint = {
      createdAt: 1,
      resumeStatus: "researching",
      historyPath: path,
      committedEvidenceIds: collected.newEvidenceIds,
      committedToolExecutionIds: [],
    };
    mocks.files.set(
      `opfs://chat/workspace/${task.sessionId}/${path}`,
      JSON.stringify({
        version: 1,
        taskId: task.id,
        savedAt: 1,
        prompt: wave.wavePrompt,
        partialContent: "Read complete.",
        toolCalls: [sanitizeCheckpointToolCall(call)],
        outputBlocks: [],
      }),
    );
    const checkpoint = await readCheckpoint(task);
    expect(checkpoint).not.toBeNull();
    expect(await hashToolArguments(checkpoint!.toolCalls[0].result)).toBe(
      beforeHash,
    );
    wave.latestToolCalls = checkpoint!.toolCalls;
    wave.latestContent = checkpoint!.partialContent;
    mocks.stream.mockResolvedValue(output(packet("N1", "S1")));
    await archiveWave(wave, collected);
    expect(JSON.stringify(mocks.stream.mock.calls[0][2])).toContain(body);
    expect(mocks.stream.mock.calls[0][17]).toMatchObject({
      disableTools: true,
    });
  });

  it("reads a checkpoint JSON beyond the workspace tool's 60k text cap", async () => {
    const { task } = fixture();
    const path = "research/checkpoints/large.json";
    task.checkpoint = {
      createdAt: 1,
      resumeStatus: "researching",
      historyPath: path,
      committedEvidenceIds: [],
      committedToolExecutionIds: [],
    };
    mocks.files.set(
      `opfs://chat/workspace/${task.sessionId}/${path}`,
      JSON.stringify({
        version: 1,
        taskId: task.id,
        savedAt: 1,
        prompt: "P".repeat(70_000),
        partialContent: "Read complete.",
        toolCalls: [],
        outputBlocks: [],
      }),
    );
    expect((await readCheckpoint(task))?.prompt).toHaveLength(70_000);
  });

  it("deduplicates the same source delivered through the evidence ledger and source callback", async () => {
    const { task, run } = fixture();
    task.evidence = [];
    const source = await createEvidenceSource(
      {
        url: "https://example.test/dual",
        title: "Dual delivery",
        content: "Exactly one document",
      },
      { kind: "fetch", retrievedAt: 7 },
    );
    const metadata = getEvidenceMetadata(source)!;
    mocks.records = collectAgentEvidenceRecords(source, {
      toolCallId: "read-dual",
      defaultKind: "fetch",
    });
    const collected = await collectTaskEvidence({
      task,
      runIds: ["agent-run"],
      webSources: [source],
      knowledgeSources: [],
      defaultStepId: run.nodes[1].stepId,
      defaultNodeId: run.nodes[1].id,
    });
    expect(collected.evidence).toHaveLength(1);
    expect(collected.newEvidenceIds).toHaveLength(1);
    expect(collected.touchedEvidenceIds).toHaveLength(1);
    expect(collected.evidence[0]).toMatchObject({
      sourceId: metadata.sourceId,
      contentHash: metadata.contentHash,
      retrievedAt: 7,
    });
  });

  it("archives a later wave's reread through canonical evidence without counting a new source", async () => {
    const { task, run, wave, evidence } = fixture();
    const original = await createEvidenceSource(
      {
        url: evidence.locator,
        title: "Original",
        content: "Shared source body",
      },
      { kind: "fetch", retrievedAt: 1 },
    );
    const mirror = await createEvidenceSource(
      {
        url: "https://mirror.test/source",
        title: "Mirror",
        content: "Shared source body",
      },
      { kind: "fetch", retrievedAt: 2 },
    );
    const originalMetadata = getEvidenceMetadata(original)!;
    const mirrorMetadata = getEvidenceMetadata(mirror)!;
    Object.assign(evidence, {
      sourceId: originalMetadata.sourceId,
      contentHash: originalMetadata.contentHash,
    });
    mocks.records = [
      { ...mirrorMetadata, url: mirror.url, toolCallId: "read-1" },
    ];
    wave.latestToolCalls = [
      {
        id: "read-1",
        name: "fetch_url",
        args: { url: mirror.url },
        status: "success",
        result: normalizeToolResultEnvelope(
          {
            ok: true,
            sourceId: mirrorMetadata.sourceId,
            content: mirror.content,
          },
          {
            trust: "external_untrusted",
            provenance: { origin: "builtin", toolName: "fetch_url" },
          },
        ),
      },
    ];
    const collected = await collectTaskEvidence({
      task,
      runIds: ["agent-run"],
      webSources: [],
      knowledgeSources: [],
      defaultStepId: run.nodes[1].stepId,
      defaultNodeId: run.nodes[1].id,
    });
    expect(collected.newEvidenceIds).toEqual([]);
    expect(collected.touchedEvidenceIds).toEqual([evidence.id]);
    expect(collected.evidence[0]).toMatchObject({
      id: evidence.id,
      nodeId: run.nodes[0].id,
      aliasSourceIds: [mirrorMetadata.sourceId],
    });
    mocks.stream.mockResolvedValue(
      output(packet("N1", mirrorMetadata.sourceId)),
    );
    const archived = await archiveWave(wave, collected);
    expect(archived.degradedNodeIds).toEqual([]);
    expect(archived.packets[0]).toMatchObject({
      nodeId: run.nodes[1].id,
      learnings: [
        { sourceIds: [originalMetadata.sourceId], evidenceIds: [evidence.id] },
      ],
    });
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(mocks.stream.mock.calls[0][3]).toContain(mirrorMetadata.sourceId);
    expect(wave.queryBudget.remainingQueries).toBe(3);
    expect(wave.sourceBudget.remainingSourceBodies).toBe(5);
  });

  it("does not promote discovery results or return IDs dropped by the evidence cap", async () => {
    const { task, run, evidence } = fixture();
    mocks.records = [
      {
        sourceId: "search-source",
        url: "https://example.test/search",
        contentHash: "search-hash",
        retrievedAt: 2,
        retrievalKind: "search",
        toolCallId: "search",
      },
    ];
    let collected = await collectTaskEvidence({
      task,
      runIds: ["agent-run"],
      webSources: [],
      knowledgeSources: [],
      defaultStepId: run.nodes[1].stepId,
      defaultNodeId: run.nodes[1].id,
    });
    expect(collected).toMatchObject({
      newEvidenceIds: [],
      touchedEvidenceIds: [],
      searchOnlyCount: 1,
    });
    task.evidence = Array.from({ length: 2_000 }, (_, index) => ({
      ...evidence,
      id: `evidence-${index}`,
      sourceId: `source-${index}`,
      locator: `https://example.test/${index}`,
      contentHash: `hash-${index}`,
    }));
    mocks.records = [
      {
        sourceId: "overflow-source",
        url: "https://example.test/overflow",
        contentHash: "overflow-hash",
        retrievedAt: 2,
        retrievalKind: "fetch",
        toolCallId: "read",
      },
    ];
    collected = await collectTaskEvidence({
      task,
      runIds: ["agent-run"],
      webSources: [],
      knowledgeSources: [],
      defaultStepId: run.nodes[1].stepId,
      defaultNodeId: run.nodes[1].id,
    });
    expect(collected.evidence).toHaveLength(2_000);
    expect(collected.newEvidenceIds).toEqual([]);
    expect(collected.touchedEvidenceIds).toEqual([]);
  });

  it("freezes the index across one targeted repair and preserves an accepted packet", async () => {
    const { run, wave, evidence } = fixture();
    wave.nodeIds = run.nodes.map((node) => node.id);
    const collected = {
      evidence: [evidence],
      newEvidenceIds: [],
      touchedEvidenceIds: [evidence.id],
      searchOnlyCount: 0,
    };
    mocks.stream
      .mockImplementationOnce(async () => {
        evidence.sourceId = "source-changed-after-request";
        return output(
          packet("N1", "S1", "Keep accepted claim"),
          packet("N2", "source-unknown"),
        );
      })
      .mockResolvedValueOnce(
        output(
          packet("N1", "S1", "Do not overwrite"),
          packet("N2", "source-A", "Repaired claim"),
        ),
      );
    const archived = await archiveWave(wave, collected);
    expect(mocks.stream).toHaveBeenCalledTimes(2);
    expect(archived.degradedNodeIds).toEqual([]);
    expect(archived.repairedNodeIds).toEqual([run.nodes[1].id]);
    expect(archived.packets[0].learnings[0].claimText).toBe(
      "Keep accepted claim",
    );
    expect(archived.packets[1].learnings[0].sourceIds).toEqual(["source-A"]);
    for (const call of mocks.stream.mock.calls) {
      expect(call[5]).toMatchObject({
        useSearch: false,
        useAgentMode: false,
        useDeepResearch: false,
      });
      expect(call[17]).toMatchObject({ disableTools: true });
      expect(JSON.stringify(call[17].responseFormat.schema)).not.toContain(
        "source-changed-after-request",
      );
    }
    expect(mocks.stream.mock.calls[0][17].responseFormat).toBe(
      mocks.stream.mock.calls[1][17].responseFormat,
    );
    expect(mocks.stream.mock.calls[1][3]).toContain('"key":"N2"');
  });

  it("falls back once when native output is unavailable, then degrades only the unrepaired node", async () => {
    const { run, wave, evidence } = fixture();
    wave.nodeIds = run.nodes.map((node) => node.id);
    const collected = {
      evidence: [evidence],
      newEvidenceIds: [],
      touchedEvidenceIds: [evidence.id],
      searchOnlyCount: 0,
    };
    mocks.stream
      .mockRejectedValueOnce(new StructuredOutputCapabilityError(400))
      .mockResolvedValueOnce(
        output(packet("N1", "source-A"), packet("N2", "S81")),
      )
      .mockResolvedValueOnce(output(packet("N2", "source-fabricated")));
    const archived = await archiveWave(wave, collected);
    expect(mocks.stream).toHaveBeenCalledTimes(3);
    expect(mocks.stream.mock.calls[0][17].responseFormat).toBeDefined();
    expect(
      mocks.stream.mock.calls
        .slice(1)
        .every(
          (call) =>
            call[17].responseFormat === undefined && call[17].disableTools,
        ),
    ).toBe(true);
    expect(archived.degradedNodeIds).toEqual([run.nodes[1].id]);
    expect(archived.packets[0].learnings).toHaveLength(1);
    expect(archived.packets[1].learnings).toEqual([]);
    expect(collected.evidence).toEqual([evidence]);
  });
});
