"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { SkillParameterDefinition } from "@/types";
import { CustomSelect } from "@/components/ui/controls";
import { Button, Dialog, Field, Input } from "@/components/ui/primitives";

export interface SkillParameterRequest {
  key: string;
  title: string;
  description?: string;
  parameters: SkillParameterDefinition[];
}

export type SkillParameterSubmission = Record<string, Record<string, string>>;

export interface ComposerSkillParameterValues {
  skillParameterValues: Record<string, Record<string, string>>;
  skillBundleParameterValues: Record<string, Record<string, string>>;
}

interface SkillParameterDialogProps {
  open: boolean;
  requests: SkillParameterRequest[];
  initialValues?: SkillParameterSubmission;
  onCancel: () => void;
  onSubmit: (values: SkillParameterSubmission) => void;
}

function createInitialValues(
  requests: readonly SkillParameterRequest[],
  existing: SkillParameterSubmission = {},
): SkillParameterSubmission {
  return Object.fromEntries(
    requests.map((request) => [
      request.key,
      Object.fromEntries(
        request.parameters.map((parameter) => [
          parameter.key,
          existing[request.key]?.[parameter.key] ??
            parameter.defaultValue ??
            "",
        ]),
      ),
    ]),
  );
}

const getParameterId = (requestKey: string, parameterKey: string) =>
  `${requestKey}-${parameterKey}`.replace(/[^a-zA-Z0-9_-]/g, "-");

export default function SkillParameterDialog({
  open,
  requests,
  initialValues,
  onCancel,
  onSubmit,
}: SkillParameterDialogProps) {
  const t = useTranslations("Skill.parameters.runtime");
  const initial = useMemo(
    () => createInitialValues(requests, initialValues),
    [initialValues, requests],
  );
  const [values, setValues] = useState<SkillParameterSubmission>(initial);
  const [invalidSelectIds, setInvalidSelectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const selectRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (open) {
      setValues(initial);
      setInvalidSelectIds(new Set());
    }
  }, [initial, open]);

  const setValue = (
    requestKey: string,
    parameterKey: string,
    value: string,
  ) => {
    setValues((current) => ({
      ...current,
      [requestKey]: {
        ...current[requestKey],
        [parameterKey]: value,
      },
    }));
    const id = getParameterId(requestKey, parameterKey);
    setInvalidSelectIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onClose={onCancel} title={t("title")}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const missingRequiredSelectIds: string[] = [];
          for (const request of requests) {
            for (const parameter of request.parameters) {
              if (
                parameter.input === "select" &&
                parameter.required &&
                !(values[request.key]?.[parameter.key] || "").trim()
              ) {
                missingRequiredSelectIds.push(
                  getParameterId(request.key, parameter.key),
                );
              }
            }
          }

          if (missingRequiredSelectIds.length > 0) {
            setInvalidSelectIds(new Set(missingRequiredSelectIds));
            const firstMissingId = missingRequiredSelectIds[0];
            window.requestAnimationFrame(() => {
              selectRefs.current[firstMissingId]?.focus({
                preventScroll: true,
              });
            });
            return;
          }

          setInvalidSelectIds(new Set());
          onSubmit(values);
        }}
        className="flex max-h-[min(640px,80vh)] flex-col"
      >
        <p className="border-b border-border px-4 py-3 text-sm leading-6 text-muted-foreground">
          {t("description")}
        </p>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 custom-scrollbar">
          {requests.map((request) => (
            <fieldset
              key={request.key}
              className="space-y-4 rounded-xl border border-border bg-muted/20 p-4"
            >
              <legend className="px-1 text-sm font-semibold text-foreground">
                {request.title}
              </legend>
              {request.description ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  {request.description}
                </p>
              ) : null}
              {request.parameters.map((parameter) => {
                const id = getParameterId(request.key, parameter.key);
                const errorId = `${id}-error`;
                const isInvalidSelect = invalidSelectIds.has(id);
                const common = {
                  id,
                  name: id,
                  required: Boolean(parameter.required),
                  maxLength: parameter.maxLength,
                  value: values[request.key]?.[parameter.key] || "",
                  onChange: (
                    event: React.ChangeEvent<
                      HTMLInputElement | HTMLTextAreaElement
                    >,
                  ) => setValue(request.key, parameter.key, event.target.value),
                };

                return (
                  <Field
                    key={parameter.key}
                    htmlFor={id}
                    label={
                      <>
                        {parameter.label}
                        {parameter.required ? (
                          <span
                            className="ml-1 text-red-500"
                            aria-hidden="true"
                          >
                            *
                          </span>
                        ) : null}
                      </>
                    }
                    description={parameter.description}
                  >
                    {parameter.input === "textarea" ? (
                      <textarea
                        {...common}
                        rows={4}
                        className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    ) : parameter.input === "select" ? (
                      <CustomSelect
                        ref={(element) => {
                          selectRefs.current[id] = element;
                        }}
                        id={id}
                        name={id}
                        required={Boolean(parameter.required)}
                        value={values[request.key]?.[parameter.key] || ""}
                        onChange={(value) =>
                          setValue(request.key, parameter.key, value)
                        }
                        options={[
                          { value: "", label: t("selectPlaceholder") },
                          ...(parameter.options || []),
                        ]}
                        ariaLabel={parameter.label}
                        aria-invalid={isInvalidSelect || undefined}
                        aria-describedby={isInvalidSelect ? errorId : undefined}
                        selectButtonClassName="flex h-9 w-full items-center justify-between rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-red-300 aria-invalid:ring-red-500/40 dark:aria-invalid:border-red-800"
                      />
                    ) : (
                      <Input {...common} />
                    )}
                    {isInvalidSelect ? (
                      <p
                        id={errorId}
                        role="alert"
                        className="text-xs text-red-600 dark:text-red-300"
                      >
                        {t("selectRequired")}
                      </p>
                    ) : null}
                    <p className="text-right text-[11px] text-muted-foreground">
                      {(values[request.key]?.[parameter.key] || "").length}/
                      {parameter.maxLength}
                    </p>
                  </Field>
                );
              })}
            </fieldset>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button type="submit" variant="primary">
            {t("continue")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
