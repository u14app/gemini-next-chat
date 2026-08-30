import {
  isCommittedCheckpointToolCall,
  redactCheckpointText,
  sanitizeCheckpointToolCall,
  type ResearchTask,
  type SavedResearchCheckpoint,
} from "@/lib/research";
import { readWorkspaceText } from "@/services/workspace/sessionWorkspace";

export async function readCheckpoint(
  task: ResearchTask,
): Promise<SavedResearchCheckpoint | null> {
  const path = task.checkpoint?.historyPath;
  if (!path) return null;
  const result = await readWorkspaceText(task.sessionId, path);
  if (!result.ok) return null;
  try {
    const parsed = JSON.parse(result.value.content) as SavedResearchCheckpoint;
    return parsed?.version === 1 && parsed.taskId === task.id
      ? {
          ...parsed,
          prompt: redactCheckpointText(parsed.prompt || ""),
          partialContent: redactCheckpointText(parsed.partialContent || ""),
          toolCalls: Array.isArray(parsed.toolCalls)
            ? parsed.toolCalls
                .filter(isCommittedCheckpointToolCall)
                .map(sanitizeCheckpointToolCall)
            : [],
          outputBlocks: [],
        }
      : null;
  } catch {
    return null;
  }
}
