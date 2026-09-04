import type {
  ResearchDeliverableKind,
  ResearchPlanStepV2,
  ResearchSourcePriority,
  ResearchStrategy,
} from "./types";
import {
  RESEARCH_STRATEGY_PRESETS,
  resolveResearchStrategy,
} from "./orchestration";
import { normalizeResearchQuery } from "./orchestration/strategy";
import type { ResearchPlanDraftV2 } from "./prompts/types";

export const RESEARCH_TEMPLATE_SCHEMA_VERSION = 1 as const;

export type ResearchTemplateId =
  | "competitive-analysis"
  | "literature-review"
  | "due-diligence"
  | "technical-evaluation";

/** A portable, permission-free research plan preset. */
export interface ResearchTemplate {
  schemaVersion: typeof RESEARCH_TEMPLATE_SCHEMA_VERSION;
  id: string;
  name: string;
  description: string;
  deliverableKind: ResearchDeliverableKind;
  requiredSections: string[];
  sourcePriorities: ResearchSourcePriority[];
  strategy: ResearchStrategy;
  revision: number;
  builtIn?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

/** The first template selected for a task is immutable for that task. */
export interface ResearchTaskTemplateSnapshot {
  template: ResearchTemplate | null;
  capturedAt: number;
}

export type ResearchTemplateSelection = ResearchTemplate | null | undefined;

const TEMPLATE_NAME_LIMIT = 160;
const TEMPLATE_DESCRIPTION_LIMIT = 2_000;
const TEMPLATE_SECTION_LIMIT = 500;
const TEMPLATE_MAX_SECTIONS = 12;
const TEMPLATE_MAX_PRIORITIES = 6;
const TEMPLATE_ID_LIMIT = 160;

const BUILTIN_TEMPLATE_IDS = new Set<ResearchTemplateId>([
  "competitive-analysis",
  "literature-review",
  "due-diligence",
  "technical-evaluation",
]);

const cloneStrategy = (strategy: ResearchStrategy): ResearchStrategy => ({
  initialBreadth: strategy.initialBreadth,
  maxDepth: strategy.maxDepth,
  maxQueries: strategy.maxQueries,
  resultsPerQuery: strategy.resultsPerQuery,
});

const clonePriority = (
  priority: ResearchSourcePriority,
): ResearchSourcePriority => ({
  sourceType: priority.sourceType,
  priority: priority.priority,
  ...(priority.rationale ? { rationale: priority.rationale } : {}),
});

export function cloneResearchTemplate(
  template: ResearchTemplate,
): ResearchTemplate {
  return {
    ...template,
    requiredSections: [...template.requiredSections],
    sourcePriorities: template.sourcePriorities.map(clonePriority),
    strategy: cloneStrategy(template.strategy),
  };
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim().slice(0, max);
  return result || undefined;
}

function uniqueTextList(value: unknown, maxItems: number, maxChars: number) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const normalized = text(item, maxChars);
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= maxItems) break;
  }
  return result;
}

function normalizeSourcePriorities(value: unknown): ResearchSourcePriority[] {
  if (!Array.isArray(value)) return [];
  const byType = new Map<
    ResearchSourcePriority["sourceType"],
    ResearchSourcePriority
  >();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const candidate = item as Record<string, unknown>;
    const sourceType = candidate.sourceType;
    const priority = candidate.priority;
    if (
      sourceType !== "web" &&
      sourceType !== "knowledge" &&
      sourceType !== "attachment" &&
      sourceType !== "workspace" &&
      sourceType !== "plugin" &&
      sourceType !== "mcp"
    ) {
      continue;
    }
    if (priority !== "high" && priority !== "medium" && priority !== "low") {
      continue;
    }
    const rationale = text(candidate.rationale, 1_000);
    byType.set(sourceType, {
      sourceType,
      priority,
      ...(rationale ? { rationale } : {}),
    });
    if (byType.size >= TEMPLATE_MAX_PRIORITIES) break;
  }
  return [...byType.values()];
}

