import { v7 as uuidv7 } from "uuid";

import type { Message } from "@/types";
import {
  buildResearchWaveArchivePrompt,
  buildResearchWaveRepairPrompt,
  createResearchWaveAliasContext,
  finalizeResearchWavePackets,
  getResearchClaimSignature,
  isCommittedCheckpointToolCall,
  parseResearchWavePackets,
  sanitizeCheckpointToolCall,
  RESEARCH_WAVE_RESPONSE_FORMAT,
  type LearningPacket,
} from "@/lib/research";
import { isStructuredOutputCapabilityError } from "@/lib/chat/responseFormat";
import { logDevError } from "@/lib/utils/devLogger";
import {
  parseModelString,
  resolveProviderModelMetadata,
  supportsStructuredOutput,
} from "@/lib/utils/model";
import { streamChatResponse } from "@/services/api/chatService";

import { isAbortError } from "../operations";
import type { ResearchWaveContext, ResearchWaveEvidence } from "./waveContext";

/**
 * Turns the wave's committed history into structured learning packets with a
 * closed-book pass, repairing at most once before degrading the wave.
 */
export async function archiveWave(
  wave: ResearchWaveContext,
  collected: ResearchWaveEvidence,
): Promise<ReturnType<typeof finalizeResearchWavePackets>> {
  const { ctx } = wave;
  const { controller, chatConfig, effective, settings } = ctx;
  const aliases = createResearchWaveAliasContext({
    run: wave.activeRun,
    nodeIds: wave.nodeIds,
    evidence: collected.evidence,
    preferredEvidenceIds: collected.newEvidenceIds,
  });
  const waveParseOptions = {
    aliases,
    existingClaimSignatures: Object.fromEntries(
      wave.activeRun.claims.map((claim) => [
        claim.id,
        getResearchClaimSignature(claim.stepId, claim.text),
      ]),
    ),
  } satisfies Parameters<typeof parseResearchWavePackets>[1];
  const { providerId, modelName } = parseModelString(ctx.researchModel);
  const modelMetadata = resolveProviderModelMetadata({
    providerId,
    modelName,
    modelMetadata: settings.modelMetadata,
    customModelMetadata: settings.customModelMetadata,
  });
  const nativeResponseFormat = supportsStructuredOutput(modelMetadata)
    ? RESEARCH_WAVE_RESPONSE_FORMAT
    : undefined;
  let nativeResponseFormatAvailable = Boolean(nativeResponseFormat);
  const committedToolCalls = wave.latestToolCalls
    .filter(isCommittedCheckpointToolCall)
    .map(sanitizeCheckpointToolCall);
  const archiveAt = Date.now();
  const archiveHistory: Message[] = [
    {
      id: uuidv7(),
      role: "user",
      content: wave.wavePrompt,
      timestamp: Math.max(0, archiveAt - 1),
    },
    {
      id: uuidv7(),
      role: "model",
      content: wave.latestContent || "Tool work completed.",
      ...(committedToolCalls.length ? { toolCalls: committedToolCalls } : {}),
      timestamp: archiveAt,
    },
  ];
  const requestClosedBookArchive = async ({
    history,
    prompt,
  }: {
    history: Message[];
    prompt: string;
  }) => {
    const request = async (useNativeSchema: boolean) => {
      let content = "";
      content = await streamChatResponse(
        ctx.task.sessionId,
        ctx.researchModel,
        history,
        prompt,
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
          content = text;
        },
        `${effective.systemInstruction}\n\nThis is a host-controlled closed-book Research archive. Tools and source access are disabled. Use only committed history and host aliases.`,
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
          ...(useNativeSchema && nativeResponseFormat
            ? { responseFormat: nativeResponseFormat }
            : {}),
        },
      );
      return content;
    };
    if (!nativeResponseFormatAvailable) return request(false);
    try {
      return await request(true);
    } catch (error) {
      if (!isStructuredOutputCapabilityError(error)) throw error;
      nativeResponseFormatAvailable = false;
      return request(false);
    }
  };

  const archivePrompt = buildResearchWaveArchivePrompt({
    task: ctx.store.tasksById[ctx.taskId],
    plan: ctx.plan,
    run: wave.activeRun,
    aliases,
  });
  const archivedContent = await requestClosedBookArchive({
    history: archiveHistory,
    prompt: archivePrompt,
  });
  controller.signal.throwIfAborted();
  const parsedArchive = parseResearchWavePackets(
    archivedContent,
    waveParseOptions,
  );
  let repairedPackets: LearningPacket[] = [];
  const repairNodeKeys = parsedArchive.valid
    ? []
    : Array.from(
        new Set([
          ...parsedArchive.missingNodeKeys,
          ...parsedArchive.invalidNodeKeys,
        ]),
      );
  let repairIssues = parsedArchive.valid ? [] : parsedArchive.error.issues;
  if (repairNodeKeys.length > 0) {
    let repairedContent = "";
    try {
      repairedContent = await requestClosedBookArchive({
        history: [
          ...archiveHistory,
          {
            id: uuidv7(),
            role: "model",
            content: archivedContent,
            timestamp: Date.now(),
          },
        ],
        prompt: buildResearchWaveRepairPrompt({
          invalidOutput: archivedContent,
          issues: repairIssues,
          aliases,
          requestedNodeKeys: repairNodeKeys,
        }),
      });
      controller.signal.throwIfAborted();
      const parsedRepair = parseResearchWavePackets(repairedContent, {
        ...waveParseOptions,
        requestedNodeKeys: repairNodeKeys,
        existingClaimSignatures: {
          ...waveParseOptions.existingClaimSignatures,
          ...Object.fromEntries(
            parsedArchive.data.flatMap((packet) =>
              packet.learnings.map((learning) => [
                learning.claimId,
                getResearchClaimSignature(learning.stepId, learning.claimText),
              ]),
            ),
          ),
        },
      });
      repairedPackets = parsedRepair.data;
      if (!parsedRepair.valid) {
        repairIssues = parsedRepair.error.issues;
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
      logDevError("Deep Research wave packet repair failed", error);
      repairIssues = [
        ...repairIssues,
        error instanceof Error ? error.message : String(error),
      ];
    }
  }
  const finalizedPackets = finalizeResearchWavePackets({
    aliases,
    initialPackets: parsedArchive.data,
    repairedPackets,
  });
  if (finalizedPackets.degradedNodeIds.length > 0) {
    logDevError("Deep Research wave archive degraded", {
      degradedNodeIds: finalizedPackets.degradedNodeIds,
      issues: repairIssues.slice(0, 40),
    });
  }
  return finalizedPackets;
}
