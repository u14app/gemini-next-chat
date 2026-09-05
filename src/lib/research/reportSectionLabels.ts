export const DEFAULT_REPORT_SECTION_LABELS = {
  executiveSummary: "Executive summary",
  keyFindings: "Key findings",
  planCoverage: "Research plan coverage",
  evidenceGaps: "Evidence gaps",
  sources: "Sources",
  knowledgeSupplement: "Knowledge supplement (not verified in this research)",
  unverifiedMaterial: "Unverified supplied material",
  questionsToVerify: "Questions still to verify",
  questionCoverage: "Research question coverage",
} as const;

export type ReportSectionKey = keyof typeof DEFAULT_REPORT_SECTION_LABELS;
export type ReportSectionLabels = Record<ReportSectionKey, string>;

const aliases: Record<ReportSectionKey, readonly string[]> = {
  executiveSummary: ["执行摘要", "摘要", "エグゼクティブサマリー", "要約"],
  keyFindings: [
    "关键发现",
    "主要发现",
    "核心发现",
    "主な調査結果",
    "主要な調査結果",
  ],
  planCoverage: [
    "研究计划覆盖",
    "研究计划覆盖情况",
    "研究计划完成情况",
    "調査計画のカバレッジ",
    "調査計画の網羅状況",
  ],
  evidenceGaps: ["证据缺口", "证据不足", "エビデンスギャップ", "証拠の不足"],
  sources: ["来源", "资料来源", "参考来源", "情報源", "出典"],
  knowledgeSupplement: [
    "Knowledge supplement",
    "知识补充",
    "模型知识补充",
    "知识补充（本次研究未验证）",
    "知识补充（本次研究未核验）",
    "知識の補足",
    "知識補足",
    "知識の補足（本調査では未検証）",
  ],
  unverifiedMaterial: [
    "未验证的已提供材料",
    "未核验的已提供材料",
    "未验证资料",
    "未検証の提供資料",
  ],
  questionsToVerify: [
    "待验证问题",
    "待核验问题",
    "今後検証すべき問い",
    "未検証の問い",
  ],
  questionCoverage: ["研究问题覆盖", "研究问题覆盖情况", "調査質問の網羅状況"],
};

function normalizeLabel(label: string): string {
  return label
    .normalize("NFKC")
    .replace(/[*_`]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const sectionKeys = Object.keys(
  DEFAULT_REPORT_SECTION_LABELS,
) as ReportSectionKey[];
const keyByLabel = new Map(
  sectionKeys.flatMap((key) =>
    [key, DEFAULT_REPORT_SECTION_LABELS[key], ...aliases[key]].map(
      (label) => [normalizeLabel(label), key] as const,
    ),
  ),
);

export function reportSectionKey(label: string): ReportSectionKey | undefined {
  return keyByLabel.get(normalizeLabel(label));
}

/** Semantic identity is independent of the language used in the document. */
export function reportSectionIdentity(label: string): string {
  return reportSectionKey(label) ?? normalizeLabel(label);
}

export function createReportSectionLabels(
  translate: (key: `report.sections.${ReportSectionKey}`) => string,
): ReportSectionLabels {
  return Object.fromEntries(
    sectionKeys.map((key) => {
      const translationKey = `report.sections.${key}` as const;
      const label = translate(translationKey);
      return [
        key,
        label === translationKey ? DEFAULT_REPORT_SECTION_LABELS[key] : label,
      ];
    }),
  ) as ReportSectionLabels;
}
