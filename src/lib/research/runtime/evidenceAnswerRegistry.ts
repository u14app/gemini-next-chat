// Kept independent from report parsing so unload cancellation stays synchronous.
export interface LiveAnswer {
  requestId: string;
  text: string;
}
export interface AnswerOperation {
  taskId: string;
  requestId: string;
  controller: AbortController;
  live: LiveAnswer;
}
export const evidenceAnswerOperations = new Map<string, AnswerOperation>();
const listeners = new Set<() => void>();
export const notifyEvidenceAnswers = () =>
  listeners.forEach((listener) => listener());
export function subscribeEvidenceAnswers(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function getLiveEvidenceAnswer(
  threadId: string | null,
): LiveAnswer | null {
  return threadId
    ? (evidenceAnswerOperations.get(threadId)?.live ?? null)
    : null;
}
export function cancelAllEvidenceAnswers(taskId?: string) {
  for (const operation of evidenceAnswerOperations.values()) {
    if (!taskId || operation.taskId === taskId) operation.controller.abort();
  }
}