export function normalizeResearchTemplateId(
  value: unknown,
): string | undefined {
  const id = text(value, TEMPLATE_ID_LIMIT);
  return id && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id) ? id : undefined;
}

function normalizeRevision(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 1;
}

/**
 * Normalizes templates from extension storage, profile snapshots, or
 * imported files. Template data has no capability or budget fields beyond
 * the bounded strategy values used by the existing research runtime.
 */
export function normalizeResearchTemplate(
  value: unknown,
): ResearchTemplate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const id = normalizeResearchTemplateId(raw.id);
  const name = text(raw.name, TEMPLATE_NAME_LIMIT);
  const description = text(raw.description, TEMPLATE_DESCRIPTION_LIMIT);
  const deliverableKind = raw.deliverableKind;
  const requiredSections = uniqueTextList(
    raw.requiredSections,
    TEMPLATE_MAX_SECTIONS,
    TEMPLATE_SECTION_LIMIT,
  );
  const sourcePriorities = normalizeSourcePriorities(raw.sourcePriorities);
  if (
    raw.schemaVersion !== RESEARCH_TEMPLATE_SCHEMA_VERSION ||
    !id ||
    !name ||
    !description ||
    (deliverableKind !== "research_report" &&
      deliverableKind !== "comparison" &&
      deliverableKind !== "decision_memo" &&
      deliverableKind !== "exact_answer") ||
    requiredSections.length === 0 ||
    sourcePriorities.length === 0
  ) {
    return null;
  }
  return {
    schemaVersion: RESEARCH_TEMPLATE_SCHEMA_VERSION,
    id,
    name,
    description,
    deliverableKind,
    requiredSections,
    sourcePriorities,
    strategy: resolveResearchStrategy(
      "standard",
      raw.strategy && typeof raw.strategy === "object"
        ? (raw.strategy as Partial<ResearchStrategy>)
        : {},
    ),
    revision: normalizeRevision(raw.revision),
    ...(raw.builtIn === true ||
    BUILTIN_TEMPLATE_IDS.has(id as ResearchTemplateId)
      ? { builtIn: true }
      : {}),
    ...(typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
      ? { createdAt: raw.createdAt }
      : {}),
    ...(typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
      ? { updatedAt: raw.updatedAt }
      : {}),
  };
}

function builtinTemplate({
  id,
  name,
  description,
  deliverableKind,
  requiredSections,
  sourcePriorities,
}: Omit<
  ResearchTemplate,
  "schemaVersion" | "strategy" | "revision" | "builtIn"
>): ResearchTemplate {
  return {
    schemaVersion: RESEARCH_TEMPLATE_SCHEMA_VERSION,
    id,
    name,
    description,
    deliverableKind,
    requiredSections: [...requiredSections],
    sourcePriorities: sourcePriorities.map(clonePriority),
    strategy: cloneStrategy(RESEARCH_STRATEGY_PRESETS.standard),
    revision: 1,
    builtIn: true,
  };
}

