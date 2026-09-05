"use client";

import { useState } from "react";
import {
  DEFAULT_REPORT_SECTION_LABELS,
  reportSectionIdentity,
} from "@/lib/research/reportSectionLabels";
import { Check, Save, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/primitives";
import { useResearchTemplates } from "@/hooks/research/useResearchTemplates";
import type { ResearchTemplate } from "@/lib/research/templates";
import type { ResearchPlanView } from "@/components/research/types";
import type {
  ResearchPriority,
  ResearchSourcePriority,
  ResearchSourceType,
} from "@/lib/research/types";

const CORE_REQUIRED_SECTIONS = [
  DEFAULT_REPORT_SECTION_LABELS.executiveSummary,
  DEFAULT_REPORT_SECTION_LABELS.keyFindings,
  DEFAULT_REPORT_SECTION_LABELS.planCoverage,
  DEFAULT_REPORT_SECTION_LABELS.evidenceGaps,
  DEFAULT_REPORT_SECTION_LABELS.sources,
];
const SOURCE_TYPES = new Set<ResearchSourceType>([
  "web",
  "knowledge",
  "attachment",
  "workspace",
  "plugin",
  "mcp",
]);
const PRIORITIES = new Set<ResearchPriority>(["high", "medium", "low"]);

function getTemplateSourcePriorities(
  plan: ResearchPlanView,
): ResearchSourcePriority[] {
  const byType = new Map<ResearchSourceType, ResearchSourcePriority>();
  for (const step of plan.steps) {
    for (const value of step.sourcePriorities || []) {
      const match =
        /^(web|knowledge|attachment|workspace|plugin|mcp):(high|medium|low)(?:\s+-\s+(.+))?$/i.exec(
          value.trim(),
        );
      if (!match) continue;
      const sourceType = match[1].toLowerCase() as ResearchSourceType;
      const priority = match[2].toLowerCase() as ResearchPriority;
      if (!SOURCE_TYPES.has(sourceType) || !PRIORITIES.has(priority)) continue;
      if (byType.has(sourceType)) continue;
      byType.set(sourceType, {
        sourceType,
        priority,
        ...(match[3] ? { rationale: match[3].slice(0, 1_000) } : {}),
      });
    }
  }
  return byType.size > 0
    ? [...byType.values()]
    : [{ sourceType: "web", priority: "high" }];
}

function createTemplateInputFromPlan(
  plan: ResearchPlanView,
  name: string,
  description: string,
) {
  const seenSections = new Set<string>();
  const requiredSections = [
    ...(plan.deliverable?.requiredSections || []),
    ...CORE_REQUIRED_SECTIONS,
  ].filter((section) => {
    const identity = reportSectionIdentity(section);
    if (seenSections.has(identity)) return false;
    seenSections.add(identity);
    return true;
  });
  return {
    name,
    description,
    deliverableKind: plan.deliverable?.kind || "research_report",
    requiredSections,
    sourcePriorities: getTemplateSourcePriorities(plan),
    strategy: plan.strategy
      ? {
          initialBreadth: plan.strategy.initialBreadth,
          maxDepth: plan.strategy.maxDepth,
          maxQueries: plan.strategy.queryLimit,
          resultsPerQuery: plan.strategy.resultsPerQuery,
        }
      : undefined,
  };
}

export interface SaveResearchTemplateButtonLabels {
  save: string;
  namePlaceholder: string;
  descriptionPlaceholder: string;
  confirm: string;
  cancel: string;
  saved: string;
  saveAria: string;
}

const DEFAULT_LABELS: SaveResearchTemplateButtonLabels = {
  save: "Save as template",
  namePlaceholder: "Template name",
  descriptionPlaceholder: "What this plan is for",
  confirm: "Save template",
  cancel: "Cancel",
  saved: "Template saved",
  saveAria: "Save this research plan as a template",
};

export default function SaveResearchTemplateButton({
  plan,
  labels: labelOverrides,
  onSaved,
}: {
  plan: ResearchPlanView;
  labels?: Partial<SaveResearchTemplateButtonLabels>;
  onSaved?: (template: ResearchTemplate) => void;
}) {
  const tTemplate = useTranslations("ResearchTemplates");
  const localizedLabel = (key: string, fallback: string) => {
    try {
      return tTemplate.has(key) ? tTemplate(key as never) : fallback;
    } catch {
      return fallback;
    }
  };
  const labels = {
    save: localizedLabel("savePlan.save", DEFAULT_LABELS.save),
    namePlaceholder: localizedLabel(
      "savePlan.namePlaceholder",
      DEFAULT_LABELS.namePlaceholder,
    ),
    descriptionPlaceholder: localizedLabel(
      "savePlan.descriptionPlaceholder",
      DEFAULT_LABELS.descriptionPlaceholder,
    ),
    confirm: localizedLabel("savePlan.confirm", DEFAULT_LABELS.confirm),
    cancel: localizedLabel("savePlan.cancel", DEFAULT_LABELS.cancel),
    saved: localizedLabel("savePlan.saved", DEFAULT_LABELS.saved),
    saveAria: localizedLabel("savePlan.saveAria", DEFAULT_LABELS.saveAria),
    ...labelOverrides,
  };
  const api = useResearchTemplates();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState(
    plan.deliverable?.description || plan.summary || "",
  );
  const [saved, setSaved] = useState(false);

  const handleOpen = () => {
    setName((current) => current || `${plan.objective || "Research"} template`);
    setDescription(
      (current) =>
        current || plan.deliverable?.description || plan.summary || "",
    );
    setSaved(false);
    setOpen(true);
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    if (!trimmedName || !trimmedDescription) return;
    try {
      const template = await api.create(
        createTemplateInputFromPlan(plan, trimmedName, trimmedDescription),
      );
      setSaved(true);
      onSaved?.(template);
      setTimeout(() => setOpen(false), 700);
    } catch {
      // The hook exposes the write error inline below the form.
    }
  };

  if (!open) {
    return (
      <Button
        variant="bare"
        type="button"
        aria-label={labels.saveAria}
        onClick={handleOpen}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-research-border px-2.5 text-[11px] font-medium text-research-accent transition-colors hover:bg-research-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-research-accent/50"
      >
        <Save size={13} aria-hidden="true" />
        {labels.save}
      </Button>
    );
  }

  return (
    <div className="w-full rounded-md border border-research-border bg-research-soft/50 p-2.5 sm:max-w-xl">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="sr-only">{labels.namePlaceholder}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={labels.namePlaceholder}
            maxLength={160}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-research-accent focus:ring-2 focus:ring-research-accent/20"
          />
        </label>
        <label className="grid gap-1">
          <span className="sr-only">{labels.descriptionPlaceholder}</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={labels.descriptionPlaceholder}
            maxLength={2_000}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-research-accent focus:ring-2 focus:ring-research-accent/20"
          />
        </label>
      </div>
      {api.error ? (
        <p
          className="mt-1.5 text-[10px] text-red-600 dark:text-red-400"
          role="alert"
        >
          {api.error}
        </p>
      ) : null}
      <div className="mt-2 flex items-center justify-end gap-1.5">
        <Button
          variant="bare"
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-research-accent/50"
        >
          <X size={12} aria-hidden="true" />
          {labels.cancel}
        </Button>
        <Button
          variant="bare"
          type="button"
          onClick={() => void handleSave()}
          disabled={!name.trim() || !description.trim() || api.isLoading}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-research-accent px-2.5 text-[10px] font-medium text-white hover:bg-research-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-research-accent/50 disabled:opacity-50"
        >
          {saved ? <Check size={12} aria-hidden="true" /> : null}
          {saved ? labels.saved : labels.confirm}
        </Button>
      </div>
    </div>
  );
}
