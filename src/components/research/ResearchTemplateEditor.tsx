"use client";

import { useId, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/primitives";
import { CustomSelect } from "@/components/ui/controls";
import {
  RESEARCH_STRATEGY_LIMITS,
  RESEARCH_STRATEGY_PRESETS,
} from "@/lib/research/orchestration";
import type {
  ResearchDeliverableKind,
  ResearchPriority,
  ResearchSourcePriority,
  ResearchSourceType,
  ResearchStrategy,
} from "@/lib/research/types";
import type {
  CreateResearchTemplateInput,
  ResearchTemplate,
} from "@/lib/research/templates";

export interface ResearchTemplateEditorLabels {
  title: string;
  name: string;
  namePlaceholder: string;
  description: string;
  descriptionPlaceholder: string;
  deliverable: string;
  sections: string;
  sectionsHint: string;
  sources: string;
  sourceType: string;
  priority: string;
  rationale: string;
  rationalePlaceholder: string;
  addSource: string;
  strategy: string;
  cancel: string;
  save: string;
  required: string;
  removeSourceAria: string;
}

const DEFAULT_LABELS: ResearchTemplateEditorLabels = {
  title: "Template details",
  name: "Name",
  namePlaceholder: "e.g. Product evaluation",
  description: "Description",
  descriptionPlaceholder: "What this template helps you deliver",
  deliverable: "Deliverable type",
  sections: "Required sections",
  sectionsHint:
    "One section per line. The standard audit sections are added automatically.",
  sources: "Source priorities",
  sourceType: "Source type",
  priority: "Priority",
  rationale: "Rationale",
  rationalePlaceholder: "Why this source is useful",
  addSource: "Add source priority",
  strategy: "Starting strategy",
  cancel: "Cancel",
  save: "Save template",
  required: "Complete the required fields before saving.",
  removeSourceAria: "Remove source priority",
};

const DELIVERABLE_KINDS: ResearchDeliverableKind[] = [
  "research_report",
  "comparison",
  "decision_memo",
  "exact_answer",
];
const SOURCE_TYPES: ResearchSourceType[] = [
  "web",
  "knowledge",
  "attachment",
  "workspace",
  "plugin",
  "mcp",
];
const PRIORITIES: ResearchPriority[] = ["high", "medium", "low"];
const STRATEGY_FIELDS: Array<keyof ResearchStrategy> = [
  "initialBreadth",
  "maxDepth",
  "maxQueries",
  "resultsPerQuery",
];

function defaultTemplate(): Pick<
  CreateResearchTemplateInput,
  | "name"
  | "description"
  | "deliverableKind"
  | "requiredSections"
  | "sourcePriorities"
  | "strategy"
> {
  return {
    name: "",
    description: "",
    deliverableKind: "research_report",
    requiredSections: ["Scope", "Findings", "Conclusion"],
    sourcePriorities: [{ sourceType: "web", priority: "high" }],
    strategy: { ...RESEARCH_STRATEGY_PRESETS.standard },
  };
}

function editorDraft(template?: ResearchTemplate) {
  const source = template || defaultTemplate();
  return {
    name: source.name,
    description: source.description,
    deliverableKind: source.deliverableKind,
    requiredSections: source.requiredSections.join("\n"),
    sourcePriorities: source.sourcePriorities.map((priority) => ({
      ...priority,
    })),
    strategy: { ...source.strategy },
  };
}

export interface ResearchTemplateEditorProps {
  template?: ResearchTemplate;
  labels?: Partial<ResearchTemplateEditorLabels>;
  onSave: (input: CreateResearchTemplateInput) => void | Promise<void>;
  onCancel: () => void;
}

export default function ResearchTemplateEditor({
  template,
  labels: labelOverrides,
  onSave,
  onCancel,
}: ResearchTemplateEditorProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const editorId = useId();
  const [draft, setDraft] = useState(() => editorDraft(template));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const updateStrategy = (field: keyof ResearchStrategy, value: string) => {
    const parsed = Number(value);
    setDraft((current) => ({
      ...current,
      strategy: {
        ...current.strategy,
        [field]: Number.isFinite(parsed) ? parsed : current.strategy[field],
      },
    }));
  };

  const updatePriority = (
    index: number,
    patch: Partial<ResearchSourcePriority>,
  ) => {
    setDraft((current) => ({
      ...current,
      sourcePriorities: current.sourcePriorities.map((priority, itemIndex) =>
        itemIndex === index ? { ...priority, ...patch } : priority,
      ),
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const requiredSections = draft.requiredSections
      .split("\n")
      .map((section) => section.trim())
      .filter(Boolean);
    const sourcePriorities = draft.sourcePriorities.filter(
      (priority) => priority.sourceType && priority.priority,
    );
    if (
      !draft.name.trim() ||
      !draft.description.trim() ||
      requiredSections.length === 0 ||
      sourcePriorities.length === 0
    ) {
      setError(labels.required);
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onSave({
        name: draft.name.trim(),
        description: draft.description.trim(),
        deliverableKind: draft.deliverableKind,
        requiredSections,
        sourcePriorities,
        strategy: draft.strategy,
      });
    } catch {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 border-t border-border pt-3"
    >
      <h4 className="text-xs font-semibold text-foreground">{labels.title}</h4>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-[10px] font-medium text-muted-foreground">
            {labels.name}
          </span>
          <input
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
            placeholder={labels.namePlaceholder}
            maxLength={160}
            className="h-9 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-research-accent focus:ring-2 focus:ring-research-accent/20"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] font-medium text-muted-foreground">
            {labels.deliverable}
          </span>
          <CustomSelect
            id={`${editorId}-deliverable`}
            value={draft.deliverableKind}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                deliverableKind: value as ResearchDeliverableKind,
              }))
            }
            ariaLabel={labels.deliverable}
            options={DELIVERABLE_KINDS.map((kind) => ({
              value: kind,
              label: kind.replaceAll("_", " "),
            }))}
            selectButtonClassName="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-research-accent focus:ring-2 focus:ring-research-accent/20"
          />
        </label>
      </div>

      <label className="grid gap-1">
        <span className="text-[10px] font-medium text-muted-foreground">
          {labels.description}
        </span>
        <textarea
          value={draft.description}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              description: event.target.value,
            }))
          }
          placeholder={labels.descriptionPlaceholder}
          maxLength={2_000}
          rows={2}
          className="resize-y rounded-md border border-border bg-background px-2 py-1.5 text-xs leading-4 text-foreground outline-none focus:border-research-accent focus:ring-2 focus:ring-research-accent/20"
        />
      </label>

      <label className="grid gap-1">
        <span className="text-[10px] font-medium text-muted-foreground">
          {labels.sections}
        </span>
        <textarea
          value={draft.requiredSections}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              requiredSections: event.target.value,
            }))
          }
          rows={4}
          maxLength={6_000}
          className="resize-y rounded-md border border-border bg-background px-2 py-1.5 text-xs leading-4 text-foreground outline-none focus:border-research-accent focus:ring-2 focus:ring-research-accent/20"
        />
        <span className="text-[10px] leading-4 text-muted-foreground">
          {labels.sectionsHint}
        </span>
      </label>

      <fieldset className="space-y-2">
        <legend className="text-[10px] font-medium text-muted-foreground">
          {labels.sources}
        </legend>
        {draft.sourcePriorities.map((source, index) => (
          <div
            key={`${source.sourceType}-${index}`}
            className="grid gap-2 rounded-md border border-border/70 bg-muted/20 p-2 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end"
          >
            <label className="grid gap-1">
              <span className="text-[10px] text-muted-foreground">
                {labels.sourceType}
              </span>
              <CustomSelect
                id={`${editorId}-source-${index}`}
                value={source.sourceType}
                onChange={(value) =>
                  updatePriority(index, {
                    sourceType: value as ResearchSourceType,
                  })
                }
                ariaLabel={`${labels.sourceType} ${index + 1}`}
                options={SOURCE_TYPES.map((sourceType) => ({
                  value: sourceType,
                  label: sourceType,
                }))}
                selectButtonClassName="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground outline-none focus:border-research-accent"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[10px] text-muted-foreground">
                {labels.priority}
              </span>
              <CustomSelect
                id={`${editorId}-priority-${index}`}
                value={source.priority}
                onChange={(value) =>
                  updatePriority(index, {
                    priority: value as ResearchPriority,
                  })
                }
                ariaLabel={`${labels.priority} ${index + 1}`}
                options={PRIORITIES.map((priority) => ({
                  value: priority,
                  label: priority,
                }))}
                selectButtonClassName="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground outline-none focus:border-research-accent"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[10px] text-muted-foreground">
                {labels.rationale}
              </span>
              <input
                value={source.rationale || ""}
                onChange={(event) =>
                  updatePriority(index, { rationale: event.target.value })
                }
                placeholder={labels.rationalePlaceholder}
                maxLength={1_000}
                className="h-8 rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground outline-none focus:border-research-accent"
              />
            </label>
            <Button
              variant="bare"
              type="button"
              aria-label={labels.removeSourceAria}
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  sourcePriorities: current.sourcePriorities.filter(
                    (_, itemIndex) => itemIndex !== index,
                  ),
                }))
              }
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 dark:hover:bg-red-900/20 dark:hover:text-red-400"
            >
              <Trash2 size={13} aria-hidden="true" />
            </Button>
          </div>
        ))}
        <Button
          variant="bare"
          type="button"
          onClick={() =>
            setDraft((current) => ({
              ...current,
              sourcePriorities: [
                ...current.sourcePriorities,
                { sourceType: "web", priority: "medium" },
              ],
            }))
          }
          className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[10px] font-medium text-research-accent hover:bg-research-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-research-accent/50"
        >
          <Plus size={13} aria-hidden="true" />
          {labels.addSource}
        </Button>
      </fieldset>

      <fieldset>
        <legend className="text-[10px] font-medium text-muted-foreground">
          {labels.strategy}
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STRATEGY_FIELDS.map((field) => {
            const limits = RESEARCH_STRATEGY_LIMITS[field];
            return (
              <label key={field} className="grid gap-1">
                <span className="text-[10px] text-muted-foreground">
                  {field.replace(/([A-Z])/g, " $1")}
                </span>
                <input
                  type="number"
                  min={limits.min}
                  max={limits.max}
                  value={draft.strategy[field]}
                  onChange={(event) =>
                    updateStrategy(field, event.target.value)
                  }
                  className="h-8 rounded-md border border-border bg-background px-1.5 font-mono text-[11px] text-foreground outline-none focus:border-research-accent"
                />
              </label>
            );
          })}
        </div>
      </fieldset>

      {error ? (
        <p className="text-[10px] text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button
          variant="bare"
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="h-8 rounded-md px-2.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-research-accent/50"
        >
          {labels.cancel}
        </Button>
        <Button
          variant="bare"
          type="submit"
          disabled={saving}
          className="h-8 rounded-md bg-research-accent px-3 text-[11px] font-medium text-white hover:bg-research-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-research-accent/50 disabled:opacity-50"
        >
          {labels.save}
        </Button>
      </div>
    </form>
  );
}
