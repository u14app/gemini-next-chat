import type { ResearchTask } from "@/lib/research";

export interface ResearchViewModelText {
  artifactUnavailable: string;
  fallbackReportTitle: (version: number) => string;
  taskCreatedTitle: string;
  taskCreatedDetail: string;
  planPreparedTitle: (version: number) => string;
  planAdjustedDetail: string;
  planApprovalDetail: string;
  reportPublishedTitle: (version: number) => string;
  toolRunningTitle: (tool: string) => string;
  toolCommittedTitle: (tool: string) => string;
  toolFailedTitle: (tool: string) => string;
  toolSkippedTitle: (tool: string) => string;
  duplicateSkippedDetail: string;
  toolEffectUnknownTitle: (tool: string) => string;
  toolInterruptedTitle: (tool: string) => string;
  toolSourceDetail: (source: string) => string;
  internalToolResultSource: string;
  toolSafeDetail: string;
  degradedWaveTitle: (wave: number) => string;
  degradedWaveDetail: (count: number) => string;
  scopeExpansionTitle: string;
  scopeExpansionDetail: (scheduled: number) => string;
  scopeExpansionLimitedDetail: (count: number) => string;
  reportKind: Record<"initial" | "continue" | "update", string>;
  statusTitle: (status: ResearchTask["status"]) => string;
}

export const DEFAULT_TEXT: ResearchViewModelText = {
  artifactUnavailable: "The local report artifact is unavailable.",
  fallbackReportTitle: (version) => `Research report v${version}`,
  taskCreatedTitle: "Research task created",
  taskCreatedDetail:
    "Before approval, only bounded public search summaries may be used for planning reconnaissance; source bodies cannot become report evidence.",
  planPreparedTitle: (version) => `Plan v${version} prepared`,
  planAdjustedDetail: "Prepared from a natural-language adjustment.",
  planApprovalDetail: "Prepared for explicit approval.",
  reportPublishedTitle: (version) => `Report v${version} published`,
  toolRunningTitle: (tool) => `Using ${tool}`,
  toolCommittedTitle: (tool) => `Completed ${tool}`,
  toolFailedTitle: (tool) => `${tool} did not complete`,
  toolSkippedTitle: (tool) => `${tool}: duplicate query skipped`,
  duplicateSkippedDetail:
    "This query was already submitted. No additional search request was sent.",
  toolEffectUnknownTitle: (tool) => `${tool} result could not be confirmed`,
  toolInterruptedTitle: (tool) => `${tool} was interrupted`,
  toolSourceDetail: (source) => `Read-only source: ${source}`,
  internalToolResultSource: "Internal tool result",
  toolSafeDetail: "Read-only operation; raw arguments and results are hidden.",
  degradedWaveTitle: (wave) => `Round ${wave} archived with evidence gaps`,
  degradedWaveDetail: (count) =>
    `${count} research nodes produced no valid learning packet. Preserved evidence remains available and the report will continue with explicit gaps.`,
  scopeExpansionTitle: "Research scope expanded automatically",
  scopeExpansionDetail: (scheduled) =>
    `${scheduled} additional research directions will continue from committed evidence in this run.`,
  scopeExpansionLimitedDetail: (count) =>
    `${count} directions require sources that are unavailable in this conversation and will remain explicit report gaps.`,
  reportKind: {
    initial: "Initial report",
    continue: "Continued research",
    update: "Latest-source update",
  },
  statusTitle: (status) => `Research status: ${status}`,
};
