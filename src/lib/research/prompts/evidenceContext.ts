import type { ResearchEvidence } from "../types";

/**
 * Renders the committed evidence index shared by the wave, synthesis, and
 * evidence-question prompts. Preferred IDs are pinned first, then the newest
 * evidence fills the remaining budget.
 */
export function evidenceContext(
  evidence: readonly ResearchEvidence[],
  preferredEvidenceIds: readonly string[] = [],
): string {
  if (evidence.length === 0) return "No committed evidence yet.";
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const selected = new Map<string, ResearchEvidence>();
  for (const evidenceId of preferredEvidenceIds) {
    const item = evidenceById.get(evidenceId);
    if (item) selected.set(item.id, item);
  }
  for (const item of [...evidence].reverse()) {
    if (selected.size >= 200) break;
    selected.set(item.id, item);
  }
  return [...selected.values()]
    .slice(0, 200)
    .map(
      (item) =>
        `[${item.sourceId}] evidence=${item.id} step=${item.stepId} node=${item.nodeId} | ${item.title || "Untitled"} | ${item.locator} | retrieved ${new Date(item.retrievedAt).toISOString()} | freshness ${item.freshness || "unknown"} | availability ${item.availability || "available"} | hash ${item.contentHash}`,
    )
    .join("\n");
}
