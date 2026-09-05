import { createReportSectionLabels } from "@/lib/research/reportSectionLabels";
import { v7 as uuidv7 } from "uuid";

import {
  buildResearchSynthesisPrompt,
  calculateResearchCoverage,
  countTrailingDegradedWaves,
  countTrailingWaves,
  getCurrentResearchReportRunIds,
  getResearchFrontier,
  getResearchStopReason,
  isResearchCoverageSufficient,
  transitionResearchTask,
} from "@/lib/research";
import { getUnansweredSteeringQuestions } from "@/lib/research/steering";
import { streamChatResponse } from "@/services/api/chatService";

import { persistRun, type ResearchExecutionContext } from "../executionContext";
import { deliverResearchReport } from "../reportDelivery";
import { isAbortError } from "../operations";
import { aggregateExecutionUsage, remainingBudget } from "../usage";

/**
 * Settles the run's final coverage and stop reason, then writes the report in
 * a tool-free pass and delivers its best available text with quality notices.
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
    consecutiveDegradedWaves: countTrailingDegradedWaves(ctx.run),
  });
  const finalStopReason = finalCoverage.complete
    ? { code: "coverage_satisfied" as const, at: Date.now() }
    : isResearchCoverageSufficient(finalCoverage)
      ? { code: "coverage_sufficient" as const, at: Date.now() }
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
  const unansweredSteeringQuestions = getUnansweredSteeringQuestions(
    ctx.run,
    ctx.steeringRecord,
  );
  const sectionLabels = createReportSectionLabels((key) => ctx.t(key));
  let interruption: unknown;
  try {
    const generated = await streamChatResponse(
      ctx.task.sessionId,
      ctx.researchModel,
      [],
      buildResearchSynthesisPrompt({
        task: ctx.store.tasksById[ctx.taskId],
        plan,
        run: ctx.run,
        evidence: ctx.evidence,
        imageSources: ctx.imageSources,
        priorReport: ctx.priorReport,
        sectionLabels,
      }) +
        (unansweredSteeringQuestions.length
          ? `\nThe following user-added research questions remain unanswered. Include them in ${sectionLabels.evidenceGaps} and do not invent answers: ${JSON.stringify(unansweredSteeringQuestions)}`
          : ""),
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
      `${effective.systemInstruction}\n\nWrite the requested report even when evidence is incomplete. Tools and external source access are disabled. Use the supplied material and, where useful, model knowledge explicitly labeled as unverified knowledge supplementation. Only committed evidence may be cited; never invent citations or claim that model knowledge was verified during this research.`,
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
    if (generated.trim()) reportMarkdown = generated;
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted) throw error;
    interruption = error;
  }
  controller.signal.throwIfAborted();
  const aggregate = aggregateExecutionUsage(
    getCurrentResearchReportRunIds(ctx.store.tasksById[ctx.taskId]),
  );
  ctx.run = {
    ...ctx.run,
    usage: { ...ctx.run.usage, ...aggregate },
    updatedAt: Date.now(),
  };
  await deliverResearchReport(ctx, { markdown: reportMarkdown, interruption });
}
