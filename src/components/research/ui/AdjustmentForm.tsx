"use client";

import React, { useId, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/primitives";
import { DEEP_RESEARCH_INSTRUCTION_MAX_CHARS } from "@/lib/research";
import { cn } from "@/lib/utils/cn";

import type { ResearchStrategyView } from "../types";

export function AdjustmentForm({
  onSubmit,
  onDismiss,
  embeddedInDialog = false,
}: {
  onSubmit: (instruction: string) => void | Promise<void>;
  onDismiss: () => void;
  embeddedInDialog?: boolean;
}) {
  const t = useTranslations("Research");
  const id = useId();
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  return (
    <form
      className={cn(
        embeddedInDialog ? "space-y-4 p-4" : "mt-3 border-t border-border pt-3",
      )}
      onSubmit={async (event) => {
        event.preventDefault();
        const value = instruction.trim();
        if (!value || submitting) return;
        setSubmitting(true);
        setError(false);
        try {
          await onSubmit(value);
          onDismiss();
        } catch {
          setError(true);
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <label htmlFor={id} className="text-xs font-medium text-foreground">
        {t("adjust.label")}
      </label>
      <p id={`${id}-help`} className="mt-1 text-xs text-muted-foreground">
        {t("adjust.help")}
      </p>
      <textarea
        id={id}
        aria-describedby={`${id}-help`}
        maxLength={DEEP_RESEARCH_INSTRUCTION_MAX_CHARS}
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        rows={3}
        className="mt-2 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        placeholder={t("adjust.placeholder")}
      />
      {error ? (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300" role="alert">
          {t("adjust.error")}
        </p>
      ) : null}
      <div
        className={cn(
          "mt-2 flex justify-end gap-2",
          embeddedInDialog
            ? "[&_button]:min-h-11 md:[&_button]:h-8 md:[&_button]:min-h-0"
            : "[&_button]:h-9 [&_button]:min-h-0 sm:[&_button]:h-8",
        )}
      >
        <Button size="sm" onClick={onDismiss} disabled={submitting}>
          {t("actions.dismiss")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          disabled={!instruction.trim() || submitting}
          className="bg-research-solid text-research-accent-foreground hover:bg-research-accent-hover"
        >
          {submitting ? t("adjust.submitting") : t("adjust.submit")}
        </Button>
      </div>
    </form>
  );
}

type StrategyAdjustment = {
  initialBreadth: number;
  maxDepth: number;
  maxQueries: number;
  resultsPerQuery: number;
};

export function StrategyAdjustmentForm({
  strategy,
  onSubmit,
  onDismiss,
  embeddedInDialog = false,
}: {
  strategy: ResearchStrategyView;
  onSubmit: (strategy: StrategyAdjustment) => void | Promise<void>;
  onDismiss: () => void;
  embeddedInDialog?: boolean;
}) {
  const t = useTranslations("Research");
  const helpId = useId();
  const [values, setValues] = useState<
    Record<keyof StrategyAdjustment, string>
  >({
    initialBreadth: String(strategy.initialBreadth),
    maxDepth: String(strategy.maxDepth),
    maxQueries: String(strategy.queryLimit),
    resultsPerQuery: String(strategy.resultsPerQuery),
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const fields: Array<{
    key: keyof StrategyAdjustment;
    min: number;
    max: number;
  }> = [
    { key: "initialBreadth", min: 1, max: 8 },
    { key: "maxDepth", min: 1, max: 4 },
    { key: "maxQueries", min: 2, max: 48 },
    { key: "resultsPerQuery", min: 3, max: 10 },
  ];

  return (
    <form
      className={cn(
        embeddedInDialog ? "space-y-4 p-4" : "mt-3 border-t border-border pt-3",
      )}
      onSubmit={async (event) => {
        event.preventDefault();
        const next = Object.fromEntries(
          fields.map((field) => [field.key, Number(values[field.key])]),
        ) as StrategyAdjustment;
        const valid = fields.every((field) => {
          const value = next[field.key];
          return (
            Number.isInteger(value) && value >= field.min && value <= field.max
          );
        });
        if (!valid || submitting) return;
        setSubmitting(true);
        setError(false);
        try {
          await onSubmit(next);
          onDismiss();
        } catch {
          setError(true);
        } finally {
          setSubmitting(false);
        }
      }}
    >
      {!embeddedInDialog ? (
        <p className="text-xs font-medium text-foreground">
          {t("strategyAdjust.title")}
        </p>
      ) : null}
      <p id={helpId} className="mt-1 text-xs leading-5 text-muted-foreground">
        {t("strategyAdjust.help")}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {fields.map((field) => (
          <label key={field.key} className="min-w-0 text-xs">
            <span className="block text-muted-foreground">
              {t(`strategyAdjust.${field.key}`)}
            </span>
            <input
              type="number"
              aria-label={t(`strategyAdjust.${field.key}`)}
              aria-describedby={helpId}
              required
              step={1}
              min={field.min}
              max={field.max}
              value={values[field.key]}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [field.key]: event.target.value,
                }))
              }
              className={cn(
                "mt-1 w-full rounded-md border border-border bg-background px-2 font-mono text-sm tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                embeddedInDialog ? "h-11 md:h-9" : "h-9",
              )}
            />
            <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
              {field.min}–{field.max}
            </span>
          </label>
        ))}
      </div>
      {error ? (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300" role="alert">
          {t("strategyAdjust.error")}
        </p>
      ) : null}
      <div
        className={cn(
          "mt-3 flex justify-end gap-2",
          embeddedInDialog
            ? "[&_button]:min-h-11 md:[&_button]:h-8 md:[&_button]:min-h-0"
            : "[&_button]:h-9 [&_button]:min-h-0 sm:[&_button]:h-8",
        )}
      >
        <Button size="sm" onClick={onDismiss} disabled={submitting}>
          {t("actions.dismiss")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          disabled={submitting}
          className="bg-research-solid text-research-accent-foreground hover:bg-research-accent-hover"
        >
          {submitting
            ? t("strategyAdjust.submitting")
            : t("strategyAdjust.submit")}
        </Button>
      </div>
    </form>
  );
}