export const BUILTIN_RESEARCH_TEMPLATES: readonly ResearchTemplate[] = [
  builtinTemplate({
    id: "competitive-analysis",
    name: "Competitive analysis",
    description:
      "Compare competitors against explicit criteria and surface meaningful gaps and opportunities.",
    deliverableKind: "comparison",
    requiredSections: [
      "Comparison criteria",
      "Comparison matrix",
      "Differences and opportunities",
      "Conclusion",
    ],
    sourcePriorities: [
      {
        sourceType: "web",
        priority: "high",
        rationale: "Prefer official first-party material.",
      },
      {
        sourceType: "plugin",
        priority: "medium",
        rationale: "Use specialist directories when available.",
      },
    ],
  }),
  builtinTemplate({
    id: "literature-review",
    name: "Literature review",
    description:
      "Synthesize relevant research, weigh evidence quality, and identify unresolved questions.",
    deliverableKind: "research_report",
    requiredSections: [
      "Search scope",
      "Thematic synthesis",
      "Evidence quality and disagreements",
      "Research gaps",
    ],
    sourcePriorities: [
      {
        sourceType: "plugin",
        priority: "high",
        rationale: "Prefer specialist scholarly indexes.",
      },
      {
        sourceType: "web",
        priority: "medium",
        rationale: "Use official publication pages for verification.",
      },
      {
        sourceType: "knowledge",
        priority: "medium",
        rationale: "Include approved local collections when relevant.",
      },
    ],
  }),
  builtinTemplate({
    id: "due-diligence",
    name: "Due diligence",
    description:
      "Collect verifiable facts, disclose uncertainty, and organize material risks before a decision.",
    deliverableKind: "decision_memo",
    requiredSections: [
      "Entity and scope",
      "Key facts",
      "Risks and evidence gaps",
      "Items to verify",
      "Recommendation",
    ],
    sourcePriorities: [
      {
        sourceType: "plugin",
        priority: "high",
        rationale: "Prefer official filings and disclosure indexes.",
      },
      {
        sourceType: "web",
        priority: "high",
        rationale: "Verify facts against first-party sources.",
      },
      {
        sourceType: "attachment",
        priority: "high",
        rationale: "Treat user-provided materials as in-scope evidence.",
      },
    ],
  }),
  builtinTemplate({
    id: "technical-evaluation",
    name: "Technical evaluation",
    description:
      "Assess technical options against requirements, operating cost, and long-term maintenance risk.",
    deliverableKind: "decision_memo",
    requiredSections: [
      "Requirements and evaluation criteria",
      "Option comparison",
      "Performance and maintenance risks",
      "Recommendation",
      "Validation plan",
    ],
    sourcePriorities: [
      {
        sourceType: "web",
        priority: "high",
        rationale: "Prefer authoritative product and standards documentation.",
      },
      {
        sourceType: "plugin",
        priority: "high",
        rationale: "Use specialist indexes for technical literature.",
      },
      {
        sourceType: "knowledge",
        priority: "medium",
        rationale: "Use approved internal references when supplied.",
      },
      {
        sourceType: "workspace",
        priority: "medium",
        rationale: "Use approved workspace files for local constraints.",
      },
    ],
  }),
];

const BUILTIN_BY_ID = new Map(
  BUILTIN_RESEARCH_TEMPLATES.map((template) => [template.id, template]),
);

export type ResearchTemplateLocale = "en" | "zh" | "ja";

interface LocalizedBuiltinTemplateCopy {
  name: string;
  description: string;
  requiredSections: string[];
}

const BUILTIN_TEMPLATE_LOCALES: Record<
  ResearchTemplateId,
  Record<ResearchTemplateLocale, LocalizedBuiltinTemplateCopy>
