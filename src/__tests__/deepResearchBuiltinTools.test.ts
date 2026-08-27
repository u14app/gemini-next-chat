import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAgentBuiltinToolNames } from "../lib/agent/capabilityCatalog";
import { createResearchTask, type ResearchTask } from "../lib/research";
import { collectBuiltinTools } from "../services/api/chat/builtinTools";
import {
  createDeepResearchBindings,
  createResearchPlanReviewBindings,
} from "../services/api/chat/builtinTools/deepResearch";

const mocks = vi.hoisted(() => ({
  repository: {
    get: vi.fn(),
    list: vi.fn(),
  },
  readReportArtifact: vi.fn(),
  storeState: {
    tasksById: {} as Record<string, unknown>,
    activeTaskId: null as string | null,
  },
}));

vi.mock("@/services/research", () => ({
  getResearchTaskRepository: () => mocks.repository,
  readResearchReportArtifact: mocks.readReportArtifact,
}));

vi.mock("@/store/core/researchStore", () => ({
  useResearchStore: {
    getState: () => mocks.storeState,
  },
}));

vi.mock("@/store/core/memoryStore", () => ({
  useMemoryStore: {
    getState: () => ({
      _hasHydrated: true,
      settings: { enabled: false, searchEnabled: false },
      memories: [],
      markMemoriesUsed: vi.fn(),
    }),
  },
}));

const RESEARCH_TOOL_NAMES = [
  "start_deep_research",
  "get_research_status",
  "list_research_tasks",
  "read_research_report",
  "list_research_evidence",
  "adjust_research_plan",
] as const;
const TEST_MODEL = "openai:test-model";

function getBinding(name: (typeof RESEARCH_TOOL_NAMES)[number]) {
  const binding = createDeepResearchBindings().find(
    (candidate) => candidate.definition.function.name === name,
  );
  if (!binding) throw new Error(`Missing ${name} binding.`);
  return binding;
}

