"use client";

import React, { useEffect, useId, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BookOpenCheck,
  Check,
  CheckCircle2,
  Circle,
  CircleStop,
  ExternalLink,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SearchCheck,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, DangerAction, InlineStatus } from "@/components/ui/primitives";
import { DEEP_RESEARCH_INSTRUCTION_MAX_CHARS } from "@/lib/research";
import { getSafeExternalHref } from "@/lib/security/clientUrl";
import { cn } from "@/lib/utils/cn";

import type {
  ResearchActivityView,
  ResearchEvidenceView,
  ResearchPlanView,
  ResearchStrategyView,
  ResearchTaskActions,
  ResearchTaskStatus,
  ResearchTaskViewModel,
} from "./types";

export const ACTIVE_RESEARCH_STATUSES = new Set<ResearchTaskStatus>([
  "clarifying",
  "researching",
  "verifying",
  "synthesizing",
]);

const STATUS_TONE: Record<
  ResearchTaskStatus,
  "active" | "success" | "warning" | "danger" | "neutral"
> = {
  draft: "neutral",
  clarifying: "active",
  plan_ready: "active",
  researching: "active",
  verifying: "active",
  synthesizing: "active",
  paused: "warning",
  completed: "success",
  partial_completed: "warning",
  failed: "danger",
  cancelled: "neutral",
};

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function StatusIcon({ status }: { status: ResearchTaskStatus }) {
  const tone = STATUS_TONE[status];
  const className = cn(
    "shrink-0",
    tone === "active" && "text-research-accent-text",
    tone === "success" && "text-emerald-600 dark:text-emerald-400",
    tone === "warning" && "text-amber-600 dark:text-amber-400",
    tone === "danger" && "text-red-600 dark:text-red-400",
    tone === "neutral" && "text-muted-foreground",
  );

  if (status === "completed") {
    return <CheckCircle2 size={16} className={className} aria-hidden="true" />;
  }
  if (status === "partial_completed" || status === "paused") {
    return <AlertTriangle size={16} className={className} aria-hidden="true" />;
  }
  if (status === "failed") {
    return <ShieldAlert size={16} className={className} aria-hidden="true" />;
  }
  if (status === "cancelled") {
    return <CircleStop size={16} className={className} aria-hidden="true" />;
  }
  if (ACTIVE_RESEARCH_STATUSES.has(status)) {
    return (
      <Activity
        size={16}
        className={cn(className, "animate-pulse motion-reduce:animate-none")}
        aria-hidden="true"
      />
    );
  }
  return <BookOpenCheck size={16} className={className} aria-hidden="true" />;
}

function StatusLabel({ status }: { status: ResearchTaskStatus }) {
  const t = useTranslations("Research");
  const tone = STATUS_TONE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        tone === "active" && "text-research-accent-text",
        tone === "success" && "text-emerald-700 dark:text-emerald-300",
        tone === "warning" && "text-amber-700 dark:text-amber-300",
        tone === "danger" && "text-red-700 dark:text-red-300",
        tone === "neutral" && "text-muted-foreground",
      )}
    >
      <StatusIcon status={status} />
      {t(`status.${status}`)}
    </span>
  );
}

/**
 * Wall-clock elapsed time for a run, ticking once a second while the run is
 * live and frozen the moment it stops. Without this the card's elapsed cell is
 * only refreshed when persisted usage happens to change, which reads as a
 * stalled task.
 */
function useElapsedMs(startedAt: number | undefined, live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live || !startedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [live, startedAt]);
  if (!startedAt) return 0;
  return Math.max(0, now - startedAt);
}

/**
 * The run's activity timeline. Shared by the workbench panel and the progress
 * card so the two never drift; `limit` keeps the card to a glanceable tail.
 */
