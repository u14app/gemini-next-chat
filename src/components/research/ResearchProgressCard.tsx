"use client";

import React from "react";
import { ArrowUpRight, FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, InlineStatus } from "@/components/ui/primitives";

import {
  ACTIVE_RESEARCH_STATUSES,
  ActivityList,
  PlanSteps,
  StatusLabel,
  TaskActions,
  formatDuration,
  useElapsedMs,
} from "./researchUi";
import type { ResearchTaskActions, ResearchTaskViewModel } from "./types";

export interface ResearchProgressCardProps extends ResearchTaskActions {
  task: ResearchTaskViewModel;
  onOpenWorkbench: () => void;
}

/** How many activity entries the card shows before deferring to the workbench. */
const CARD_ACTIVITY_LIMIT = 3;

/**
 * The post-approval half of a research task: what the run is doing right now
 * while it is live, and what it produced once it stops.
 */
export default function ResearchProgressCard({
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
}: ResearchProgressCardProps) {
  const t = useTranslations("Research");
  const run = task.run;
  const isRunning = ACTIVE_RESEARCH_STATUSES.has(task.status);
  const isFinished =
    task.status === "completed" || task.status === "partial_completed";
  const elapsedMs = useElapsedMs(run?.startedAt, isRunning && !run?.endedAt);
  const progress =
    task.totalQuestions > 0
      ? Math.min(
          100,
          Math.round((task.completedQuestions / task.totalQuestions) * 100),
        )
      : 0;

  return (
    <section
      className="my-3 overflow-hidden rounded-xl border border-border bg-muted/15"
      aria-labelledby={`research-progress-${task.id}`}
    >
      <header className="flex items-start gap-3 border-b border-border px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div
            className="flex flex-wrap items-center gap-x-2 gap-y-1"
            aria-live="polite"
            aria-atomic="true"
          >
            <StatusLabel status={task.status} />
            {run && isRunning ? (
              <span className="text-xs text-muted-foreground">
                {t(`run.phase.${run.phase}`)}
              </span>
            ) : null}
            {run ? (
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatDuration(elapsedMs || task.usage.elapsedMs)}
              </span>
            ) : null}
          </div>
          <h2
            id={`research-progress-${task.id}`}
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

        {!isFinished && task.totalQuestions > 0 ? (
          <div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-border"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={task.totalQuestions}
              aria-valuenow={task.completedQuestions}
              aria-label={t("card.progress")}
            >
              <div
                className="h-full bg-research-accent transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t("card.progressSummary", {
                completed: task.completedQuestions,
                total: task.totalQuestions,
              })}
              {run
                ? ` · ${t("card.progressDepth", {
                    wave: run.currentWave ?? 0,
                    waves: run.waves.length,
                    depth: run.currentDepth,
                    maxDepth: run.maxDepth,
                  })}`
                : ""}
            </p>
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
            {task.reportVersions.length ? (
              <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileText size={13} aria-hidden="true" />
                {t("card.reportAvailable", {
                  version:
                    task.reportVersions.find(
                      (version) => version.id === task.activeReportVersionId,
                    )?.version ?? task.reportVersions.length,
                })}
              </p>
            ) : null}
          </div>
        ) : (
          <>
            {task.summary ? (
              <p className="text-sm leading-6 text-foreground/85">
                {task.summary}
              </p>
            ) : null}
            {task.plan ? <PlanSteps plan={task.plan} /> : null}
            {task.activities.length ? (
              <div className="border-t border-border pt-3">
                <h3 className="text-xs font-medium text-muted-foreground">
                  {t("card.liveActivity")}
                </h3>
                <div className="mt-2">
                  <ActivityList
                    activities={task.activities}
                    limit={CARD_ACTIVITY_LIMIT}
                    live={isRunning}
                  />
                </div>
              </div>
            ) : null}
          </>
        )}

        {run ? (
          <dl className="grid grid-cols-3 gap-x-4 border-t border-border pt-3 text-xs">
            <div>
              <dt className="text-muted-foreground">{t("metrics.queries")}</dt>
              <dd className="mt-0.5 font-mono font-medium tabular-nums text-foreground">
                {run.queryUsage.used}/{run.queryUsage.limit}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("metrics.evidence")}</dt>
              <dd className="mt-0.5 font-mono font-medium tabular-nums text-foreground">
                {task.evidence.length}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {t("metrics.verifiedClaims")}
              </dt>
              <dd className="mt-0.5 font-mono font-medium tabular-nums text-foreground">
                {run.claimCounts.verified}/{run.claimCounts.total}
              </dd>
            </div>
          </dl>
        ) : null}

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
