import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { canonicalizeResearchLocator } from "./evidence";
import type {
  ClaimRecord,
  ResearchEvidence,
  ResearchReportVersion,
  ResearchTask,
} from "./types";

export interface ResearchEvidenceSnapshot {
  schemaVersion: 1;
  id: string;
  taskId: string;
  sessionId: string;
  reportId: string;
  runId: string;
  artifactId: string;
  reportMarkdown: string;
  gaps: string[];
  evidence: ResearchEvidence[];
  claims: ClaimRecord[];
  /** Lowercase citation labels mapped only to evidence belonging to this version. */
  citations: Record<string, string[]>;
  createdAt: number;
  origin: "publication" | "legacy_reconstruction";
}

export type EvidenceAnswerStatus =
  "generating" | "completed" | "failed" | "cancelled" | "interrupted";
export interface ResearchEvidenceTurn {
  id: string;
  requestId: string;
  question: string;
  answer: string;
  status: EvidenceAnswerStatus;
  createdAt: number;
  finishedAt?: number;
  model?: string;
  errorCode?: string;
}

export interface ResearchEvidenceThread {
  schemaVersion: 1;
  id: string;
  taskId: string;
  sessionId: string;
  reportId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: ResearchEvidenceTurn[];
}

/** Copy the report's own records. Later task refreshes must not mutate this scope. */
export function createResearchEvidenceSnapshot({
  task,
  report,
  markdown,
  origin = "publication",
}: {
  task: ResearchTask;
  report: ResearchReportVersion;
  markdown: string;
  origin?: ResearchEvidenceSnapshot["origin"];
}): ResearchEvidenceSnapshot {
  const run = task.reportRuns.find(
    (candidate) => candidate.id === report.researchRunId,
  );
  const ids = new Set(report.evidenceIds ?? []);
  if (!report.evidenceIds) {
    run?.nodes.forEach((node) => node.evidenceIds.forEach((id) => ids.add(id)));
    run?.claims.forEach((claim) =>
      [
        ...claim.supportingEvidenceIds,
        ...claim.contradictingEvidenceIds,
      ].forEach((id) => ids.add(id)),
    );
  }
  const evidence = task.evidence.filter((item) => ids.has(item.id));
  const allowedIds = new Set(evidence.map((item) => item.id));
  const claims = (run?.claims ?? []).map((claim) => ({
    ...claim,
    supportingEvidenceIds: claim.supportingEvidenceIds.filter((id) =>
      allowedIds.has(id),
    ),
    contradictingEvidenceIds: claim.contradictingEvidenceIds.filter((id) =>
      allowedIds.has(id),
    ),
  }));
  return structuredClone({
    schemaVersion: 1,
    id: report.id,
    taskId: task.id,
    sessionId: task.sessionId,
    reportId: report.id,
    runId: report.researchRunId,
    artifactId: report.artifactId,
    reportMarkdown: markdown,
    gaps: [...report.gaps],
    evidence,
    claims,
    citations: buildEvidenceCitationMap(markdown, evidence, task.evidence),
    createdAt: report.createdAt,
    origin,
  });
}

