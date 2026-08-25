"use client";

import React from "react";
import { ArrowUpRight, FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, InlineStatus } from "@/components/ui/primitives";

import { ResearchPlanContract } from "./ResearchTopology";
import {
  PlanSteps,
  ResearchSourceScope,
  StatusLabel,
  TaskActions,
  TaskMetrics,
} from "./researchUi";
import type { ResearchTaskActions, ResearchTaskViewModel } from "./types";

export interface ResearchTaskCardProps extends ResearchTaskActions {
  task: ResearchTaskViewModel;
  onOpenWorkbench: () => void;
}

export default function ResearchTaskCard({
  task,
  onOpenWorkbench,
  onConfirmPlan,
  onAdjustPlan,
  onUpdatePlanStrategy,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onDismiss,
  onNewFollowUp,
}: ResearchTaskCardProps) {
  const t = useTranslations("Research");
  const isFinished =
    task.status === "completed" || task.status === "partial_completed";

  return (
    <section
      className="my-3 overflow-hidden rounded-xl border border-border bg-muted/15"
      aria-labelledby={`research-card-${task.id}`}
    >
      <header className="flex items-start gap-3 border-b border-border px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div aria-live="polite" aria-atomic="true">
            <StatusLabel status={task.status} />
          </div>
          <h2
            id={`research-card-${task.id}`}
            className="mt-1 wrap-break-word text-sm font-semibold leading-5 text-foreground"
          >
            {task.title}
          </h2>
        </div>
        <Button
          size="sm"
          onClick={onOpenWorkbench}
          className="h-9 shrink-0 sm:h-8"
          aria-label={t("actions.openWorkbench")}
        >
          <ArrowUpRight size={14} aria-hidden="true" />
          <span className="hidden sm:inline">{t("actions.openWorkbench")}</span>
          <span className="sm:hidden">{t("actions.open")}</span>
        </Button>
      </header>

      <div className="space-y-4 px-4 py-4">
        {task.error ? (
          <InlineStatus tone="danger" live>
            {task.error.message}
          </InlineStatus>
        ) : null}

        {task.status === "plan_ready" && task.plan ? (
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">
                {t("plan.steps")}
              </h3>
              <span className="text-[11px] text-muted-foreground">
                {t("plan.version", { version: task.plan.version })}
              </span>
            </div>
            <div className="mt-3">
              <PlanSteps plan={task.plan} />
            </div>
            <div className="mt-4">
              <ResearchPlanContract plan={task.plan} compact />
            </div>
            <div className="mt-3 border-t border-border pt-3">
              <ResearchSourceScope task={task} />
            </div>
          </div>
        ) : null}

        {isFinished ? (
          <div>
            {task.status === "partial_completed" && task.gapSummary ? (
              <InlineStatus tone="warning" className="mb-3">
                <span className="font-medium">{t("card.knownGaps")}: </span>
                {task.gapSummary}
              </InlineStatus>
            ) : null}
            {task.summary ? (
              <p className="text-sm leading-6 text-foreground/85">
                {task.summary}
              </p>
            ) : null}
            {task.findings?.length ? (
              <ul className="mt-3 space-y-2 border-l-2 border-research-accent/50 pl-3 text-sm leading-5 text-foreground/85">
                {task.findings.slice(0, 3).map((finding) => (
                  <li key={finding}>{finding}</li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileText size={13} aria-hidden="true" />
              {t("card.reportAvailable", {
                version:
                  task.reportVersions.find(
                    (version) => version.id === task.activeReportVersionId,
                  )?.version ?? task.reportVersions.length,
              })}
            </p>
          </div>
        ) : null}

        {!isFinished && task.status !== "plan_ready" && task.summary ? (
          <p className="text-sm leading-6 text-foreground/85">{task.summary}</p>
        ) : null}

        <div className="border-t border-border pt-3">
          <TaskMetrics task={task} />
        </div>

        <TaskActions
          task={task}
          actions={{
            onConfirmPlan,
            onAdjustPlan,
            onUpdatePlanStrategy,
            onPause,
            onResume,
            onCancel,
            onRetry,
            onDismiss,
            onNewFollowUp,
          }}
        />
      </div>
    </section>
  );
}
