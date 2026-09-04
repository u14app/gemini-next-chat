import { isToolResultEnvelope } from "@/lib/agent/toolResult";
import { redactSensitiveToolArgs } from "@/lib/plugin/confirmation";

export const RESEARCH_TOOL_RESULT_LIMITS = {
  inlineChars: 8_000,
  archiveChars: 48_000,
  checkpointResultChars: 48_000,
} as const;

export interface ResearchSourceBody {
  sourceId: string;
  text: string;
  truncated: boolean;
  coverage?: string;
  missing?: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

/** Accept the concrete read-result shapes, never infer source identity from URLs. */
export function extractResearchSourceBodies(
  value: unknown,
): ResearchSourceBody[] {
  if (isToolResultEnvelope(value)) {
    if (!value.ok) return [];
    value = value.data;
  }
  if (!isRecord(value) || value.ok === false) return [];
  if (Array.isArray(value.researchSourceExcerpts)) {
    return value.researchSourceExcerpts
      .slice(0, 80)
      .flatMap((item) =>
        isRecord(item) &&
        typeof item.sourceId === "string" &&
        typeof item.text === "string"
          ? [{ sourceId: item.sourceId, text: item.text, truncated: true }]
          : [],
      );
  }
  const candidates = Array.isArray(value.sources)
    ? value.sources
    : Array.isArray(value.results)
      ? value.results
      : [value];
  const bodies = candidates
    .slice(0, 80)
    .flatMap((item): ResearchSourceBody[] => {
      if (!isRecord(item) || item.ok === false) return [];
      const metadata = isRecord(item.metadata) ? item.metadata : item;
      const sourceId =
        typeof metadata.sourceId === "string" ? metadata.sourceId : undefined;
      const text =
        typeof item.content === "string"
          ? item.content
          : typeof item.excerpt === "string"
            ? item.excerpt
            : undefined;
      if (!sourceId || !text?.trim()) return [];
      const coverage = item.coverage ?? metadata.coverage;
      const missing = item.missing ?? metadata.missing;
      return [
        {
          sourceId,
          text,
          truncated:
            item.truncated === true ||
            metadata.truncated === true ||
            typeof item.content !== "string",
          ...(typeof coverage === "string"
            ? { coverage: coverage.slice(0, 1_000) }
            : {}),
          ...(Array.isArray(missing)
            ? {
                missing: missing
                  .filter((entry): entry is string => typeof entry === "string")
                  .slice(0, 20)
                  .map((entry) => entry.slice(0, 500)),
              }
            : {}),
        },
      ];
    });
  if (bodies.length > 0) return bodies;
  const evidence = value._researchEvidence;
  if (!isRecord(evidence) || typeof evidence.sourceId !== "string") return [];
  const { _researchEvidence: _metadata, ...body } = value;
  void _metadata;
  return [
    {
      sourceId: evidence.sourceId,
      text: JSON.stringify(body),
      truncated: false,
    },
  ];
}

/** Distribute space fairly, returning unused shares to longer source excerpts. */
export function allocateResearchExcerptChars(
  lengths: readonly number[],
  maxChars: number,
): number[] {
  const allocated = lengths.map(() => 0);
  let remaining = Math.max(0, Math.floor(maxChars));
  while (remaining > 0) {
    const pending = lengths.flatMap((length, index) =>
      allocated[index] < length ? [index] : [],
    );
    if (pending.length === 0) break;
    const share = Math.max(1, Math.floor(remaining / pending.length));
    for (const index of pending) {
      const count = Math.min(
        share,
        remaining,
        lengths[index] - allocated[index],
      );
      allocated[index] += count;
      remaining -= count;
      if (remaining === 0) break;
    }
  }
  return allocated;
}

/** Count escaped JSON characters as well as source characters. */
export function clipResearchJsonText(text: string, maxChars: number): string {
  let low = 0;
  let high = Math.min(text.length, Math.max(0, Math.floor(maxChars)));
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (JSON.stringify(text.slice(0, middle)).length - 2 <= maxChars)
      low = middle;
    else high = middle - 1;
  }
  return text.slice(0, low);
}

/** A structured fallback retains identities even if a full result cannot be saved. */
export function createResearchToolResultExcerpt(value: unknown) {
  const bodies = extractResearchSourceBodies(redactSensitiveToolArgs(value));
  const excerpt = {
    bodyStatus: bodies.length ? "excerpt" : "body_unavailable",
    truncated: true,
    researchSourceExcerpts: bodies.map((body) => ({
      sourceId: body.sourceId,
      text: "",
      truncated: true,
    })),
  };
  // Leave space for the enclosing result's reference or persistence warning.
  const limit = RESEARCH_TOOL_RESULT_LIMITS.inlineChars - 500;
  while (JSON.stringify(excerpt).length > limit)
    excerpt.researchSourceExcerpts.pop();
  const lengths = allocateResearchExcerptChars(
    bodies
      .slice(0, excerpt.researchSourceExcerpts.length)
      .map((body) => JSON.stringify(body.text).length - 2),
    limit - JSON.stringify(excerpt).length,
  );
  excerpt.researchSourceExcerpts.forEach((source, index) => {
    source.text = clipResearchJsonText(bodies[index].text, lengths[index]);
  });
  if (!excerpt.researchSourceExcerpts.some((source) => source.text.trim()))
    excerpt.bodyStatus = "body_unavailable";
  return excerpt;
}
