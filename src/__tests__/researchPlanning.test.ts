import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createResearchTask,
  resolveResearchStrategy,
  type ResearchTask,
  type ResearchSourceSnapshot,
} from "@/lib/research";
import type { ResearchPlanDraftV2 } from "@/lib/research/prompts/types";
import type { streamChatResponse } from "@/services/api/chatService";
import type { ResearchTranslate } from "@/lib/research/runtime/executionContext";
import { createKnowledgeCollectionAttachment } from "@/lib/utils/knowledgeAttachments";

const mocks = vi.hoisted(() => ({
  stream: vi.fn<typeof streamChatResponse>(),
  task: null as ResearchTask | null,
  snapshot: {} as ResearchSourceSnapshot,
  snapshotError: null as Error | null,
  sourceContext: vi.fn(),
}));
vi.mock("@/services/api/chatService", () => ({
  streamChatResponse: mocks.stream,
}));
vi.mock("@/store/core/researchStore", () => ({
  useResearchStore: {
    getState: () => ({
      tasksById: { task: mocks.task },
      updateTask: async (
        _id: string,
        update: (task: ResearchTask) => ResearchTask,
      ) => {
        mocks.task = update(mocks.task!);
        return mocks.task;
      },
    }),
  },
}));
vi.mock("@/services/research", () => ({
  getResearchTaskRepository: () => ({ getStatus: () => ({ durable: true }) }),
}));
vi.mock("@/services/research/templates", () => ({
  freezeResearchTaskTemplate: async () => ({ template: null }),
}));
vi.mock("@/lib/research/runtime/taskContext", () => ({
  resolveTaskContext: () => ({
    model: "provider:selected-model",
    chatConfig: {},
    effective: {
      systemInstruction: "User instruction",
      approvalMode: "auto",
      searchCompatibility: { enabled: true, mode: "external" },
    },
    settings: { search: { provider: "firecrawl" }, rag: { enabled: false } },
  }),
}));
vi.mock("@/lib/research/runtime/sourceSnapshot", () => ({
  createSourceSnapshot: async () => {
    if (mocks.snapshotError) throw mocks.snapshotError;
    return mocks.snapshot;
  },
  loadSessionMessages: async () => [],
  buildResearchExecutionSourceContext: mocks.sourceContext,
}));

import { prepareResearchPlan } from "@/lib/research/runtime/preparePlan";
import { parseResearchPlanningResponse } from "@/lib/research/prompts/planningResponse";
import { reconSchema } from "@/services/research/taskRepository/schema/primitives";
import { ResearchModelUnavailableError } from "@/lib/research/runtime/dependencyErrors";

const plan: ResearchPlanDraftV2 = {
  title: "Study the topic",
  summary: "A bounded research plan",
  objective: "Understand the topic",
  scope: {
    audience: "Readers",
    includes: ["Concepts"],
    excludes: [],
    allowedSourceTypes: ["web", "knowledge"],
  },
  assumptions: [],
  deliverable: {
    kind: "research_report",
    description: "An analysis",
    requiredSections: ["Findings"],
  },
  strategy: resolveResearchStrategy("standard"),
  steps: [1, 2, 3].map((id) => ({
    id: `step-${id}`,
    title: `Step ${id}`,
    objective: `Investigate question ${id}`,
    questions: [`Question ${id}`],
    queryTopics: [`Topic ${id}`],
    sourcePriorities: [{ sourceType: "web", priority: "high" }],
    evidenceCriteria: ["A relevant source"],
    priority: "high",
  })),
  completionCriteria: ["Explain the topic"],
};
const planOutput = JSON.stringify({ kind: "plan", plan });
const request = {
  kind: "needs_context",
  reason: "The named concept is unfamiliar",
  queries: ["user-named concept"],
};
const requestOutput = JSON.stringify(request);
const execute = (controller = new AbortController()) =>
  prepareResearchPlan({
    taskId: "task",
    controller,
    t: ((key: string) => key) as ResearchTranslate,
    localizedRuntimeError: (_error, key) => key,
    requestModel: "provider:selected-model",
  });