interface MarkdownNode {
  type?: string;
  url?: string;
  value?: string;
  identifier?: string;
  children?: MarkdownNode[];
}
const createMarkdownParser = () => unified().use(remarkParse).use(remarkGfm);
let markdownParser: ReturnType<typeof createMarkdownParser> | undefined;
function markdownNodes(markdown: string): MarkdownNode[] {
  markdownParser ??= createMarkdownParser();
  const nodes: MarkdownNode[] = [
    markdownParser.parse(markdown) as MarkdownNode,
  ];
  for (let index = 0; index < nodes.length; index++)
    if (nodes[index].children) nodes.push(...nodes[index].children!);
  return nodes;
}
function nodeText(node: MarkdownNode): string {
  return node.value ?? node.children?.map(nodeText).join("") ?? "";
}
export function buildEvidenceCitationMap(
  markdown: string,
  evidence: readonly ResearchEvidence[],
  publicationEvidence: readonly ResearchEvidence[] = evidence,
): Record<string, string[]> {
  const citations = new Map<string, Set<string>>();
  const add = (label: string, ids: string[]) => {
    const key = label.trim().toLowerCase();
    if (!key || !ids.length) return;
    citations.set(key, new Set([...(citations.get(key) ?? []), ...ids]));
  };
  for (const item of evidence)
    for (const label of [item.sourceId, ...(item.aliasSourceIds ?? [])])
      add(label, [item.id]);
  const allowedIds = new Set(evidence.map((item) => item.id));
  publicationEvidence.forEach((item, index) => {
    const label = `Source ${index + 1}`;
    if (
      allowedIds.has(item.id) &&
      !/^https?:\/\//i.test(item.locator) &&
      markdown.includes(`[${label}]`)
    )
      add(label, [item.id]);
  });
  const nodes = markdownNodes(markdown);
  const definitions = new Map(
    nodes
      .filter((node) => node.type === "definition")
      .map((node) => [node.identifier, node.url]),
  );
  for (const node of nodes) {
    const url =
      node.type === "link"
        ? node.url
        : node.type === "linkReference"
          ? definitions.get(node.identifier)
          : undefined;
    if (!url) continue;
    const locator = canonicalizeResearchLocator(url);
    const ids = evidence
      .filter((item) =>
        [item.locator, ...(item.aliasLocators ?? [])].some(
          (value) => canonicalizeResearchLocator(value) === locator,
        ),
      )
      .map((item) => item.id);
    add(nodeText(node), ids);
  }
  return Object.fromEntries(
    [...citations].map(([label, ids]) => [label, [...ids]]),
  );
}

/** Keep complete pairs only; interrupted text never becomes conversational evidence. */
export function selectEvidenceConversationHistory(
  turns: readonly ResearchEvidenceTurn[],
  maxChars = 16_000,
): ResearchEvidenceTurn[] {
  const selected: ResearchEvidenceTurn[] = [];
  let remaining = maxChars;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.status !== "completed") continue;
    const size = turn.question.length + turn.answer.length;
    if (size > remaining) break;
    selected.unshift(turn);
    remaining -= size;
  }
  return selected;
}

export function validateEvidenceAnswerCitations(
  answer: string,
  snapshot: ResearchEvidenceSnapshot,
): boolean {
  const locators = new Set(
    snapshot.evidence.flatMap((item) =>
      [item.locator, ...(item.aliasLocators ?? [])].map(
        canonicalizeResearchLocator,
      ),
    ),
  );
  const sourceIds = new Set(
    snapshot.evidence.flatMap((item) =>
      [item.sourceId, ...(item.aliasSourceIds ?? [])].map((id) =>
        id.toLowerCase(),
      ),
    ),
  );
  const nodes = markdownNodes(answer);
  const text: string[] = [];
  while (nodes.length) {
    const node = nodes.pop()!;
    if (["image", "imageReference", "html"].includes(node.type ?? ""))
      return false;
    if (node.type === "link" || node.type === "definition") {
      if (!node.url || !locators.has(canonicalizeResearchLocator(node.url)))
        return false;
    }
    if (node.type === "text" && node.value) text.push(node.value);
  }
  const prose = text.join("\n");
  const markers = Array.from(
    prose.matchAll(/\[(source-[^\]\s]+)\]/gi),
    (match) => match[1].toLowerCase(),
  );
  if (markers.some((marker) => !sourceIds.has(marker))) return false;
  const labels = Array.from(
    prose.matchAll(/\[(?:Source\s+\d+|C\d+)\]/gi),
    (match) => match[0],
  );
  const evidenceIds = new Set(snapshot.evidence.map((item) => item.id));
  return labels.every(
    (label) =>
      snapshot.citations?.[label.slice(1, -1).toLowerCase()]?.some((id) =>
        evidenceIds.has(id),
      ) ||
      snapshot.claims.some(
        (claim) => `[${claim.id}]`.toLowerCase() === label.toLowerCase(),
      ),
  );
}