function ActivityList({
  activities,
  limit,
  live = false,
}: {
  activities: ResearchActivityView[];
  limit?: number;
  live?: boolean;
}) {
  const items = limit ? activities.slice(-limit) : activities;
  return (
    <ol className="border-l border-border pl-4">
      {items.map((item, index) => {
        const isNewest = live && index === items.length - 1;
        return (
          <li key={item.id} className="relative pb-3 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="flex min-w-0 items-baseline gap-1.5 wrap-break-word text-sm font-medium">
                {isNewest ? (
                  <LoaderCircle
                    size={12}
                    className="shrink-0 animate-spin text-research-accent motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : null}
                {item.title}
              </h3>
              <time className="shrink-0 text-[11px] text-muted-foreground">
                {new Date(item.createdAt).toLocaleTimeString()}
              </time>
            </div>
            {item.detail ? (
              <p className="mt-1 wrap-break-word text-xs leading-5 text-muted-foreground">
                {item.detail}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function TaskMetrics({ task }: { task: ResearchTaskViewModel }) {
  const t = useTranslations("Research");
  const liveElapsedMs = useElapsedMs(
    task.run?.startedAt,
    ACTIVE_RESEARCH_STATUSES.has(task.status) && !task.run?.endedAt,
  );
  if (task.run) {
    return (
      <dl className="grid grid-cols-2 gap-px overflow-hidden border border-border bg-border text-xs sm:grid-cols-3">
        <div className="bg-background px-2.5 py-2">
          <dt className="text-muted-foreground">{t("metrics.queries")}</dt>
          <dd className="mt-0.5 font-mono font-medium tabular-nums text-foreground">
            {task.run.queryUsage.used}/{task.run.queryUsage.limit}
          </dd>
        </div>
        <div className="bg-background px-2.5 py-2">
          <dt className="text-muted-foreground">{t("metrics.evidence")}</dt>
          <dd className="mt-0.5 font-mono font-medium tabular-nums text-foreground">
            {task.evidence.length}
          </dd>
        </div>
        <div className="bg-background px-2.5 py-2">
          <dt className="text-muted-foreground">
            {t("metrics.verifiedClaims")}
          </dt>
          <dd className="mt-0.5 font-mono font-medium tabular-nums text-foreground">
            {task.run.claimCounts.verified}/{task.run.claimCounts.total}
          </dd>
        </div>
        <div className="bg-background px-2.5 py-2">
          <dt className="text-muted-foreground">{t("metrics.depth")}</dt>
          <dd className="mt-0.5 font-mono font-medium tabular-nums text-foreground">
            {task.run.currentDepth}/{task.run.maxDepth}
          </dd>
        </div>
        <div className="bg-background px-2.5 py-2">
          <dt className="text-muted-foreground">{t("metrics.wave")}</dt>
          <dd className="mt-0.5 font-mono font-medium tabular-nums text-foreground">
            {task.run.currentWave ?? 0}/{task.run.waves.length}
          </dd>
        </div>
        <div className="bg-background px-2.5 py-2">
          <dt className="text-muted-foreground">{t("metrics.elapsed")}</dt>
          <dd className="mt-0.5 font-mono font-medium tabular-nums text-foreground">
            {formatDuration(liveElapsedMs || task.usage.elapsedMs)}
          </dd>
        </div>
      </dl>
    );
  }
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
      <div>
        <dt className="text-muted-foreground">{t("metrics.questions")}</dt>
        <dd className="mt-0.5 font-medium tabular-nums text-foreground">
          {task.completedQuestions}/{task.totalQuestions}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t("metrics.evidence")}</dt>
        <dd className="mt-0.5 font-medium tabular-nums text-foreground">
          {task.evidence.length}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t("metrics.toolCalls")}</dt>
        <dd className="mt-0.5 font-medium tabular-nums text-foreground">
          {task.usage.toolCalls}/{task.usage.maxToolCalls}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t("metrics.elapsed")}</dt>
        <dd className="mt-0.5 font-medium tabular-nums text-foreground">
          {formatDuration(task.usage.elapsedMs)}
        </dd>
      </div>
    </dl>
  );
}

function ResearchSourceScope({ task }: { task: ResearchTaskViewModel }) {
  const t = useTranslations("Research");
  const scope = task.sourceScope;
  if (!scope) return null;
  const fetchEnabled = scope.toolIds.some(
    (toolId) => toolId === "fetch_url" || toolId.endsWith(":fetch_url"),
  );
  const entries = [
    scope.searchEnabled
      ? t("sourceScope.webSearchOn")
      : t("sourceScope.webSearchOff"),
    fetchEnabled ? t("sourceScope.fetchUrl") : null,
    scope.knowledgeCount > 0
      ? t("sourceScope.knowledge", { count: scope.knowledgeCount })
      : null,
    scope.attachmentCount > 0
      ? t("sourceScope.attachments", { count: scope.attachmentCount })
      : null,
    scope.workspaceCount > 0
      ? t("sourceScope.workspace", { count: scope.workspaceCount })
      : null,
    scope.pluginCount > 0
      ? t("sourceScope.plugins", { count: scope.pluginCount })
      : null,
  ].filter((entry): entry is string => Boolean(entry));

  return (
    <>
      <ul
        className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
        aria-label={t("sourceScope.label")}
      >
        {entries.map((entry) => (
          <li key={entry}>{entry}</li>
        ))}
      </ul>
      {!scope.searchEnabled ? (
        <InlineStatus tone="warning" className="mt-3">
          {t("sourceScope.searchWarning")}
        </InlineStatus>
      ) : null}
    </>
  );
}

function PlanSteps({
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

function AdjustmentForm({
  onSubmit,
  onDismiss,
}: {
  onSubmit: (instruction: string) => void | Promise<void>;
  onDismiss: () => void;
}) {
  const t = useTranslations("Research");
  const id = useId();
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  return (
    <form
      className="mt-3 border-t border-border pt-3"
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
      <div className="mt-2 flex justify-end gap-2 [&_button]:h-9 [&_button]:min-h-0 sm:[&_button]:h-8">
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

function StrategyAdjustmentForm({
  strategy,
  onSubmit,
  onDismiss,
}: {
  strategy: ResearchStrategyView;
  onSubmit: (strategy: StrategyAdjustment) => void | Promise<void>;
  onDismiss: () => void;
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
      className="mt-3 border-t border-border pt-3"
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
      <p className="text-xs font-medium text-foreground">
        {t("strategyAdjust.title")}
      </p>
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
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 font-mono text-sm tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
      <div className="mt-3 flex justify-end gap-2 [&_button]:h-9 [&_button]:min-h-0 sm:[&_button]:h-8">
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

function TaskActions({
  task,
  actions,
  compact = false,
}: {
  task: ResearchTaskViewModel;
  actions: ResearchTaskActions;
  compact?: boolean;
}) {
  const t = useTranslations("Research");
  const [adjusting, setAdjusting] = useState(false);
  const [tuningStrategy, setTuningStrategy] = useState(false);
  const isRunning = ACTIVE_RESEARCH_STATUSES.has(task.status);
  const canRetry =
    (task.status === "failed" || task.status === "clarifying") &&
    task.error?.recoverable;
  const retryLabel = t("actions.retry");
  const newFollowUpLabel = t("actions.newFollowUp");

  return (
    <div className="[&_button]:h-9 [&_button]:min-h-0 sm:[&_button]:h-8">
      <div className={cn("flex flex-wrap gap-2", compact && "justify-end")}>
        {task.status === "plan_ready" && actions.onConfirmPlan ? (
          <Button
            size="sm"
            variant="primary"
            onClick={actions.onConfirmPlan}
            className="bg-research-solid text-research-accent-foreground hover:bg-research-accent-hover"
          >
            <Play size={14} aria-hidden="true" />
            {t("actions.start")}
          </Button>
        ) : null}
        {(task.status === "plan_ready" ||
          task.status === "paused" ||
          isRunning) &&
        actions.onAdjustPlan ? (
          <Button
            size="sm"
            onClick={() => {
              setTuningStrategy(false);
              setAdjusting((value) => !value);
            }}
          >
            <Sparkles size={14} aria-hidden="true" />
            {t("actions.adjust")}
          </Button>
        ) : null}
        {task.status === "plan_ready" &&
        task.plan?.strategy &&
        actions.onUpdatePlanStrategy ? (
          <Button
            size="sm"
            onClick={() => {
              setAdjusting(false);
              setTuningStrategy((value) => !value);
            }}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            {t("actions.tuneStrategy")}
          </Button>
        ) : null}
        {isRunning && actions.onPause ? (
          <Button size="sm" onClick={actions.onPause}>
            <Pause size={14} aria-hidden="true" />
            {t("actions.pause")}
          </Button>
        ) : null}
        {task.status === "paused" && actions.onResume ? (
          <Button
            size="sm"
            variant="primary"
            onClick={actions.onResume}
            className="bg-research-solid text-research-accent-foreground hover:bg-research-accent-hover"
          >
            <Play size={14} aria-hidden="true" />
            {t("actions.resume")}
          </Button>
        ) : null}
        {canRetry && actions.onRetry ? (
          <Button
            size="sm"
            variant="primary"
            onClick={actions.onRetry}
            className="bg-research-solid text-research-accent-foreground hover:bg-research-accent-hover"
          >
            <RotateCcw size={14} aria-hidden="true" />
            {retryLabel}
          </Button>
        ) : null}
        {task.status === "failed" &&
        task.error?.recoverable &&
        actions.onDismiss ? (
          <Button size="sm" onClick={actions.onDismiss}>
            <X size={14} aria-hidden="true" />
            {t("actions.dismiss")}
          </Button>
        ) : null}
        {(task.status === "completed" || task.status === "partial_completed") &&
        actions.onNewFollowUp ? (
          <Button size="sm" onClick={actions.onNewFollowUp}>
            <Plus size={14} aria-hidden="true" />
            {newFollowUpLabel}
          </Button>
        ) : null}
        {!["completed", "partial_completed", "failed", "cancelled"].includes(
          task.status,
        ) && actions.onCancel ? (
          <DangerAction
            onConfirm={actions.onCancel}
            confirmLabel={t("actions.confirmCancel")}
            className="h-9 px-2.5 py-0 sm:h-8"
          >
            <X size={14} aria-hidden="true" />
            {t("actions.cancel")}
          </DangerAction>
        ) : null}
      </div>
      {adjusting && actions.onAdjustPlan ? (
        <AdjustmentForm
          onSubmit={actions.onAdjustPlan}
          onDismiss={() => setAdjusting(false)}
        />
      ) : null}
      {tuningStrategy && task.plan?.strategy && actions.onUpdatePlanStrategy ? (
        <StrategyAdjustmentForm
          strategy={task.plan.strategy}
          onSubmit={actions.onUpdatePlanStrategy}
          onDismiss={() => setTuningStrategy(false)}
        />
      ) : null}
    </div>
  );
}

function EvidenceInspector({
  evidence,
  idPrefix = "evidence",
}: {
  evidence: ResearchEvidenceView | undefined;
  idPrefix?: string;
}) {
  const t = useTranslations("Research");
  if (!evidence) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center px-5 text-center">
        <SearchCheck
          size={24}
          className="text-muted-foreground"
          aria-hidden="true"
        />
        <p className="mt-3 text-sm font-medium text-foreground">
          {t("evidence.emptyTitle")}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {t("evidence.emptyDescription")}
        </p>
      </div>
    );
  }

  const safeHref = evidence.url ? getSafeExternalHref(evidence.url) : null;
  return (
    <article
      id={`${idPrefix}-${evidence.id}`}
      className="min-w-0 p-4"
      aria-labelledby={`${idPrefix}-${evidence.id}-title`}
      tabIndex={-1}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t(`sourceType.${evidence.sourceType}`)}
          </p>
          <h3
            id={`${idPrefix}-${evidence.id}-title`}
            className="mt-1 wrap-break-word text-sm font-semibold text-foreground"
          >
            {evidence.title}
          </h3>
        </div>
        {safeHref ? (
          <a
            href={safeHref}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={t("evidence.openSource", { title: evidence.title })}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLink size={15} aria-hidden="true" />
          </a>
        ) : null}
      </div>
      <dl className="mt-4 space-y-2 border-y border-border py-3 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("evidence.retrieved")}</dt>
          <dd className="text-right text-foreground">
            {new Date(evidence.retrievedAt).toLocaleString()}
          </dd>
        </div>
        {evidence.locator ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("evidence.location")}</dt>
            <dd className="wrap-break-word text-right text-foreground">
              {evidence.locator}
            </dd>
          </div>
        ) : null}
        {evidence.stance ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("evidence.stance")}</dt>
            <dd className="text-right text-foreground">
              {t(`stance.${evidence.stance}`)}
            </dd>
          </div>
        ) : null}
        {evidence.freshness ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("evidence.freshness")}</dt>
            <dd className="text-right text-foreground">
              {t(`freshness.${evidence.freshness}`)}
            </dd>
          </div>
        ) : null}
        {evidence.verificationStatus ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">
              {t("evidence.verification")}
            </dt>
            <dd className="text-right text-foreground">
              {t(`verificationStatus.${evidence.verificationStatus}`)}
            </dd>
          </div>
        ) : null}
        {evidence.authority ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("evidence.authority")}</dt>
            <dd className="text-right text-foreground">
              {t(`authority.${evidence.authority}`)}
            </dd>
          </div>
        ) : null}
      </dl>
      {evidence.excerpt ? (
        <blockquote className="mt-4 border-l-2 border-research-accent/60 pl-3 text-sm leading-6 text-foreground/85">
          {evidence.excerpt}
        </blockquote>
      ) : null}
    </article>
  );
}

export {
  ActivityList,
  AdjustmentForm,
  EvidenceInspector,
  PlanSteps,
  ResearchSourceScope,
  StatusLabel,
  TaskActions,
  TaskMetrics,
  formatDuration,
  useElapsedMs,
};
