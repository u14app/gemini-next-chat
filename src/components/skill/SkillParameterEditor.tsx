"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { SkillParameterDefinition, SkillParameterInput } from "@/types";
import { CustomSelect } from "@/components/ui/controls";
import { Button } from "@/components/ui/primitives";

interface SkillParameterEditorProps {
  parameters: SkillParameterDefinition[];
  onChange: (parameters: SkillParameterDefinition[]) => void;
}

export default function SkillParameterEditor({
  parameters,
  onChange,
}: SkillParameterEditorProps) {
  const t = useTranslations("Skill");

  const update = (
    index: number,
    changes: Partial<SkillParameterDefinition>,
  ) => {
    onChange(
      parameters.map((parameter, currentIndex) =>
        currentIndex === index ? { ...parameter, ...changes } : parameter,
      ),
    );
  };

  return (
    <section className="space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/10 md:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-foreground">
            {t("parameters.title")}
          </h3>
          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-muted-foreground">
            {t("parameters.description")}
          </p>
        </div>
        <Button
          variant="bare"
          type="button"
          disabled={parameters.length >= 20}
          onClick={() =>
            onChange([
              ...parameters,
              {
                key: `parameter_${parameters.length + 1}`,
                label: t("parameters.newLabel"),
                input: "text",
                maxLength: 500,
              },
            ])
          }
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50"
        >
          <Plus size={13} aria-hidden="true" />
          {t("parameters.add")}
        </Button>
      </div>

      {parameters.length === 0 ? (
        <p className="rounded-lg border border-dashed border-emerald-200 px-3 py-4 text-center text-xs text-gray-500 dark:border-emerald-900/50 dark:text-muted-foreground">
          {t("parameters.empty")}
        </p>
      ) : (
        <div className="space-y-3">
          {parameters.map((parameter, index) => (
            <div
              key={`${parameter.key}-${index}`}
              className="grid gap-2 rounded-xl border border-gray-200 bg-white p-3 dark:border-border dark:bg-card sm:grid-cols-2"
            >
              <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-foreground/80">
                <span>{t("parameters.key")}</span>
                <input
                  type="text"
                  value={parameter.key}
                  spellCheck={false}
                  onChange={(event) =>
                    update(index, {
                      key: event.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9_]/g, "")
                        .slice(0, 40),
                    })
                  }
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 font-mono text-xs outline-none focus:border-emerald-500 dark:border-border dark:bg-muted"
                />
              </label>
              <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-foreground/80">
                <span>{t("parameters.label")}</span>
                <input
                  type="text"
                  value={parameter.label}
                  onChange={(event) =>
                    update(index, { label: event.target.value.slice(0, 120) })
                  }
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs outline-none focus:border-emerald-500 dark:border-border dark:bg-muted"
                />
              </label>
              <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-foreground/80">
                <span>{t("parameters.input")}</span>
                <CustomSelect
                  value={parameter.input}
                  onChange={(value) => {
                    const input = value as SkillParameterInput;
                    update(index, {
                      input,
                      options:
                        input === "select"
                          ? parameter.options || [
                              { value: "option", label: "Option" },
                            ]
                          : undefined,
                    });
                  }}
                  options={[
                    { value: "text", label: t("parameters.text") },
                    { value: "textarea", label: t("parameters.textarea") },
                    { value: "select", label: t("parameters.select") },
                  ]}
                  ariaLabel={t("parameters.input")}
                  selectButtonClassName="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs outline-none focus:border-emerald-500 dark:border-border dark:bg-muted"
                />
              </label>
              <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-foreground/80">
                <span>{t("parameters.maxLength")}</span>
                <input
                  type="number"
                  min={1}
                  max={20000}
                  value={parameter.maxLength}
                  onChange={(event) =>
                    update(index, { maxLength: Number(event.target.value) })
                  }
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs tabular-nums outline-none focus:border-emerald-500 dark:border-border dark:bg-muted"
                />
              </label>
              {parameter.input === "select" ? (
                <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-foreground/80 sm:col-span-2">
                  <span>{t("parameters.options")}</span>
                  <input
                    type="text"
                    value={(parameter.options || [])
                      .map((option) => option.value)
                      .join(", ")}
                    onChange={(event) =>
                      update(index, {
                        options: event.target.value
                          .split(",")
                          .map((value) => value.trim())
                          .filter(Boolean)
                          .slice(0, 30)
                          .map((value) => ({ value, label: value })),
                      })
                    }
                    placeholder={t("parameters.optionsPlaceholder")}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs outline-none focus:border-emerald-500 dark:border-border dark:bg-muted"
                  />
                </label>
              ) : null}
              <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-foreground/80">
                <span>{t("parameters.defaultValue")}</span>
                <input
                  type="text"
                  value={parameter.defaultValue || ""}
                  onChange={(event) =>
                    update(index, { defaultValue: event.target.value })
                  }
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs outline-none focus:border-emerald-500 dark:border-border dark:bg-muted"
                />
              </label>
              <div className="flex items-end justify-between gap-3">
                <label className="inline-flex items-center gap-2 pb-2 text-xs font-medium text-gray-600 dark:text-foreground/80">
                  <input
                    type="checkbox"
                    checked={parameter.required || false}
                    onChange={(event) =>
                      update(index, { required: event.target.checked })
                    }
                    className="h-4 w-4 rounded border-gray-300 text-emerald-600"
                  />
                  {t("parameters.required")}
                </label>
                <Button
                  variant="bare"
                  type="button"
                  aria-label={t("parameters.removeAria", {
                    label: parameter.label,
                  })}
                  onClick={() =>
                    onChange(
                      parameters.filter(
                        (_parameter, currentIndex) => currentIndex !== index,
                      ),
                    )
                  }
                  className="rounded-lg p-2 text-red-500 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 dark:hover:bg-red-950/30"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