function createTaskFixture(): ResearchTask {
  const task = createResearchTask({
    id: "research-1",
    sessionId: "session-1",
    goal: "Compare current primary sources",
    budgetPreset: "standard",
    now: 1,
  });
  return {
    ...task,
    status: "completed",
    updatedAt: 10,
    endedAt: 10,
    activePlanVersion: 1,
    planVersions: [
      {
        id: "plan-1",
        version: 1,
        title: "Current source comparison",
        summary: "Compare the selected primary sources.",
        objective: "Compare current primary sources.",
        scope: {
          audience: "The requesting user",
          includes: ["Material changes", "Source disagreements"],
          excludes: [],
          allowedSourceTypes: ["web", "knowledge"],
        },
        assumptions: [],
        deliverable: {
          kind: "comparison",
          description: "A cited comparison.",
          requiredSections: ["Key findings", "Sources"],
        },
        strategy: {
          initialBreadth: 4,
          maxDepth: 2,
          maxQueries: 16,
          resultsPerQuery: 5,
        },
        recon: {
          status: "completed",
          sourceFeasibility: "verified",
          startedAt: 1,
          completedAt: 2,
          timeoutMs: 30_000,
          queryLimit: 2,
          resultsPerQuery: 5,
          usage: { queryCount: 2, resultCount: 6, wallTimeMs: 100 },
          queries: [
            {
              query: "current primary sources",
              status: "completed",
              resultCount: 3,
              domains: ["example.com"],
            },
            {
              query: "primary source disagreements",
              status: "completed",
              resultCount: 3,
              domains: ["docs.example.com"],
            },
          ],
        },
        steps: [
          {
            id: "step-1",
            title: "Material changes",
            objective: "Identify material changes.",
            questions: ["What changed?"],
            queryTopics: ["current changes"],
            sourcePriorities: [{ sourceType: "web", priority: "high" }],
            evidenceCriteria: ["A current primary source."],
            priority: "high",
          },
          {
            id: "step-2",
            title: "Source disagreements",
            objective: "Compare material disagreements.",
            questions: ["Where do sources disagree?"],
            queryTopics: ["source disagreements"],
            sourcePriorities: [{ sourceType: "knowledge", priority: "medium" }],
            evidenceCriteria: ["Explicitly mapped evidence."],
            priority: "high",
          },
        ],
        completionCriteria: ["Both plan steps are covered."],
        createdAt: 2,
      },
    ],
    evidence: [
      {
        id: "evidence-1",
        sourceId: "source-1",
        sourceType: "web",
        stepId: "step-2",
        nodeId: "node-2",
        title: "Primary source",
        locator: "https://example.com/source",
        retrievedAt: 3,
        contentHash: "sha256:source",
        claimIds: ["Q2:claim-1"],
        stance: "supports",
        relations: [
          {
            researchRunId: "research-run-1",
            stepId: "step-2",
            nodeId: "node-2",
            claimIds: ["Q2:claim-1"],
            stance: "supports",
            boundAt: 7,
          },
        ],
      },
      {
        id: "evidence-2",
        sourceId: "source-2",
        sourceType: "knowledge",
        stepId: "step-1",
        nodeId: "node-1",
        locator: "knowledge://source-2",
        retrievedAt: 4,
        contentHash: "sha256:context",
        claimIds: ["Q1:claim-2"],
        stance: "context",
        relations: [
          {
            researchRunId: "research-run-1",
            stepId: "step-1",
            nodeId: "node-1",
            claimIds: ["Q1:claim-2"],
            stance: "context",
            boundAt: 7,
          },
        ],
      },
    ],
    reportRuns: [
      {
        id: "research-run-1",
        taskId: "research-1",
        planVersion: 1,
        reportKind: "initial",
        phase: "completed",
        strategy: {
          initialBreadth: 4,
          maxDepth: 2,
          maxQueries: 16,
          resultsPerQuery: 5,
        },
        waves: [
          {
            id: "wave-1",
            index: 1,
            depth: 1,
            breadth: 2,
            nodeIds: ["node-1", "node-2"],
            status: "completed",
            newEvidenceCount: 2,
            newVerifiedClaimCount: 2,
            startedAt: 3,
            completedAt: 8,
          },
        ],
        nodes: [
          {
            id: "node-1",
            waveId: "wave-1",
            stepId: "step-1",
            depth: 1,
            objective: "Identify material changes.",
            query: "current changes",
            status: "completed",
            sourceIds: ["source-2"],
            evidenceIds: ["evidence-2"],
            claimIds: ["Q1:claim-2"],
            createdAt: 3,
            updatedAt: 7,
          },
          {
            id: "node-2",
            waveId: "wave-1",
            stepId: "step-2",
            depth: 1,
            objective: "Compare material disagreements.",
            query: "source disagreements",
            status: "completed",
            sourceIds: ["source-1"],
            evidenceIds: ["evidence-1"],
            claimIds: ["Q2:claim-1"],
            createdAt: 3,
            updatedAt: 7,
          },
        ],
        learningPackets: [],
        claims: [
          {
            id: "Q1:claim-2",
            text: "A material change was identified.",
            importance: "background",
            stepId: "step-1",
            nodeIds: ["node-1"],
            supportingEvidenceIds: ["evidence-2"],
            contradictingEvidenceIds: [],
            verificationStatus: "verified",
            independentPublisherCount: 1,
            createdAt: 6,
            updatedAt: 7,
          },
          {
            id: "Q2:claim-1",
            text: "The sources disagree on a material point.",
            importance: "major",
            stepId: "step-2",
            nodeIds: ["node-2"],
            supportingEvidenceIds: ["evidence-1"],
            contradictingEvidenceIds: [],
            verificationStatus: "verified",
            independentPublisherCount: 1,
            createdAt: 6,
            updatedAt: 7,
          },
        ],
        frontierNodeIds: [],
        executedQueries: [
          "current changes",
          "source disagreements",
          "current primary source",
          "independent source comparison",
        ],
        coverage: {
          requiredStepCount: 2,
          coveredStepCount: 2,
          majorClaimCount: 1,
          verifiedMajorClaimCount: 1,
          unresolvedMajorClaimCount: 0,
          stepRatio: 1,
          claimRatio: 1,
          overallRatio: 1,
          complete: true,
        },
        usage: {
          queryCount: 4,
          sourceBodyCount: 2,
          toolRounds: 2,
          toolCalls: 4,
          wallTimeMs: 500,
          totalTokens: 1_000,
        },
        startedAt: 3,
        updatedAt: 8,
        endedAt: 8,
        stopReason: { code: "coverage_satisfied", at: 8 },
      },
    ],
    activeReportRunId: "research-run-1",
    activeReportVersion: 1,
    reportVersions: [
      {
        id: "report-1",
        version: 1,
        artifactId: "opfs://chat/research-artifacts/report.md",
        planVersion: 1,
        researchRunId: "research-run-1",
        createdAt: 9,
        summary: "The sources disagree on one material point.",
        keyFindings: ["One material disagreement remains."],
        gaps: [],
        coveredStepIds: ["step-1", "step-2"],
        kind: "initial",
      },
    ],
  };
}

