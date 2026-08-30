import { v7 as uuidv7 } from "uuid";

import {
  auditResearchReport,
  buildResearchReportRepairPrompt,
  buildResearchSynthesisPrompt,
  calculateResearchCoverage,
  countTrailingWaves,
  getCurrentResearchReportRunIds,
  getResearchFrontier,
  getResearchStopReason,
  normalizeResearchReportMarkdown,
  transitionResearchTask,
} from "@/lib/research";
import { logDevError } from "@/lib/utils/devLogger";
import { streamChatResponse } from "@/services/api/chatService";

import { persistRun, type ResearchExecutionContext } from "../executionContext";
import { publishResearchReportVersion } from "../reportPublication";
import { aggregateExecutionUsage, remainingBudget } from "../usage";

/**
 * Settles the run's final coverage and stop reason, then writes the report in
 * a closed-book pass, repairs it at most once, and publishes it.
 */
export async function runSynthesisStage(ctx: ResearchExecutionContext) {
  const { controller, plan, chatConfig, effective } = ctx;
  const finalCoverage = calculateResearchCoverage(
    plan.steps,
    ctx.run.nodes,
    ctx.run.claims,
  );
  const evaluatedStopReason = getResearchStopReason(ctx.run.strategy, {
    coverage: finalCoverage,
    frontierCount: getResearchFrontier(ctx.run).length,
    currentDepth: Math.max(0, ...ctx.run.nodes.map((node) => node.depth)),
    queryCount: ctx.run.usage.queryCount,
    sourceBodyCount: ctx.run.usage.sourceBodyCount,
    sourceBodyLimit: ctx.sourceBodyLimit,
    remainingToolCalls:
      remainingBudget(ctx.store.tasksById[ctx.taskId])?.maxToolCalls || 0,
    wavesWithoutNewSources: countTrailingWaves(ctx.run, "newEvidenceCount"),
    wavesWithoutNewVerifiedClaims: countTrailingWaves(
      ctx.run,
      "newVerifiedClaimCount",
    ),
  });
  const finalStopReason = finalCoverage.complete
    ? { code: "coverage_satisfied" as const, at: Date.now() }
    : ctx.run.stopReason ||
      evaluatedStopReason || {
        code:
          ctx.run.usage.queryCount >= ctx.run.strategy.maxQueries
            ? ("max_queries" as const)
            : ("frontier_exhausted" as const),
        at: Date.now(),
        detail:
          ctx.run.usage.queryCount >= ctx.run.strategy.maxQueries
            ? "The report run exhausted its approved query limit."
            : "No further in-scope wave was scheduled.",
      };
  ctx.run = {
    ...ctx.run,
    coverage: finalCoverage,
    stopReason: finalStopReason,
    phase: "synthesizing",
    updatedAt: Date.now(),
  };
  await ctx.store.updateTask(ctx.taskId, (current) =>
    current.status === "verifying"
      ? transitionResearchTask(current, "synthesizing")
      : current,
  );
  await persistRun(ctx, ctx.run);

  const synthesisRunId = uuidv7();
  ctx.lastAgentRunId = synthesisRunId;
  await ctx.store.updateTask(ctx.taskId, (current) => ({
    ...current,
    agentRunIds: [...current.agentRunIds, synthesisRunId],
    executionRunIds: [...current.executionRunIds, synthesisRunId],
  }));
  let reportMarkdown = "";
  reportMarkdown = await streamChatResponse(
    ctx.task.sessionId,
    ctx.researchModel,
    [],
    buildResearchSynthesisPrompt({
      task: ctx.store.tasksById[ctx.taskId],
      plan,
      run: ctx.run,
      evidence: ctx.evidence,
      priorReport: ctx.priorReport,
    }),
    [],
    {
      ...chatConfig,
      chatMode: "chat",
      useAgentMode: false,
      useDeepResearch: false,
      useSearch: false,
      useReasoning: false,
    },
    (text) => {
      reportMarkdown = text;
    },
    `${effective.systemInstruction}\n\nThis is closed-book synthesis. Tools and external source access are disabled; only the supplied verified claim ledger and evidence index may be used.`,
    undefined,
    undefined,
    undefined,
    undefined,
    controller.signal,
    [],
    undefined,
    undefined,
    undefined,
    {
      disableTools: true,
      agentRun: {
        id: synthesisRunId,
        userMessageId: ctx.task.userMessageId,
        modelMessageId: ctx.task.cardMessageId,
      },
    },
  );
  controller.signal.throwIfAborted();
  reportMarkdown = normalizeResearchReportMarkdown(reportMarkdown);
  let audit = auditResearchReport({
    markdown: reportMarkdown,
    plan,
    run: ctx.run,
    evidence: ctx.evidence,
  });
  if (audit.blocking.length > 0) {
    const repairRunId = uuidv7();
    ctx.lastAgentRunId = repairRunId;
    await ctx.store.updateTask(ctx.taskId, (current) => ({
      ...current,
      agentRunIds: [...current.agentRunIds, repairRunId],
      executionRunIds: [...current.executionRunIds, repairRunId],
    }));
    let repaired = "";
    repaired = await streamChatResponse(
      ctx.task.sessionId,
      ctx.researchModel,
      [],
      buildResearchReportRepairPrompt({
        task: ctx.store.tasksById[ctx.taskId],
        plan,
        run: ctx.run,
        evidence: ctx.evidence,
        report: reportMarkdown,
        issues: audit.blocking,
      }),
      [],
      {
        ...chatConfig,
        chatMode: "chat",
        useAgentMode: false,
        useDeepResearch: false,
        useSearch: false,
        useReasoning: false,
      },
      (text) => {
        repaired = text;
      },
      `${effective.systemInstruction}\n\nThis is the single closed-book publication repair. Tools are disabled.`,
      undefined,
      undefined,
      undefined,
      undefined,
      controller.signal,
      [],
      undefined,
      undefined,
      undefined,
      {
        disableTools: true,
        agentRun: {
          id: repairRunId,
          userMessageId: ctx.task.userMessageId,
          modelMessageId: ctx.task.cardMessageId,
        },
      },
    );
    if (repaired.trim()) {
      reportMarkdown = normalizeResearchReportMarkdown(repaired);
    }
    audit = auditResearchReport({
      markdown: reportMarkdown,
      plan,
      run: ctx.run,
      evidence: ctx.evidence,
    });
  }
  // The model's report is the deliverable. Remaining audit findings are
  // recorded for debugging only; they never rewrite or block it.
  if (audit.blocking.length > 0 || audit.advisory.length > 0) {
    logDevError(
      "Deep Research report published with open audit findings",
      [...audit.blocking, ...audit.advisory].join("\n"),
    );
  }
  const aggregate = aggregateExecutionUsage(
    getCurrentResearchReportRunIds(ctx.store.tasksById[ctx.taskId]),
  );
  ctx.run = {
    ...ctx.run,
    usage: { ...ctx.run.usage, ...aggregate },
    updatedAt: Date.now(),
  };
  const uniqueGaps = await publishResearchReportVersion({
    taskId: ctx.taskId,
    plan,
    run: ctx.run,
    markdown: reportMarkdown,
    evidence: ctx.evidence,
    extraGaps: [],
    agentRunId: ctx.lastAgentRunId,
    noEvidenceGap: ctx.t("runtime.gaps.noEvidence"),
    noKeyFindingsGap: ctx.t("runtime.gaps.noKeyFindings"),
    incompleteQuestionsGap: (count) =>
      ctx.t("runtime.gaps.incompleteQuestions", { count }),
    singleSourceNote: (count, total) =>
      ctx.t("report.singleSourceNote", { count, total }),
    signal: controller.signal,
    persistenceError: ctx.t("runtime.error.persistence"),
  });
  ctx.store.setActiveTask(null);
  ctx.onNotice?.(
    uniqueGaps.length > 0
      ? ctx.t("runtime.notice.reportPartial")
      : ctx.t("runtime.notice.reportReady"),
  );
}
