export const DEFAULT_REPORT_FALLBACK_TEXT = {
  partialSummary:
    "This partial report includes findings supported by the available cited evidence. Some requested areas could not be completed.",
  unresolvedConflict: "contradicting evidence remains unresolved",
  unverifiedPrefix: "Unverified supplied material",
  citedFindingAvailable: "cited finding available",
  noCitedFinding: "no cited finding was produced",
  unverifiedArea:
    "This area remains unverified. The approved research questions below describe what still needs to be established.",
  retrieved: "retrieved",
  archiveMissing:
    "the research round did not produce a validated learning packet.",
  noFindings:
    "No evidence-supported finding was established during this research.",
  noQuestions: "No additional research question was recorded.",
  noEvidence: "No formal evidence committed.",
} as const;

export type ReportFallbackText = Record<
  keyof typeof DEFAULT_REPORT_FALLBACK_TEXT,
  string
>;

export function createReportFallbackText(
  translate: (key: `report.fallbackText.${keyof ReportFallbackText}`) => string,
): ReportFallbackText {
  return Object.fromEntries(
    Object.keys(DEFAULT_REPORT_FALLBACK_TEXT).map((name) => {
      const key = name as keyof ReportFallbackText;
      const translationKey = `report.fallbackText.${key}` as const;
      const label = translate(translationKey);
      return [
        key,
        label === translationKey ? DEFAULT_REPORT_FALLBACK_TEXT[key] : label,
      ];
    }),
  ) as ReportFallbackText;
}
