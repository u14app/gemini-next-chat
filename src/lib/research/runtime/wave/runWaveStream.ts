import { getFrozenResearchSourceContracts } from "@/lib/plugin/researchSources/contracts";
import {
  mergeResearchImageSources,
  normalizeResearchImageSources,
  type ResearchReportRun,
} from "@/lib/research";
import { streamChatResponse } from "@/services/api/chatService";

import { collectTaskEvidence } from "../evidenceCollection";
import { persistRun } from "../executionContext";
import { persistWaveCheckpoint } from "./waveCheckpoint";
import type { ResearchWaveContext, ResearchWaveEvidence } from "./waveContext";

/**
 * Runs the wave's tool-enabled model turn, then commits whatever evidence it
 * produced before any archive pass gets to read it.
 */
export async function runWaveStream(
  wave: ResearchWaveContext,
): Promise<ResearchWaveEvidence> {
  const { ctx } = wave;
  const { nodeIds, agentRunId, availableBudget } = wave;
  const {
    controller,
    snapshot,
    sourceContext,
    chatConfig,
    effective,
    settings,
  } = ctx;
  const result = await streamChatResponse(
    ctx.task.sessionId,
    ctx.researchModel,
    wave.resumeHistory,
    wave.savedCheckpoint
      ? `${wave.wavePrompt}\n\nResume only from committed results above. Do not replay an already committed external call.`
      : wave.wavePrompt,
    sourceContext.frozenAttachments,
    {
      ...chatConfig,
      chatMode: "research",
      useAgentMode: false,
      useDeepResearch: true,
      useSearch: snapshot.searchEnabled,
      useReasoning: snapshot.reasoningMode !== "off",
      reasoningMode: snapshot.reasoningMode || chatConfig.reasoningMode,
    },
    (text) => {
      wave.latestContent = text;
    },
    `${effective.systemInstruction}\n\nThe host-controlled wave, source snapshot, query allowance, and read-only policy are authoritative.`,
    (isSearching, results) => {
      if (!isSearching && results?.sources) {
        wave.webSources = results.sources;
        const nextImages = normalizeResearchImageSources(
          results.images,
          // Images belong to the durable ResearchReportRun, not the
          // transient model execution run used to collect this wave.
          wave.activeRun.id,
        );
        wave.imageSources = mergeResearchImageSources(
          wave.imageSources ?? [],
          nextImages,
        );
        ctx.imageSources = mergeResearchImageSources(
          ctx.imageSources ?? [],
          nextImages,
        );
        void persistWaveCheckpoint(wave);
      }
    },
    (toolCalls) => {
      wave.latestToolCalls = toolCalls;
      void persistWaveCheckpoint(wave);
    },
    undefined,
    undefined,
    controller.signal,
    snapshot.pluginIds,
    undefined,
    undefined,
    ctx.toolConfirmationController,
    {
      executionWorkflow: { kind: "research", phase: "execute" },
      knowledgeScope: {
        attachments: [
          ...sourceContext.approvedKnowledgeAttachments,
          ...sourceContext.frozenAttachments,
        ],
        collections: sourceContext.collections,
        ragConfig: { ...settings.rag },
      },
      workspaceReadScope: (snapshot.workspaceSources || []).map(
        (source) => source.path,
      ),
      onKnowledgeSources: (sources) => {
        wave.knowledgeSources = sources;
      },
      allowedToolIds: snapshot.toolIds,
      enforceAllowedToolIds: true,
      allowedToolEffects: ["local_read", "network_read"],
      approvalMode: snapshot.approvalMode,
      researchQueryBudget: wave.queryBudget,
      researchSourceContracts: await getFrozenResearchSourceContracts(
        ctx.taskId,
        snapshot,
      ),
      researchSourceBudget: wave.sourceBudget,
      agentBudget: {
        ...availableBudget,
        maxToolRounds: Math.min(
          3,
          availableBudget.maxToolRounds - wave.reservedModelRounds,
        ),
        maxToolCalls: wave.phaseToolCallAllowance,
      },
      agentRun: {
        id: agentRunId,
        userMessageId: ctx.task.userMessageId,
        modelMessageId: ctx.task.cardMessageId,
      },
      resumeAgentRun: wave.resumeThisWave,
      abortAgentRunAsInterrupted: true,
      onAgentExecutionPhase: (nextPhase) => {
        const operation = ctx.operationsRef.current.get(ctx.taskId);
        if (operation?.controller === controller) {
          operation.phase = nextPhase;
        }
      },
      shouldPauseAfterToolBatch: () => {
        const operation = ctx.operationsRef.current.get(ctx.taskId);
        return Boolean(
          operation?.controller === controller && operation.pauseRequested,
        );
      },
      userInputController: ctx.userInputController,
      memoryScopes: snapshot.memoryScopes,
      memoryScopeIds: snapshot.memoryScopeIds,
    },
  );
  wave.latestContent = result || wave.latestContent;
  controller.signal.throwIfAborted();
  await wave.checkpointQueue.catch(() => undefined);
  const currentTaskAfterWave = ctx.store.tasksById[ctx.taskId];
  const firstNode = wave.activeRun.nodes.find((node) =>
    nodeIds.includes(node.id),
  );
  if (!firstNode) {
    throw new Error("The research wave no longer has an approved node.");
  }
  const collected = await collectTaskEvidence({
    task: currentTaskAfterWave,
    runIds: [agentRunId],
    webSources: wave.webSources,
    knowledgeSources: wave.knowledgeSources,
    defaultStepId: firstNode.stepId,
    defaultNodeId: firstNode.id,
  });
  const evidenceArchivedAt = Date.now();
  const learnedRun: ResearchReportRun = {
    ...wave.activeRun,
    ...(wave.imageSources?.length
      ? {
          imageSources: (wave.imageSources ?? []).map((image) => ({
            ...image,
          })),
        }
      : {}),
    nodes: wave.activeRun.nodes.map((node) => {
      if (!nodeIds.includes(node.id)) return node;
      const nodeEvidence = collected.evidence.filter(
        (item) => item.nodeId === node.id,
      );
      return {
        ...node,
        status: "learning" as const,
        sourceIds: Array.from(
          new Set([
            ...node.sourceIds,
            ...nodeEvidence.map((item) => item.sourceId),
          ]),
        ),
        evidenceIds: Array.from(
          new Set([
            ...node.evidenceIds,
            ...nodeEvidence.map((item) => item.id),
          ]),
        ),
        updatedAt: evidenceArchivedAt,
      };
    }),
    updatedAt: evidenceArchivedAt,
  };
  wave.activeRun = learnedRun;
  await persistRun(
    ctx,
    learnedRun,
    collected.evidence,
    currentTaskAfterWave.checkpoint,
  );
  return {
    ...collected,
    ...(wave.imageSources?.length
      ? {
          imageSources: (wave.imageSources ?? []).map((image) => ({
            ...image,
          })),
        }
      : {}),
  };
}