beforeEach(() => {
  mocks.stream.mockReset();
  mocks.snapshotError = null;
  mocks.sourceContext.mockReset();
  mocks.sourceContext.mockReturnValue({
    approvedKnowledgeAttachments: [
      createKnowledgeCollectionAttachment({
        collectionId: "selected-kb",
        collectionName: "Selected",
      }),
    ],
    collections: [{ id: "selected-kb" }],
  });
  mocks.task = createResearchTask({
    id: "task",
    sessionId: "session",
    goal: "Study user-named concept",
  });
  mocks.snapshot = {
    model: "provider:selected-model",
    searchEnabled: true,
    toolIds: ["web_search", "search_knowledge"],
    knowledgeCollectionIds: ["selected-kb"],
    attachmentIds: [],
    workspaceFileIds: [],
    pluginIds: [],
  } as unknown as ResearchSourceSnapshot;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("adaptive planning through the runtime", () => {
  it("pauses when an interrupted legacy task has no reliable request model", async () => {
    mocks.snapshotError = new ResearchModelUnavailableError();

    await execute();

    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.task).toMatchObject({
      status: "paused",
      error: {
        code: "RESEARCH_MODEL_UNAVAILABLE",
        message: "runtime.dependency.modelUnavailable",
        recoverable: true,
      },
    });
  });

  it("bounds stalled web model work to the same 90s stage deadline and still delivers a plan", async () => {
    vi.useFakeTimers();
    mocks.snapshot.knowledgeCollectionIds = [];
    mocks.stream
      .mockResolvedValueOnce(requestOutput)
      .mockImplementationOnce(async (...args) => {
        const signal = args[12]!;
        expect(args[17]!.researchQueryBudget!.deadlineAt! - Date.now()).toBe(
          90_000,
        );
        return new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      })
      .mockResolvedValueOnce(planOutput);
    const pending = execute();
    await vi.advanceTimersByTimeAsync(89_999);
    expect(mocks.stream).toHaveBeenCalledTimes(2);
    expect(mocks.task!.planVersions).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(mocks.task!.status).toBe("plan_ready");
    const recon = mocks.task!.planVersions[0].recon;
    expect(recon).toMatchObject({ timeoutMs: 90_000, status: "partial" });
    expect(reconSchema.safeParse(recon).success).toBe(true);
    expect(reconSchema.safeParse({ ...recon, timeoutMs: 30_000 }).success).toBe(
      true,
    );
    expect(reconSchema.safeParse({ ...recon, timeoutMs: 90_001 }).success).toBe(
      false,
    );
  });

  it("keeps knowledge lookup at 30s independently of the later web deadline", async () => {
    vi.useFakeTimers();
    mocks.stream
      .mockResolvedValueOnce(requestOutput)
      .mockImplementationOnce(async (...args) => {
        expect(args[17]!.researchQueryBudget!.deadlineAt! - Date.now()).toBe(
          30_000,
        );
        const signal = args[12]!;
        return new Promise<string>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
      })
      .mockImplementationOnce(async (...args) => {
        expect(args[17]!.researchQueryBudget!.deadlineAt! - Date.now()).toBe(
          90_000,
        );
        return planOutput;
      });
    const pending = execute();
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(mocks.task!.status).toBe("plan_ready");
  });
  it("drafts familiar topics in one closed-book call without opening any source", async () => {
    mocks.stream.mockResolvedValue(planOutput);
    await execute();
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(mocks.stream.mock.calls[0][17]).toMatchObject({
      disableTools: true,
      allowedToolIds: [],
      enforceAllowedToolIds: true,
    });
    expect(mocks.stream.mock.calls[0][1]).toBe("provider:selected-model");
    expect(mocks.sourceContext).not.toHaveBeenCalled();
    expect(mocks.task).toMatchObject({
      status: "plan_ready",
      evidence: [],
      executionRunIds: [],
    });
    expect(mocks.task!.planVersions[0].recon).toMatchObject({
      status: "skipped",
      sourceFeasibility: "unverified",
      usage: { queryCount: 0 },
    });
  });

  it("uses only selected knowledge when that resolves the missing concept", async () => {
    mocks.stream
      .mockResolvedValueOnce(requestOutput)
      .mockImplementationOnce(async (...args) => {
        args[17]?.researchQueryBudget?.onQueriesExecuted?.(request.queries);
        args[9]?.([
          {
            id: "lookup",
            name: "search_knowledge",
            args: { query: request.queries[0] },
            status: "success",
            result: {
              sources: [{ title: "Selected note", content: "Private context" }],
            },
          },
        ]);
        return planOutput;
      });
    await execute();
    expect(mocks.stream).toHaveBeenCalledTimes(2);
    expect(mocks.stream.mock.calls[1][17]).toMatchObject({
      allowedToolIds: ["search_knowledge"],
      allowedToolEffects: ["local_read"],
      knowledgeScope: { collections: [{ id: "selected-kb" }] },
    });
    const recon = mocks.task!.planVersions[0].recon;
    expect(recon.usage.queryCount).toBe(0);
    expect(recon.knowledgeQueries).toEqual([
      { query: request.queries[0], status: "completed", resultCount: 1 },
    ]);
    expect(reconSchema.safeParse(recon).success).toBe(true);
    expect(JSON.stringify(recon)).not.toContain("Private context");
    expect(mocks.task!.evidence).toEqual([]);
  });

  it("opens web only after unresolved knowledge and freezes the original public queries", async () => {
    mocks.stream
      .mockResolvedValueOnce(requestOutput)
      .mockResolvedValueOnce(
        JSON.stringify({ ...request, queries: ["PRIVATE extracted term"] }),
      )
      .mockResolvedValueOnce(planOutput);
    await execute();
    expect(
      mocks.stream.mock.calls.map((call) => call[17]?.allowedToolIds),
    ).toEqual([[], ["search_knowledge"], ["web_search"]]);
    const web = mocks.stream.mock.calls[2][17]!;
    expect([...web.researchQueryBudget!.allowedQueries!]).toEqual(
      request.queries,
    );
    expect(web.knowledgeScope).toBeUndefined();
    expect(mocks.stream.mock.calls[2][3]).not.toContain(
      "PRIVATE extracted term",
    );
  });

  it("skips absent knowledge and never enables other source tools", async () => {
    mocks.snapshot.knowledgeCollectionIds = [];
    mocks.stream
      .mockResolvedValueOnce(requestOutput)
      .mockResolvedValueOnce(planOutput);
    await execute();
    expect(
      mocks.stream.mock.calls.map((call) => call[17]?.allowedToolIds),
    ).toEqual([[], ["web_search"]]);
    expect(mocks.sourceContext).not.toHaveBeenCalled();
  });

  it("treats unavailable selected knowledge as an optional lookup failure", async () => {
    mocks.sourceContext.mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    mocks.stream
      .mockResolvedValueOnce(requestOutput)
      .mockResolvedValueOnce(planOutput);
    await execute();
    expect(
      mocks.stream.mock.calls.map((call) => call[17]?.allowedToolIds),
    ).toEqual([[], ["web_search"]]);
    expect(mocks.task!.status).toBe("plan_ready");
    expect(mocks.task!.planVersions[0].recon.status).toBe("partial");
  });

  it("finishes closed-book after optional lookups fail", async () => {
    mocks.stream
      .mockResolvedValueOnce(requestOutput)
      .mockRejectedValueOnce(new Error("Knowledge unavailable"))
      .mockRejectedValueOnce(new Error("Search timed out"))
      .mockResolvedValueOnce(planOutput);
    await execute();
    expect(mocks.task!.status).toBe("plan_ready");
    expect(mocks.stream.mock.calls.at(-1)![17]?.disableTools).toBe(true);
    expect(mocks.stream).toHaveBeenCalledTimes(4);
    expect(mocks.task!.planVersions[0].recon.status).toBe("partial");
  });

  it("keeps source access closed for malformed context requests and repairs the plan", async () => {
    mocks.stream
      .mockResolvedValueOnce(JSON.stringify({ ...request, queries: [] }))
      .mockResolvedValueOnce(JSON.stringify(plan));
    await execute();
    expect(mocks.task!.status).toBe("plan_ready");
    expect(
      mocks.stream.mock.calls.every((call) => call[17]?.disableTools),
    ).toBe(true);
  });

  it("uses an assumption-only final round when no lookup is enabled", async () => {
    mocks.snapshot.searchEnabled = false;
    mocks.snapshot.knowledgeCollectionIds = [];
    mocks.stream
      .mockResolvedValueOnce(requestOutput)
      .mockResolvedValueOnce(planOutput);
    await execute();
    expect(
      mocks.stream.mock.calls.every((call) => call[17]?.disableTools),
    ).toBe(true);
    expect(mocks.task!.planVersions[0].recon.status).toBe("unavailable");
  });

  it("records a timeout before query dispatch as a failed precheck rather than a skipped lookup", async () => {
    mocks.snapshot.knowledgeCollectionIds = [];
    mocks.stream
      .mockResolvedValueOnce(requestOutput)
      .mockImplementationOnce(async (...args) => {
        args[9]?.([
          {
            id: "timeout",
            name: "web_search",
            args: { query: request.queries[0] },
            status: "error",
            result: {
              ok: false,
              error: {
                code: "RESEARCH_RECON_TIMEOUT",
                message: "Lookup deadline elapsed",
              },
            },
          },
        ]);
        return planOutput;
      });
    await execute();
    expect(mocks.task!.status).toBe("plan_ready");
    expect(mocks.task!.planVersions[0].recon).toMatchObject({
      status: "partial",
      sourceFeasibility: "unverified",
      usage: { queryCount: 0 },
    });
  });

  it("does not save a plan after user cancellation during a lookup", async () => {
    const controller = new AbortController();
    mocks.stream
      .mockResolvedValueOnce(requestOutput)
      .mockImplementationOnce(async () => {
        mocks.task!.status = "cancelled";
        controller.abort();
        return planOutput;
      });
    await execute(controller);
    expect(mocks.task!.status).toBe("cancelled");
    expect(mocks.task!.planVersions).toEqual([]);
    expect(mocks.stream).toHaveBeenCalledTimes(2);
  });
});

it("accepts legacy raw plans but rejects ambiguous or invalid context requests", () => {
  expect(parseResearchPlanningResponse('{"kind":"plan"}')).toBeNull();
  expect(parseResearchPlanningResponse(JSON.stringify(plan))?.kind).toBe(
    "plan",
  );
  expect(
    parseResearchPlanningResponse(JSON.stringify({ ...request, plan })),
  ).toBeNull();
  expect(
    parseResearchPlanningResponse(
      JSON.stringify({ ...request, queries: [""] }),
    ),
  ).toBeNull();
});