function setStoreTask(task: ResearchTask, active = false) {
  mocks.storeState = {
    tasksById: { [task.id]: task },
    activeTaskId: active ? task.id : null,
  };
}

describe("Deep Research built-in tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storeState = { tasksById: {}, activeTaskId: null };
    mocks.repository.get.mockResolvedValue(null);
    mocks.repository.list.mockResolvedValue([]);
    mocks.readReportArtifact.mockResolvedValue(null);
  });

  it("declares six Research bindings with explicit local effects", () => {
    const bindings = createDeepResearchBindings();
    const byName = new Map(
      bindings.map((binding) => [binding.definition.function.name, binding]),
    );

    expect([...byName.keys()]).toEqual(RESEARCH_TOOL_NAMES);
    for (const name of RESEARCH_TOOL_NAMES) {
      expect(byName.get(name)).toMatchObject({
        risk: "read",
        descriptor: {
          version: 2,
          effects:
            name === "start_deep_research" || name === "adjust_research_plan"
              ? ["local_write", "network_read"]
              : ["local_read"],
          sensitivity: "user_data",
          origin: "builtin",
        },
      });
    }
    expect(
      byName.get("start_deep_research")?.definition.function.parameters,
    ).toMatchObject({
      additionalProperties: false,
      required: ["query", "budgetPreset"],
      properties: {
        query: { maxLength: 8_000 },
        budgetPreset: { enum: ["quick", "standard", "deep"] },
      },
    });
    expect(
      byName.get("start_deep_research")?.definition.function.description,
    ).toContain("bounded public search-summary reconnaissance");
    expect(
      byName.get("adjust_research_plan")?.definition.function.description,
    ).toContain("bounded public search-summary reconnaissance");
  });

  it("registers a strict tool set for every Research phase", async () => {
    const agentNames = collectBuiltinTools({
      message: "Research this",
      agentModeEnabled: true,
      workspaceAvailable: false,
    }).definitions.map((definition) => definition.function.name);
    const startNames = collectBuiltinTools({
      message: "Research this",
      researchPhase: "start",
      workspaceAvailable: false,
    }).definitions.map((definition) => definition.function.name);
    const planNames = collectBuiltinTools({
      message: "Research this",
      researchPhase: "plan",
      workspaceAvailable: false,
    }).definitions.map((definition) => definition.function.name);
    const planSearchNames = collectBuiltinTools({
      message: "Research this",
      researchPhase: "plan",
      useSearch: true,
      searchMode: "external",
      workspaceAvailable: false,
    }).definitions.map((definition) => definition.function.name);
    const clarifyNames = collectBuiltinTools({
      message: "Narrow this to 2024 onward",
      researchPhase: "clarify",
      useSearch: true,
      searchMode: "external",
      workspaceAvailable: false,
    }).definitions.map((definition) => definition.function.name);
    const executeTools = collectBuiltinTools({
      message: "Research this",
      researchPhase: "execute",
      useSearch: true,
      searchMode: "external",
      knowledgeScope: {
        attachments: [
          {
            id: "attachment-1",
            fileName: "source.pdf",
            mimeType: "application/pdf",
            data: "blob:source",
          },
          {
            id: "knowledge-1",
            fileName: "Docs",
            mimeType: "application/vnd.neo-chat.collection",
            data: "collection-1",
          },
        ],
        collections: [],
        ragConfig: { enabled: false },
      },
      workspaceAvailable: true,
    });
    const executeNames = executeTools.definitions.map(
      (definition) => definition.function.name,
    );

    expect(agentNames).not.toContain("start_deep_research");
    expect(startNames).toEqual(["start_deep_research"]);
    expect(planNames).toEqual([]);
    expect(planSearchNames).toEqual(["web_search"]);
    // Clarification is source-free: refine or approve the plan, nothing else.
    expect(clarifyNames).toEqual([
      "adjust_research_plan",
      "confirm_research_plan",
    ]);
    expect(executeNames).toEqual(
      expect.arrayContaining([
        "web_search",
        "search_web",
        "fetch_url",
        "fetch_urls",
        "search_knowledge",
        "inspect_attachment",
        "list_workspace_files",
        "stat_workspace_file",
        "search_workspace_files",
        "read_workspace_file",
      ]),
    );
    for (const forbidden of [
      "start_deep_research",
      "update_task_plan",
      "execute_javascript",
      "search_memories",
      "discover_skills",
      "load_skill",
      "write_workspace_file",
      "archive_workspace_files",
      "extract_document",
    ]) {
      expect(executeNames).not.toContain(forbidden);
    }
    for (const binding of executeTools.bindingsByName.values()) {
      expect(binding.descriptor.effects.length).toBeGreaterThan(0);
      expect(
        binding.descriptor.effects.every(
          (effect) => effect === "local_read" || effect === "network_read",
        ),
      ).toBe(true);
    }
    const fetchUrlParameters = executeTools.bindingsByName.get("fetch_url")
      ?.definition.function.parameters as
      { properties?: Record<string, unknown> } | undefined;
    expect(fetchUrlParameters?.properties).not.toHaveProperty("saveToPath");
    expect(
      (
        executeTools.bindingsByName.get("inspect_attachment")?.definition
          .function.parameters as { required?: string[] }
      ).required,
    ).toEqual(["attachment_id"]);
    await expect(
      executeTools.bindingsByName.get("inspect_attachment")!.execute(
        { attachment_id: "attachment-1" },
        {
          sessionId: "session-1",
          model: TEST_MODEL,
          emit: {},
          knowledgeScope: {
            attachments: [
              {
                id: "attachment-1",
                fileName: "source.pdf",
                mimeType: "application/pdf",
                data: "blob:source",
              },
            ],
            collections: [],
            ragConfig: { enabled: false },
          },
        },
      ),
    ).resolves.toMatchObject({
      attachmentId: "attachment-1",
      source: {
        title: "source.pdf",
        url: "attachment://attachment-1",
        metadata: { retrievalKind: "attachment" },
      },
    });
    expect(
      getAgentBuiltinToolNames({
        agentModeEnabled: true,
        memoryEnabled: false,
        externalSearchEnabled: false,
        knowledgeEnabled: false,
        skillsEnabled: false,
        mcpEnabled: false,
        dynamicToolsEnabled: false,
        workspaceEnabled: false,
      }).filter((name) =>
        RESEARCH_TOOL_NAMES.includes(
          name as (typeof RESEARCH_TOOL_NAMES)[number],
        ),
      ),
    ).toEqual([]);
  });

  it("normalizes start arguments and keeps host context out of model args", async () => {
    const signal = new AbortController().signal;
    const start = vi.fn(async () => ({
      taskId: "research-1",
      status: "draft" as const,
    }));

    await expect(
      getBinding("start_deep_research").execute(
        {
          query: "  Compare current primary sources  ",
          budgetPreset: "standard",
        },
        {
          signal,
          sessionId: "session-1",
          model: "openai:gpt-4.1",
          userMessageId: "user-1",
          modelMessageId: "model-1",
          agentRunId: "run-1",
          emit: {
            research: { start, adjustPlan: vi.fn(), confirmPlan: vi.fn() },
          },
        },
      ),
    ).resolves.toEqual({ taskId: "research-1", status: "draft" });
    expect(start).toHaveBeenCalledWith(
      {
        query: "Compare current primary sources",
        budgetPreset: "standard",
      },
      {
        signal,
        sessionId: "session-1",
        model: "openai:gpt-4.1",
        userMessageId: "user-1",
        modelMessageId: "model-1",
        agentRunId: "run-1",
      },
    );
  });

  it("fails closed on invalid start and adjustment arguments", async () => {
    const start = vi.fn();
    const adjustPlan = vi.fn();
    const emit = { research: { start, adjustPlan, confirmPlan: vi.fn() } };

    await expect(
      getBinding("start_deep_research").execute(
        {
          query: "x".repeat(8_001),
          budgetPreset: "quick",
          sessionId: "injected",
        },
        { sessionId: "session-1", model: TEST_MODEL, emit },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "RESEARCH_ARGUMENTS_INVALID", recoverable: true },
    });
    await expect(
      getBinding("adjust_research_plan").execute(
        { taskId: "research-1", instruction: "   " },
        { sessionId: "session-1", model: TEST_MODEL, emit },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "RESEARCH_ARGUMENTS_INVALID", recoverable: true },
    });
    expect(start).not.toHaveBeenCalled();
    expect(adjustPlan).not.toHaveBeenCalled();
  });

  it("reads status and bounded task lists without an emitter", async () => {
    const task = createTaskFixture();
    setStoreTask(task, true);
    mocks.repository.list.mockResolvedValue([
      task,
      { ...task, id: "research-2", updatedAt: 8 },
    ]);

    await expect(
      getBinding("get_research_status").execute(undefined, {
        sessionId: "session-1",
        model: TEST_MODEL,
        emit: {},
      }),
    ).resolves.toMatchObject({
      taskId: "research-1",
      status: "completed",
      phase: "completed",
      researchRunId: "research-run-1",
      wave: { index: 1, depth: 1, status: "completed" },
      depth: 1,
      frontier: { nodeIds: [], count: 0 },
      queryUsage: {
        used: 4,
        limit: 16,
        remaining: 12,
        reservedForVerification: 3,
      },
      coverage: { overallRatio: 1, complete: true },
      planningUsage: {
        queryCount: 2,
        queryLimit: 2,
        sourceFeasibility: "verified",
      },
      stopReason: { code: "coverage_satisfied" },
      plan: { version: 1, questions: expect.any(Array) },
      report: { version: 1 },
    });
    await expect(
      getBinding("list_research_tasks").execute(
        { sessionId: "session-1", limit: 1 },
        { sessionId: "session-1", model: TEST_MODEL, emit: {} },
      ),
    ).resolves.toMatchObject({
      tasks: [{ taskId: "research-1", status: "completed" }],
      total: 2,
    });
    expect(mocks.repository.list).toHaveBeenCalledWith("session-1");
  });

  it("resolves report content through the Research Artifact service", async () => {
    const task = createTaskFixture();
    setStoreTask(task);
    mocks.readReportArtifact.mockResolvedValue({
      artifactId: task.reportVersions[0].artifactId,
      markdown: "# Current source comparison\n\nReport body.",
      bytes: 48,
      mimeType: "text/markdown",
    });

    await expect(
      getBinding("read_research_report").execute(
        { taskId: task.id, version: 1 },
        { sessionId: task.sessionId, model: TEST_MODEL, emit: {} },
      ),
    ).resolves.toMatchObject({
      taskId: task.id,
      report: {
        version: 1,
        researchRunId: "research-run-1",
        coveredStepIds: ["step-1", "step-2"],
        markdown: "# Current source comparison\n\nReport body.",
        artifactId: task.reportVersions[0].artifactId,
      },
    });
    expect(mocks.readReportArtifact).toHaveBeenCalledWith(
      task.reportVersions[0].artifactId,
    );
  });

  it("filters evidence by question and stance", async () => {
    const task = createTaskFixture();
    task.reportRuns = [
      ...task.reportRuns,
      {
        ...task.reportRuns[0],
        id: "research-run-2",
        claims: task.reportRuns[0].claims.map((claim) => ({
          ...claim,
          verificationStatus: "unsupported" as const,
        })),
      },
    ];
    setStoreTask(task);

    await expect(
      getBinding("list_research_evidence").execute(
        { taskId: task.id, questionIndex: 1, stance: "supports" },
        { sessionId: task.sessionId, model: TEST_MODEL, emit: {} },
      ),
    ).resolves.toEqual({
      taskId: task.id,
      questionIndex: 1,
      stance: "supports",
      evidence: [
        expect.objectContaining({
          id: "evidence-1",
          stepId: "step-2",
          nodeId: "node-2",
          questionIndexes: [1],
          stance: "supports",
          claimVerification: [
            {
              researchRunId: "research-run-1",
              planVersion: 1,
              stepId: "step-2",
              nodeId: "node-2",
              stance: "supports",
              claimId: "Q2:claim-1",
              verificationStatus: "verified",
              importance: "major",
              independentPublisherCount: 1,
            },
          ],
        }),
      ],
      total: 1,
    });
  });

  it("returns the new approval-gated plan version after adjustment", async () => {
    const before = {
      ...createTaskFixture(),
      status: "plan_ready" as const,
      endedAt: undefined,
      reportVersions: [],
      activeReportVersion: undefined,
    };
    setStoreTask(before);
    const adjustPlan = vi.fn(async () => {
      const next: ResearchTask = {
        ...before,
        updatedAt: 12,
        activePlanVersion: 2,
        planVersions: [
          ...before.planVersions,
          {
            ...before.planVersions[0],
            id: "plan-2",
            version: 2,
            createdAt: 12,
            adjustment: "Add regional differences",
          },
        ],
      };
      setStoreTask(next);
    });

    await expect(
      getBinding("adjust_research_plan").execute(
        {
          taskId: before.id,
          instruction: "  Add regional differences  ",
        },
        {
          sessionId: before.sessionId,
          model: TEST_MODEL,
          emit: {
            research: {
              start: vi.fn(),
              adjustPlan,
              confirmPlan: vi.fn(),
            },
          },
        },
      ),
    ).resolves.toEqual({
      taskId: before.id,
      status: "plan_ready",
      planVersion: 2,
      approvalRequired: true,
    });
    expect(adjustPlan).toHaveBeenCalledWith(
      {
        taskId: before.id,
        instruction: "Add regional differences",
      },
      { sessionId: before.sessionId, model: TEST_MODEL },
    );
  });

  it("starts the run only from a plan the user has approved", async () => {
    const planReady = {
      ...createTaskFixture(),
      status: "plan_ready" as const,
      endedAt: undefined,
      reportVersions: [],
      activeReportVersion: undefined,
    };
    setStoreTask(planReady);
    const confirmPlan = vi.fn(async () => {
      setStoreTask({ ...planReady, status: "researching", updatedAt: 20 });
    });
    const confirm = createResearchPlanReviewBindings().find(
      (binding) => binding.definition.function.name === "confirm_research_plan",
    );
    if (!confirm) throw new Error("Missing confirm_research_plan binding.");
    const emit = {
      research: { start: vi.fn(), adjustPlan: vi.fn(), confirmPlan },
    };

    await expect(
      confirm.execute(
        { taskId: planReady.id },
        { sessionId: planReady.sessionId, model: TEST_MODEL, emit },
      ),
    ).resolves.toEqual({
      taskId: planReady.id,
      status: "researching",
      planVersion: planReady.activePlanVersion,
    });

    // A task that is no longer awaiting approval cannot be started twice.
    await expect(
      confirm.execute(
        { taskId: planReady.id },
        { sessionId: planReady.sessionId, model: TEST_MODEL, emit },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "RESEARCH_PLAN_NOT_READY" },
    });
    expect(confirmPlan).toHaveBeenCalledTimes(1);
  });

  it("aborts before invoking a write emitter", async () => {
    const controller = new AbortController();
    const start = vi.fn();
    controller.abort();

    await expect(
      getBinding("start_deep_research").execute(
        { query: "Research this", budgetPreset: "quick" },
        {
          signal: controller.signal,
          sessionId: "session-1",
          model: TEST_MODEL,
          emit: {
            research: { start, adjustPlan: vi.fn(), confirmPlan: vi.fn() },
          },
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(start).not.toHaveBeenCalled();
  });
});