> = {
  "competitive-analysis": {
    en: {
      name: "Competitive analysis",
      description:
        "Compare competitors against explicit criteria and surface meaningful gaps and opportunities.",
      requiredSections: [
        "Comparison criteria",
        "Comparison matrix",
        "Differences and opportunities",
        "Conclusion",
      ],
    },
    zh: {
      name: "竞品分析",
      description: "按明确标准比较竞品，并找出有意义的差异与机会。",
      requiredSections: ["比较标准", "对比矩阵", "差异与机会", "结论"],
    },
    ja: {
      name: "競合分析",
      description: "明確な基準で競合を比較し、重要な差異と機会を見つけます。",
      requiredSections: ["比較基準", "比較マトリクス", "差異と機会", "結論"],
    },
  },
  "literature-review": {
    en: {
      name: "Literature review",
      description:
        "Synthesize relevant research, weigh evidence quality, and identify unresolved questions.",
      requiredSections: [
        "Search scope",
        "Thematic synthesis",
        "Evidence quality and disagreements",
        "Research gaps",
      ],
    },
    zh: {
      name: "文献综述",
      description: "综合相关研究，评估证据质量，并识别尚未解决的问题。",
      requiredSections: ["检索范围", "主题综述", "证据质量与分歧", "研究空白"],
    },
    ja: {
      name: "文献レビュー",
      description:
        "関連研究を統合し、証拠の質を評価して未解決の問いを特定します。",
      requiredSections: [
        "検索範囲",
        "テーマ別統合",
        "エビデンスの質と相違点",
        "研究ギャップ",
      ],
    },
  },
  "due-diligence": {
    en: {
      name: "Due diligence",
      description:
        "Collect verifiable facts, disclose uncertainty, and organize material risks before a decision.",
      requiredSections: [
        "Entity and scope",
        "Key facts",
        "Risks and evidence gaps",
        "Items to verify",
        "Recommendation",
      ],
    },
    zh: {
      name: "尽职调查",
      description: "收集可核验事实，披露不确定性，并在决策前整理重要风险。",
      requiredSections: [
        "主体与范围",
        "关键事实",
        "风险与证据缺口",
        "待核实事项",
        "建议",
      ],
    },
    ja: {
      name: "デューデリジェンス",
      description:
        "検証可能な事実を集め、不確実性を示し、意思決定前に重要なリスクを整理します。",
      requiredSections: [
        "対象と範囲",
        "主要事実",
        "リスクとエビデンスギャップ",
        "確認事項",
        "推奨",
      ],
    },
  },
  "technical-evaluation": {
    en: {
      name: "Technical evaluation",
      description:
        "Assess technical options against requirements, operating cost, and long-term maintenance risk.",
      requiredSections: [
        "Requirements and evaluation criteria",
        "Option comparison",
        "Performance and maintenance risks",
        "Recommendation",
        "Validation plan",
      ],
    },
    zh: {
      name: "技术评估",
      description: "根据需求、运行成本和长期维护风险评估技术方案。",
      requiredSections: [
        "需求与评价标准",
        "方案比较",
        "性能与维护风险",
        "推荐",
        "验证计划",
      ],
    },
    ja: {
      name: "技術評価",
      description:
        "要件、運用コスト、長期的な保守リスクに基づいて技術案を評価します。",
      requiredSections: [
        "要件と評価基準",
        "選択肢の比較",
        "性能と保守のリスク",
        "推奨",
        "検証計画",
      ],
    },
  },
};

export function normalizeResearchTemplateLocale(
  locale?: string,
): ResearchTemplateLocale {
  const normalized = locale?.trim().toLowerCase();
  if (normalized?.startsWith("zh")) return "zh";
  if (normalized?.startsWith("ja")) return "ja";
  return "en";
}

/**
 * Localizes only built-in contract text. User templates are portable data and
 * retain the exact section names they were saved with.
 */
export function localizeResearchTemplate(
  template: ResearchTemplate,
  locale?: string,
): ResearchTemplate {
  const localized =
    isResearchTemplateId(template.id) &&
    BUILTIN_TEMPLATE_LOCALES[template.id][
      normalizeResearchTemplateLocale(locale)
    ];
  if (!localized) return cloneResearchTemplate(template);
  return {
    ...cloneResearchTemplate(template),
    name: localized.name,
    description: localized.description,
    requiredSections: [...localized.requiredSections],
  };
}

export function getBuiltinResearchTemplate(
  id: string | undefined,
): ResearchTemplate | null {
  const template = id ? BUILTIN_BY_ID.get(id) : undefined;
  return template ? cloneResearchTemplate(template) : null;
}

export function getBuiltinResearchTemplates(): ResearchTemplate[] {
  return BUILTIN_RESEARCH_TEMPLATES.map(cloneResearchTemplate);
}

export function isResearchTemplateId(
  value: string,
): value is ResearchTemplateId {
  return BUILTIN_TEMPLATE_IDS.has(value as ResearchTemplateId);
}

export interface CreateResearchTemplateInput {
  name: string;
  description: string;
  deliverableKind: ResearchDeliverableKind;
  requiredSections: string[];
  sourcePriorities: ResearchSourcePriority[];
  strategy?: Partial<ResearchStrategy>;
  now?: number;
  id?: string;
}

export type UpdateResearchTemplateInput = Partial<
  Omit<CreateResearchTemplateInput, "id" | "now">
>;

