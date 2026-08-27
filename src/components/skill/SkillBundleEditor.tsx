"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Plus, Save, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  SkillBundle,
  SkillBundleStep,
  SkillParameterBinding,
  TextSkill,
} from "@/types";
import { normalizeSkillBundles } from "@/lib/skills";
import SkillParameterEditor from "./SkillParameterEditor";
import { CustomSelect } from "@/components/ui/controls";
import { Button } from "@/components/ui/primitives";

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

function createDefaultBundle(): SkillBundle {
  return {
    id: "",
    title: "",
    description: "",
    parameters: [],
    steps: [],
  };
}

export default function SkillBundleEditor({
  bundle,
  skills,
  onSave,
  onDelete,
  onClose,
}: {
  bundle?: SkillBundle;
  skills: TextSkill[];
  onSave: (bundle: SkillBundle) => void;
  onDelete?: (bundleId: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("Skill");
  const [draft, setDraft] = useState<SkillBundle>(
    bundle ? structuredClone(bundle) : createDefaultBundle(),
  );
  const [selectedSkillId, setSelectedSkillId] = useState(skills[0]?.id || "");
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const skillsById = useMemo(
    () => new Map(skills.map((skill) => [skill.id, skill])),
    [skills],
  );

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const updateStep = (index: number, updates: Partial<SkillBundleStep>) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, currentIndex) =>
        currentIndex === index ? { ...step, ...updates } : step,
      ),
    }));
  };

  const updateBinding = (
    stepIndex: number,
    key: string,
    binding: SkillParameterBinding,
  ) => {
    const step = draft.steps[stepIndex];
    updateStep(stepIndex, {
      bindings: { ...step.bindings, [key]: binding },
    });
  };

  const handleSave = () => {
    const id = bundle?.id || slugify(draft.id || draft.title);
    const normalized = normalizeSkillBundles([
      {
        ...draft,
        id,
        title: draft.title.trim(),
        description: draft.description.trim(),
      },
    ])[0];
    const hasMissingSkill = draft.steps.some(
      (step) => !skillsById.has(step.skillId),
    );
    if (
      !id ||
      !draft.title.trim() ||
      !normalized ||
      normalized.steps.length !== draft.steps.length ||
      normalized.parameters.length !== draft.parameters.length ||
      hasMissingSkill
    ) {
      setError(t("bundles.invalid"));
      return;
    }
    onSave(normalized);
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-9999 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-bundle-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-border dark:bg-card"
      >
        <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-border">
          <div>
            <h2
              id="skill-bundle-title"
              className="text-lg font-bold text-gray-800 dark:text-foreground"
            >
              {bundle ? t("bundles.edit") : t("bundles.create")}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-muted-foreground">
              {t("bundles.description")}
            </p>
          </div>
          <Button
            variant="bare"
            ref={closeRef}
            type="button"
            aria-label={t("closeEditor")}
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:hover:bg-muted"
          >
            <X size={20} aria-hidden="true" />
          </Button>
        </header>

        <div className="grid flex-1 gap-4 overflow-y-auto p-5 custom-scrollbar md:grid-cols-2">
          {!bundle ? (
            <label className="space-y-1 text-sm font-medium text-gray-700 dark:text-foreground/85">
              <span>{t("bundles.id")}</span>
              <input
                type="text"
                value={draft.id}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    id: event.target.value,
                  }))
                }
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-border dark:bg-muted"
              />
            </label>
          ) : null}
          <label className="space-y-1 text-sm font-medium text-gray-700 dark:text-foreground/85">
            <span>{t("bundles.title")}</span>
            <input
              type="text"
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-border dark:bg-muted"
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-gray-700 dark:text-foreground/85 md:col-span-2">
            <span>{t("bundles.summary")}</span>
            <textarea
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              className="h-20 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-border dark:bg-muted"
            />
          </label>

          <SkillParameterEditor
            parameters={draft.parameters}
            onChange={(parameters) =>
              setDraft((current) => ({ ...current, parameters }))
            }
          />

          <section className="space-y-3 md:col-span-2">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-foreground">
                  {t("bundles.steps")}
                </h3>
                <p className="text-[11px] text-gray-500 dark:text-muted-foreground">
                  {t("bundles.stepsDescription")}
                </p>
              </div>
              <div className="flex gap-2">
                <CustomSelect
                  value={selectedSkillId}
                  onChange={setSelectedSkillId}
                  options={skills.map((skill) => ({
                    value: skill.id,
                    label: skill.title,
                  }))}
                  disabled={skills.length === 0}
                  emptyLabel={t("bundles.empty")}
                  ariaLabel={t("bundles.steps")}
                  className="min-w-0 max-w-56"
                  selectButtonClassName="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs outline-none focus:border-emerald-500 dark:border-border dark:bg-muted"
                />
                <Button
                  variant="bare"
                  type="button"
                  disabled={!selectedSkillId || draft.steps.length >= 4}
                  onClick={() => {
                    const skill = skillsById.get(selectedSkillId);
                    if (!skill) return;
                    setDraft((current) => ({
                      ...current,
                      steps: [
                        ...current.steps,
                        {
                          id: `${current.id || "bundle"}-${current.steps.length + 1}`,
                          skillId: skill.id,
                          bindings: Object.fromEntries(
                            (skill.parameters || []).map((parameter) => [
                              parameter.key,
                              {
                                type: "literal" as const,
                                value: parameter.defaultValue || "",
                              },
                            ]),
                          ),
                        },
                      ],
                    }));
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50"
                >
                  <Plus size={13} aria-hidden="true" />
                  {t("bundles.addStep")}
                </Button>
              </div>
            </div>

            {draft.steps.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-xs text-gray-500 dark:border-border dark:text-muted-foreground">
                {t("bundles.empty")}
              </div>
            ) : (
              <div className="space-y-3">
                {draft.steps.map((step, index) => {
                  const skill = skillsById.get(step.skillId);
                  return (
                    <div
                      key={`${step.id}-${index}`}
                      className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 dark:border-border dark:bg-muted/30"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-gray-800 dark:text-foreground">
                            {index + 1}. {skill?.title || step.skillId}
                          </div>
                          {!skill ? (
                            <div className="text-[11px] text-red-600 dark:text-red-300">
                              {t("bundles.missingSkill")}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="bare"
                            type="button"
                            disabled={index === 0}
                            aria-label={t("bundles.moveUp")}
                            onClick={() =>
                              setDraft((current) => {
                                const steps = [...current.steps];
                                [steps[index - 1], steps[index]] = [
                                  steps[index],
                                  steps[index - 1],
                                ];
                                return { ...current, steps };
                              })
                            }
                            className="rounded p-1.5 text-gray-500 hover:bg-white disabled:opacity-30 dark:hover:bg-card"
                          >
                            <ArrowUp size={14} aria-hidden="true" />
                          </Button>
                          <Button
                            variant="bare"
                            type="button"
                            disabled={index === draft.steps.length - 1}
                            aria-label={t("bundles.moveDown")}
                            onClick={() =>
                              setDraft((current) => {
                                const steps = [...current.steps];
                                [steps[index], steps[index + 1]] = [
                                  steps[index + 1],
                                  steps[index],
                                ];
                                return { ...current, steps };
                              })
                            }
                            className="rounded p-1.5 text-gray-500 hover:bg-white disabled:opacity-30 dark:hover:bg-card"
                          >
                            <ArrowDown size={14} aria-hidden="true" />
                          </Button>
                          <Button
                            variant="bare"
                            type="button"
                            aria-label={t("bundles.removeStep")}
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                steps: current.steps.filter(
                                  (_step, currentIndex) =>
                                    currentIndex !== index,
                                ),
                              }))
                            }
                            className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </Button>
                        </div>
                      </div>

                      {(skill?.parameters || []).length > 0 ? (
                        <div className="mt-3 space-y-2">
                          {skill?.parameters?.map((parameter) => {
                            const binding = step.bindings[parameter.key] || {
                              type: "literal",
                              value: parameter.defaultValue || "",
                            };
                            return (
                              <div
                                key={parameter.key}
                                className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)] sm:items-center"
                              >
                                <span className="truncate text-xs font-medium text-gray-600 dark:text-foreground/80">
                                  {parameter.label}
                                </span>
                                <CustomSelect
                                  value={binding.type}
                                  disabled={draft.parameters.length === 0}
                                  onChange={(value) =>
                                    updateBinding(
                                      index,
                                      parameter.key,
                                      value === "bundle"
                                        ? {
                                            type: "bundle",
                                            parameterKey:
                                              draft.parameters[0]?.key || "",
                                          }
                                        : { type: "literal", value: "" },
                                    )
                                  }
                                  options={[
                                    {
                                      value: "literal",
                                      label: t("bundles.literal"),
                                    },
                                    {
                                      value: "bundle",
                                      label: t("bundles.bundleParameter"),
                                    },
                                  ]}
                                  ariaLabel={`${parameter.label}: ${t("bundles.bundleParameter")}`}
                                  selectButtonClassName="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-border dark:bg-card"
                                />
                                {binding.type === "bundle" ? (
                                  <CustomSelect
                                    value={binding.parameterKey}
                                    onChange={(value) =>
                                      updateBinding(index, parameter.key, {
                                        type: "bundle",
                                        parameterKey: value,
                                      })
                                    }
                                    options={draft.parameters.map(
                                      (parameter) => ({
                                        value: parameter.key,
                                        label: parameter.label,
                                      }),
                                    )}
                                    emptyLabel={t("bundles.empty")}
                                    ariaLabel={`${parameter.label}: ${t("bundles.bundleParameter")}`}
                                    selectButtonClassName="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-border dark:bg-card"
                                  />
                                ) : (
                                  <input
                                    type="text"
                                    value={binding.value}
                                    onChange={(event) =>
                                      updateBinding(index, parameter.key, {
                                        type: "literal",
                                        value: event.target.value,
                                      })
                                    }
                                    className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-border dark:bg-card"
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {error ? (
          <div
            role="alert"
            className="mx-5 mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-300"
          >
            {error}
          </div>
        ) : null}
        <footer className="flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-4 dark:border-border">
          {bundle && onDelete ? (
            <Button
              variant="bare"
              type="button"
              onClick={() => {
                onDelete(bundle.id);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
            >
              <Trash2 size={14} aria-hidden="true" />
              {t("delete")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              variant="bare"
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-foreground/85 dark:hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button
              variant="bare"
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              <Save size={14} aria-hidden="true" />
              {t("save")}
            </Button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
