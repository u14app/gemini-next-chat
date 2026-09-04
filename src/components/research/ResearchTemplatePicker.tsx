"use client";

import { useId, useMemo, useState, type ComponentProps } from "react";

import { Copy, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/primitives";
import { CustomSelect } from "@/components/ui/controls";
import Tooltip from "@/components/ui/Tooltip";
import {
  useResearchTemplates,
  type UseResearchTemplatesResult,
} from "@/hooks/research/useResearchTemplates";
import ResearchTemplateEditor from "./ResearchTemplateEditor";
import type {
  CreateResearchTemplateInput,
  ResearchTemplate,
  ResearchTemplateSelection,
} from "@/lib/research/templates";

export interface ResearchTemplatePickerLabels {
  title: string;
  description: string;
  inherit: string;
  disabled: string;
  loading: string;
  unavailable: string;
  duplicate: string;
  remove: string;
  builtIn: string;
  custom: string;
  selectAria: string;
  duplicateAria: string;
  removeAria: string;
  newTemplate?: string;
  editTemplate?: string;
  editAria?: string;
  snapshot?: string;
  preview?: string;
  deliverable?: string;
  sections?: string;
  sources?: string;
  strategy?: string;
  templateEditor?: Partial<
    ComponentProps<typeof ResearchTemplateEditor>["labels"]
  >;
  templateName?: (template: ResearchTemplate) => string;
  templateDescription?: (template: ResearchTemplate) => string;
}

export interface ResearchTemplatePickerProps {
  selection: ResearchTemplateSelection;
  onChange: (selection: ResearchTemplateSelection) => void;
  disabled?: boolean;
  labels: ResearchTemplatePickerLabels;
  templatesApi?: UseResearchTemplatesResult;
}

function selectionValue(selection: ResearchTemplateSelection): string {
  if (selection === undefined) return "__inherit__";
  if (selection === null) return "__disabled__";
  return selection.id;
}

export default function ResearchTemplatePicker({
  selection,
  onChange,
  disabled = false,
  labels,
  templatesApi,
}: ResearchTemplatePickerProps) {
  const ownApi = useResearchTemplates();
  const api = templatesApi || ownApi;
  const selectedId = selectionValue(selection);
  const selectId = useId();
  const [editor, setEditor] = useState<
    { mode: "create" | "edit"; template?: ResearchTemplate } | undefined
  >();
  const selectedLibraryTemplate = useMemo(
    () =>
      selection &&
      api.templates.find((template) => template.id === selection.id),
    [api.templates, selection],
  );
  const selectedTemplate = selection || undefined;
  const isSnapshotSelection = Boolean(
    selectedTemplate &&
    (!selectedLibraryTemplate || selectedTemplate !== selectedLibraryTemplate),
  );
  const selectableTemplates = useMemo(() => {
    if (
      !selection ||
      selection === null ||
      api.templates.some((template) => template.id === selection.id)
    ) {
      return api.templates;
    }
    return [...api.templates, selection];
  }, [api.templates, selection]);

  const handleSelect = (id: string) => {
    if (id === "__inherit__") {
      onChange(undefined);
      return;
    }
    if (id === "__disabled__") {
      onChange(null);
      return;
    }
    const next = selectableTemplates.find((template) => template.id === id);
    if (next) onChange(next);
  };

  const handleDuplicate = async () => {
    if (!selectedTemplate) return;
    try {
      const snapshot = {
        name: `${selectedTemplate.name} copy`,
        description: selectedTemplate.description,
        deliverableKind: selectedTemplate.deliverableKind,
        requiredSections: [...selectedTemplate.requiredSections],
        sourcePriorities: selectedTemplate.sourcePriorities.map((priority) => ({
          ...priority,
        })),
        strategy: { ...selectedTemplate.strategy },
      };
      const copy = selectedLibraryTemplate
        ? await api.duplicate(selectedTemplate.id, snapshot)
        : await api.create(snapshot);
      onChange(copy);
    } catch {
      // The hook retains the error so the picker can render its inline state.
    }
  };

  const handleRemove = async () => {
    if (!selectedTemplate || selectedTemplate.builtIn) return;
    try {
      await api.remove(selectedTemplate.id);
      onChange(undefined);
    } catch {
      // The hook retains the error so the picker can render its inline state.
    }
  };

  const handleEditorSave = async (input: CreateResearchTemplateInput) => {
    if (!editor) return;
    const saved =
      editor.mode === "edit" &&
      editor.template &&
      api.templates.some((template) => template.id === editor.template?.id)
        ? await api.update(editor.template.id, input)
        : await api.create(input);
    onChange(saved);
    setEditor(undefined);
  };

  return (
    <section className="rounded-lg border border-border p-3 sm:p-3.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold text-foreground">
            {labels.title}
          </h3>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            {labels.description}
          </p>
        </div>
        {selectedTemplate ? (
          <div className="flex shrink-0 items-center gap-1">
            <span className="rounded-md bg-muted/60 px-1.5 py-1 text-[10px] text-muted-foreground">
              {selectedTemplate.builtIn ? labels.builtIn : labels.custom}
            </span>
            {isSnapshotSelection ? (
              <span className="rounded-md border border-research-border px-1.5 py-1 text-[10px] text-research-accent">
                {labels.snapshot || "Saved snapshot"}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor={selectId}>
          {labels.selectAria}
        </label>
        <CustomSelect
          id={selectId}
          value={selectedId}
          onChange={handleSelect}
          ariaLabel={labels.selectAria}
          disabled={disabled || api.isLoading}
          options={[
            { value: "__inherit__", label: labels.inherit },
            { value: "__disabled__", label: labels.disabled },
            ...selectableTemplates.map((template) => ({
              value: template.id,
              label: labels.templateName?.(template) || template.name,
            })),
          ]}
          className="min-w-0 flex-1"
          selectButtonClassName="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none transition-colors focus:border-research-accent focus:ring-2 focus:ring-research-accent/20 disabled:opacity-50"
          renderValue={(_, defaultLabel) =>
            selectedTemplate
              ? labels.templateName?.(selectedTemplate) || selectedTemplate.name
              : defaultLabel
          }
        />
        {selectedTemplate ? (
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip content={labels.duplicate} position="top">
              <Button
                variant="bare"
                type="button"
                aria-label={labels.duplicateAria}
                disabled={disabled || api.isLoading}
                onClick={() => void handleDuplicate()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-research-accent/50 disabled:opacity-50"
              >
                <Copy size={14} aria-hidden="true" />
              </Button>
            </Tooltip>
            <Tooltip
              content={labels.editTemplate || "Edit template"}
              position="top"
            >
              <Button
                variant="bare"
                type="button"
                aria-label={
                  labels.editAria || "Edit selected research template"
                }
                disabled={disabled || api.isLoading}
                onClick={() =>
                  setEditor({
                    mode: selectedTemplate.builtIn ? "create" : "edit",
                    template: selectedTemplate,
                  })
                }
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-research-accent/50 disabled:opacity-50"
              >
                <Pencil size={14} aria-hidden="true" />
              </Button>
            </Tooltip>
            {!selectedTemplate.builtIn ? (
              <Tooltip content={labels.remove} position="top">
                <Button
                  variant="bare"
                  type="button"
                  aria-label={labels.removeAria}
                  disabled={disabled || api.isLoading}
                  onClick={() => void handleRemove()}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 disabled:opacity-50 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
        <Button
          variant="bare"
          type="button"
          disabled={disabled || api.isLoading}
          onClick={() => setEditor({ mode: "create" })}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-[10px] font-medium text-research-accent hover:bg-research-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-research-accent/50 disabled:opacity-50"
        >
          <Plus size={13} aria-hidden="true" />
          {labels.newTemplate || "New template"}
        </Button>
      </div>

      {api.isLoading ? (
        <p className="mt-2 text-[10px] text-muted-foreground" role="status">
          {labels.loading}
        </p>
      ) : api.error ? (
        <p
          className="mt-2 text-[10px] text-amber-700 dark:text-amber-300"
          role="status"
        >
          {labels.unavailable}
        </p>
      ) : null}

      {selectedTemplate ? (
        <div className="mt-3 rounded-md bg-muted/25 p-2.5">
          <p className="text-[10px] font-medium text-foreground">
            {labels.preview || "Template preview"}
          </p>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            {labels.templateDescription?.(selectedTemplate) ||
              selectedTemplate.description}
          </p>
          <dl className="mt-2 grid gap-x-3 gap-y-1 text-[10px] leading-4 text-muted-foreground sm:grid-cols-[auto_1fr]">
            <dt className="font-medium text-foreground">
              {labels.deliverable || "Deliverable"}
            </dt>
            <dd>{selectedTemplate.deliverableKind.replaceAll("_", " ")}</dd>
            <dt className="font-medium text-foreground">
              {labels.sections || "Required sections"}
            </dt>
            <dd>{selectedTemplate.requiredSections.join(", ")}</dd>
            <dt className="font-medium text-foreground">
              {labels.sources || "Source priorities"}
            </dt>
            <dd>
              {selectedTemplate.sourcePriorities
                .map((source) => `${source.sourceType}:${source.priority}`)
                .join(", ")}
            </dd>
            <dt className="font-medium text-foreground">
              {labels.strategy || "Starting strategy"}
            </dt>
            <dd className="font-mono">
              {selectedTemplate.strategy.initialBreadth}/
              {selectedTemplate.strategy.maxDepth}/
              {selectedTemplate.strategy.maxQueries}/
              {selectedTemplate.strategy.resultsPerQuery}
            </dd>
          </dl>
        </div>
      ) : null}

      {editor ? (
        <ResearchTemplateEditor
          key={`${editor.mode}-${editor.template?.id || "new"}`}
          template={editor.template}
          labels={labels.templateEditor}
          onSave={handleEditorSave}
          onCancel={() => setEditor(undefined)}
        />
      ) : null}
    </section>
  );
}
