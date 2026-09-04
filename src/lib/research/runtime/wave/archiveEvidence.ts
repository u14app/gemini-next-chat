import type { ToolCall } from "@/types";
import { hashToolArguments } from "@/lib/agent/toolArguments";
import { redactSensitiveToolArgs } from "@/lib/plugin/confirmation";
import { getCurrentResearchReportRunIds } from "@/lib/research/task";
import { isCommittedCheckpointToolCall } from "@/lib/research/checkpointCodec";
import { createResearchWaveSourceReferenceResolver } from "@/lib/research/prompts/waveAliases";
import type { ResearchWaveAliasContext } from "@/lib/research/prompts/types";
import {
  allocateResearchExcerptChars,
  clipResearchJsonText,
  extractResearchSourceBodies,
  RESEARCH_TOOL_RESULT_LIMITS,
  type ResearchSourceBody,
} from "@/lib/research/toolResultContent";
import { useAgentRunStore } from "@/store/core/agentRunStore";
import { readCommittedResearchToolResult } from "../readLocalResearchJson";
import type { ResearchWaveContext, ResearchWaveEvidence } from "./waveContext";

interface SourceMaterial extends ResearchSourceBody {
  sourceKey: string;
}
interface ToolMaterial {
  id: string;
  name: string;
  sources: SourceMaterial[];
}

/** Resolve only committed results associated with this task's current report. */
export async function loadResearchArchiveMaterial(
  wave: ResearchWaveContext,
  collected: ResearchWaveEvidence,
  aliases: ResearchWaveAliasContext,
): Promise<ToolMaterial[]> {
  const { ctx } = wave;
  const task = ctx.store.tasksById[ctx.taskId];
  const allowedRunIds = new Set(getCurrentResearchReportRunIds(task));
  const runs = useAgentRunStore.getState().runsById;
  const candidates = new Map<
    string,
    { runId: string; callId: string; call?: ToolCall }
  >();
  for (const call of wave.latestToolCalls.filter(
    isCommittedCheckpointToolCall,
  )) {
    candidates.set(`${wave.agentRunId}/${call.id}`, {
      runId: wave.agentRunId,
      callId: call.id,
      call,
    });
  }
  const evidenceIds = new Set(
    aliases.sources.flatMap((source) => source.evidenceIds),
  );
  for (const evidence of collected.evidence) {
    if (
      !evidenceIds.has(evidence.id) ||
      !evidence.agentRunId ||
      !evidence.toolCallId
    )
      continue;
    const key = `${evidence.agentRunId}/${evidence.toolCallId}`;
    if (!candidates.has(key))
      candidates.set(key, {
        runId: evidence.agentRunId,
        callId: evidence.toolCallId,
      });
  }
  const resolveSource = createResearchWaveSourceReferenceResolver(
    aliases.sources,
  );
  const materials: ToolMaterial[] = [];
  for (const candidate of candidates.values()) {
    ctx.controller.signal.throwIfAborted();
    if (!allowedRunIds.has(candidate.runId)) continue;
    const run = runs[candidate.runId];
    if (!run || run.sessionId !== task.sessionId) continue;
    const execution = run.toolExecutions.find(
      (item) => item.callId === candidate.callId && item.status === "committed",
    );
    if (!execution) continue;
    let result = candidate.call?.result;
    const fileRefs =
      execution.resultRefs?.filter(
        (reference) => reference.kind === "workspace_file",
      ) || [];
    if (fileRefs.length > 0) {
      // An invalid full-result reference cannot silently fall back to unchecked text.
      result = undefined;
      for (const reference of fileRefs) {
        const loaded = await readCommittedResearchToolResult({
          sessionId: task.sessionId,
          run,
          callId: candidate.callId,
          reference,
          signal: ctx.controller.signal,
        });
        if (loaded.ok) {
          result = loaded.value;
          break;
        }
      }
    } else if (result !== undefined) {
      const cacheRefs =
        execution.resultRefs?.filter(
          (reference) => reference.kind === "tool_cache",
        ) || [];
      if (
        cacheRefs.length &&
        !cacheRefs.some((reference) => reference.contentHash)
      )
        result = undefined;
      else if (cacheRefs.length) {
        const hash = await hashToolArguments(result);
        if (!cacheRefs.some((reference) => reference.contentHash === hash))
          result = undefined;
      }
    }
    const registeredSourceIds = new Set(
      run.evidence
        .filter(
          (item) =>
            item.toolCallId === candidate.callId &&
            item.retrievalKind !== "search",
        )
        .map((item) => item.sourceId),
    );
    const sources = extractResearchSourceBodies(
      redactSensitiveToolArgs(result),
    ).flatMap((body): SourceMaterial[] => {
      if (!registeredSourceIds.has(body.sourceId)) return [];
      const resolved = resolveSource(body.sourceId);
      return "key" in resolved ? [{ ...body, sourceKey: resolved.key }] : [];
    });
    if (sources.length)
      materials.push({
        id: execution.callId,
        name: execution.toolName,
        sources,
      });
  }
  // The longest committed excerpt for an alias wins; do not duplicate bodies.
  const selected = new Map<
    string,
    { material: ToolMaterial; source: SourceMaterial }
  >();
  for (const material of materials)
    for (const source of material.sources) {
      const previous = selected.get(source.sourceKey);
      if (!previous || previous.source.text.length < source.text.length)
        selected.set(source.sourceKey, { material, source });
    }
  return materials.flatMap((material) => {
    const sources = material.sources.filter(
      (source) => selected.get(source.sourceKey)?.source === source,
    );
    return sources.length ? [{ ...material, sources }] : [];
  });
}

