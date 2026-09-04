import { redactSensitiveToolArgs } from "@/lib/plugin/confirmation";
import {
  createResearchToolResultExcerpt,
  RESEARCH_TOOL_RESULT_LIMITS,
} from "@/lib/research/toolResultContent";
import { writeWorkspaceText } from "@/services/workspace/sessionWorkspace";

/** Research retains a replayable result before the execution is committed. */
export async function prepareResearchResultHistory(
  sessionId: string,
  callId: string,
  result: unknown,
) {
  const value = redactSensitiveToolArgs(result);
  const serialized = JSON.stringify(value);
  if (serialized.length <= RESEARCH_TOOL_RESULT_LIMITS.inlineChars)
    return { value };
  const safeCallId = callId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  const excerpt = createResearchToolResultExcerpt(value);
  if (!safeCallId) return { value: excerpt };
  const path = `tool-results/${safeCallId}.json`;
  const written = await writeWorkspaceText(
    sessionId,
    path,
    serialized,
    "create",
  );
  if (!written.ok)
    return {
      value: {
        ...excerpt,
        warning: "The full committed result could not be persisted.",
      },
    };
  return {
    value: {
      ...excerpt,
      workspacePath: path,
      contentHash: written.value.contentHash,
      revision: written.value.revision,
    },
    resultRef: {
      kind: "workspace_file" as const,
      id: path,
      contentHash: written.value.contentHash,
    },
  };
}