export function createResearchTemplateFromPlan(
  plan: Pick<ResearchPlanDraftV2, "deliverable" | "strategy" | "steps">,
  input: Pick<CreateResearchTemplateInput, "name" | "description">,
): CreateResearchTemplateInput {
  const byType = new Map<
    ResearchSourcePriority["sourceType"],
    ResearchSourcePriority
  >();
  for (const step of plan.steps) {
    for (const priority of step.sourcePriorities) {
      if (!byType.has(priority.sourceType)) {
        byType.set(priority.sourceType, clonePriority(priority));
      }
    }
  }
  return {
    ...input,
    deliverableKind: plan.deliverable.kind,
    requiredSections: [...plan.deliverable.requiredSections],
    sourcePriorities: [...byType.values()],
    strategy: cloneStrategy(plan.strategy),
  };
}

export function resolveResearchTemplate(
  ...layers: ResearchTemplateSelection[]
): ResearchTemplateSelection {
  let resolved: ResearchTemplateSelection = undefined;
  for (const layer of layers) {
    if (layer === undefined) continue;
    resolved = layer === null ? null : cloneResearchTemplate(layer);
  }
  return resolved;
}

export function templateToPlanDefaults(template: ResearchTemplate) {
  return {
    deliverable: {
      kind: template.deliverableKind,
      description: template.description,
      requiredSections: [...template.requiredSections],
    },
    strategy: cloneStrategy(template.strategy),
    sourcePriorities: template.sourcePriorities.map(clonePriority),
  };
}

/**
 * Uses template values only as defaults. A model or user supplied value stays
 * authoritative once it is present in the plan.
 */
export function applyResearchTemplateDefaults(
  plan: ResearchPlanDraftV2,
  template: ResearchTemplate | null | undefined,
  preserveInitialContract = false,
): ResearchPlanDraftV2 {
  if (!template) return plan;
  const defaults = templateToPlanDefaults(template);
  const sourcePriorities = defaults.sourcePriorities;
  const requiredSections = preserveInitialContract
    ? Array.from(
        new Set([
          ...defaults.deliverable.requiredSections,
          ...plan.deliverable.requiredSections,
        ]),
      )
    : plan.deliverable.requiredSections.length > 0
      ? [...plan.deliverable.requiredSections]
      : [...defaults.deliverable.requiredSections];
  return {
    ...plan,
    deliverable: {
      ...defaults.deliverable,
      ...plan.deliverable,
      ...(preserveInitialContract ? { kind: defaults.deliverable.kind } : {}),
      requiredSections,
    },
    strategy: plan.strategy || defaults.strategy,
    steps: plan.steps.map((step: ResearchPlanStepV2) => ({
      ...step,
      sourcePriorities: preserveInitialContract
        ? mergeSourcePriorities(sourcePriorities, step.sourcePriorities)
        : step.sourcePriorities.length > 0
          ? step.sourcePriorities.map(clonePriority)
          : sourcePriorities.map(clonePriority),
    })),
  };
}

function mergeSourcePriorities(
  defaults: ResearchSourcePriority[],
  explicit: ResearchSourcePriority[],
): ResearchSourcePriority[] {
  const merged = defaults.map(clonePriority);
  const sourceTypes = new Set(merged.map((priority) => priority.sourceType));
  for (const priority of explicit) {
    if (sourceTypes.has(priority.sourceType)) continue;
    sourceTypes.add(priority.sourceType);
    merged.push(clonePriority(priority));
  }
  return merged;
}

export function templateSourcePriorityFor(
  template: ResearchTemplate | null | undefined,
  sourceType: ResearchSourcePriority["sourceType"],
): ResearchSourcePriority | undefined {
  return template?.sourcePriorities.find(
    (item) => item.sourceType === sourceType,
  );
}

export function areResearchTemplatesEqual(
  left: ResearchTemplateSelection,
  right: ResearchTemplateSelection,
): boolean {
  if (left === right) return true;
  if (!left || !right) return left === right;
  return (
    left.id === right.id &&
    left.revision === right.revision &&
    normalizeResearchQuery(left.name) === normalizeResearchQuery(right.name)
  );
}
