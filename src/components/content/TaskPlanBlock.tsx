"use client";

import React, { useEffect, useId, useState } from "react";
import { ChevronDown, Circle, CircleCheck, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  TaskPlanSnapshot,
  TaskPlanStepStatus,
} from "@/lib/agent/taskPlan";
import { Button } from "@/components/ui/primitives";

const TaskPlanBlock: React.FC<TaskPlanSnapshot> = ({ steps, note }) => {
  const t = useTranslations("Content");
  const panelId = useId();
  const hasActiveWork = steps.some((step) => step.status !== "completed");
  const [isExpanded, setIsExpanded] = useState(hasActiveWork);
  const completedCount = steps.filter(
    (step) => step.status === "completed",
  ).length;

  useEffect(() => {
    setIsExpanded(hasActiveWork);
  }, [hasActiveWork]);

  if (steps.length === 0) return null;

  const getStatusLabel = (status: TaskPlanStepStatus) => {
    switch (status) {
      case "pending":
        return t("taskPlanStatusPending");
      case "in_progress":
        return t("taskPlanStatusInProgress");
      case "completed":
        return t("taskPlanStatusCompleted");
    }
  };

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-gray-200 bg-gray-50/40 dark:border-border dark:bg-muted/20">
      <Button
        variant="bare"
        type="button"
        aria-expanded={isExpanded}
        aria-controls={panelId}
        onClick={() => setIsExpanded((expanded) => !expanded)}
        className="flex w-full cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 dark:text-muted-foreground dark:hover:bg-accent/30"
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {t("taskPlanTitle")}
        </span>
        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={t("taskPlanProgressAria", {
            completed: completedCount,
            total: steps.length,
          })}
          className="shrink-0 rounded border border-gray-200/70 bg-white/60 px-1.5 py-0.5 text-[11px] font-normal tabular-nums text-gray-500 dark:border-border dark:bg-card/40 dark:text-muted-foreground"
        >
          {completedCount}/{steps.length}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 transition-transform duration-200 motion-reduce:transition-none ${
            isExpanded ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </Button>

      <div
        id={panelId}
        role="region"
        aria-label={t("taskPlanDetails")}
        aria-hidden={!isExpanded}
        hidden={!isExpanded}
        className="border-t border-gray-200/50 bg-white/40 px-3 py-2.5 dark:border-border dark:bg-card/30"
      >
        <ol className="space-y-2">
          {steps.map((step, index) => (
            <li
              key={`${index}-${step.title}`}
              aria-current={step.status === "in_progress" ? "step" : undefined}
              className="flex min-w-0 items-start gap-2 text-xs leading-5"
            >
              <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center">
                {step.status === "completed" ? (
                  <CircleCheck
                    size={14}
                    className="text-emerald-500 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                ) : step.status === "in_progress" ? (
                  <LoaderCircle
                    size={14}
                    className="animate-spin text-blue-500 motion-reduce:animate-none dark:text-blue-400"
                    aria-hidden="true"
                  />
                ) : (
                  <Circle
                    size={14}
                    className="text-gray-400 dark:text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
              </span>
              <span className="sr-only">{getStatusLabel(step.status)}: </span>
              <span
                className={
                  step.status === "completed"
                    ? "min-w-0 wrap-break-word text-muted-foreground line-through decoration-gray-400/70"
                    : step.status === "in_progress"
                      ? "min-w-0 wrap-break-word font-medium text-gray-700 dark:text-foreground/90"
                      : "min-w-0 wrap-break-word text-gray-600 dark:text-foreground/80"
                }
              >
                {step.title}
              </span>
            </li>
          ))}
        </ol>

        {note ? (
          <p className="mt-2 border-t border-gray-200/50 pt-2 text-[11px] leading-5 text-muted-foreground dark:border-border">
            <span className="sr-only">{t("taskPlanNote")}: </span>
            {note}
          </p>
        ) : null}
      </div>
    </div>
  );
};

export default TaskPlanBlock;