/** A bounded model view; the replayable tool results themselves are never edited. */
export function projectResearchArchiveMaterial(
  materials: readonly ToolMaterial[],
  maxChars: number,
) {
  const limit = Math.max(
    0,
    Math.min(RESEARCH_TOOL_RESULT_LIMITS.archiveChars, Math.floor(maxChars)),
  );
  let calls: ToolCall[] = materials.map((material) => ({
    id: material.id,
    name: material.name,
    args: {},
    status: "success",
    isError: false,
    result: {
      ok: true,
      trust: "external_untrusted",
      provenance: { origin: "runtime", toolName: material.name },
      data: {
        bodyStatus: "excerpt",
        sources: material.sources.map((source) => ({
          sourceKey: source.sourceKey,
          text: "",
          truncated: true,
          ...(source.coverage
            ? { coverage: source.coverage.slice(0, 200) }
            : {}),
          ...(source.missing?.length
            ? {
                missing: source.missing
                  .slice(0, 3)
                  .map((item) => item.slice(0, 100)),
              }
            : {}),
        })),
      },
    },
  }));
  // Optional coverage metadata must not crowd all source text out of a tool.
  calls.forEach((call) => {
    if (
      JSON.stringify(call).length <
      RESEARCH_TOOL_RESULT_LIMITS.inlineChars / 2
    )
      return;
    const result = call.result as { data: { sources: SourceMaterial[] } };
    result.data.sources.forEach((source) => {
      delete source.coverage;
      delete source.missing;
    });
  });
  const included: number[] = [];
  let baseTotal = 2;
  calls = calls.filter((call, index) => {
    const size = JSON.stringify(call).length;
    const minimumBodyChars = materials[index].sources.length;
    if (
      size + minimumBodyChars > RESEARCH_TOOL_RESULT_LIMITS.inlineChars ||
      baseTotal + size + minimumBodyChars + 1 > limit
    )
      return false;
    included.push(index);
    baseTotal += size + minimumBodyChars + 1;
    return true;
  });
  const selectedMaterials = included.map((index) => materials[index]);
  const baseSizes = calls.map((call) => JSON.stringify(call).length);
  const toolSizes = allocateResearchExcerptChars(
    selectedMaterials.map((material, index) =>
      Math.min(
        RESEARCH_TOOL_RESULT_LIMITS.inlineChars - baseSizes[index],
        material.sources.reduce(
          (sum, source) => sum + JSON.stringify(source.text).length,
          0,
        ),
      ),
    ),
    limit - JSON.stringify(calls).length,
  );
  const availableSourceKeys = new Set<string>();
  calls.forEach((call, index) => {
    const result = call.result as {
      data: {
        sources: { sourceKey: string; text: string; truncated: boolean }[];
      };
    };
    const sourceSizes = allocateResearchExcerptChars(
      selectedMaterials[index].sources.map(
        (source) => JSON.stringify(source.text).length,
      ),
      toolSizes[index],
    );
    result.data.sources.forEach((source, sourceIndex) => {
      const original = selectedMaterials[index].sources[sourceIndex];
      source.text = clipResearchJsonText(
        original.text,
        sourceSizes[sourceIndex],
      );
      source.truncated =
        original.truncated || source.text.length < original.text.length;
      if (source.text.trim()) availableSourceKeys.add(source.sourceKey);
      Object.freeze(source);
    });
    Object.freeze(result.data.sources);
    Object.freeze(result.data);
    Object.freeze(result);
    Object.freeze(call.args);
    Object.freeze(call);
  });
  return { calls: Object.freeze(calls), availableSourceKeys };
}
