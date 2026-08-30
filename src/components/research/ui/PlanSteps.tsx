"use client";

import React from "react";
import { Check, Circle, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils/cn";

import type { ResearchPlanView } from "../types";

export function PlanSteps({
  plan,
  detailed = false,
}: {
  plan: ResearchPlanView;
  detailed?: boolean;
}) {
  const t = useTranslations("Research");
  return (
    <ol className="space-y-2.5">
      {plan.steps.map((step) => (
        <li
          key={step.id}
          className="flex items-start gap-2 text-sm leading-5"
          aria-current={step.status === "in_progress" ? "step" : undefined}
        >
          <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center">
            {step.status === "completed" ? (
              <Check
                size={14}
                className="text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />
            ) : step.status === "in_progress" ? (
              <LoaderCircle
                size={14}
                className="animate-spin text-research-accent motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Circle
                size={13}
                className="text-muted-foreground"
                aria-hidden="true"
              />
            )}
          </span>
          <span className="sr-only">{t(`planStep.${step.status}`)}: </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block wrap-break-word",
                step.status === "completed"
                  ? "text-muted-foreground line-through"
                  : "text-foreground/90",
              )}
            >
              {step.title}
            </span>
            {detailed ? (
              <span className="mt-2 block space-y-2 border-l border-border pl-3 text-xs leading-5 text-muted-foreground">
                {step.objective && step.objective !== step.title ? (
                  <span className="block text-foreground/80">
                    {step.objective}
                  </span>
                ) : null}
                {step.queryTopics?.length ? (
                  <span className="block">
                    <span className="font-medium text-foreground">
                      {t("plan.queryTopics")}:{" "}
                    </span>
                    {step.queryTopics.join(", ")}
                  </span>
                ) : null}
                {step.sourcePriorities?.length ? (
                  <span className="block">
                    <span className="font-medium text-foreground">
                      {t("plan.sourcePriorities")}:{" "}
                    </span>
                    {step.sourcePriorities.join(", ")}
                  </span>
                ) : null}
                {step.evidenceStandard ? (
                  <span className="block">
                    <span className="font-medium text-foreground">
                      {t("plan.evidenceStandard")}:{" "}
                    </span>
                    {step.evidenceStandard}
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
