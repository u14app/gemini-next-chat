"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Clock3,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";

import type { AgentRun } from "@/lib/agent";
import { Button } from "@/components/ui/primitives";

interface AgentRunBarProps {
  run: AgentRun;
  onStop?: () => void;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

const ACTIVE_STATUSES = new Set<AgentRun["status"]>([
  "running",
  "awaiting_input",
  "awaiting_approval",
]);

const AgentRunBar: React.FC<AgentRunBarProps> = ({ run, onStop }) => {
  const t = useTranslations("Content");
  const isActive = ACTIVE_STATUSES.has(run.status);
  const [expanded, setExpanded] = useState(isActive);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isActive) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [isActive]);

  useEffect(() => {
    if (isActive || run.status === "failed") setExpanded(true);
  }, [isActive, run.status]);

  const elapsedMs = isActive
    ? Math.max(run.usage.wallTimeMs, now - run.startedAt)
    : run.usage.wallTimeMs;
  const latestTool = useMemo(
    () => run.toolExecutions[run.toolExecutions.length - 1],
    [run.toolExecutions],
  );
  const executionGroups = useMemo(() => {
    const groups = new Map<number, AgentRun["toolExecutions"]>();
    run.toolExecutions.forEach((execution) => {
      const round = execution.round || 0;
      groups.set(round, [...(groups.get(round) || []), execution]);
    });
    return [...groups.entries()].reverse();
  }, [run.toolExecutions]);
  const statusLabel = t(`agentRunStatus_${run.status}`);
  const StatusIcon =
    run.status === "completed"
      ? CheckCircle2
      : run.status === "failed" || run.status === "interrupted"
        ? ShieldAlert
        : run.status === "cancelled"
          ? CircleStop
          : Activity;
  const statusClass =
    run.status === "completed"
      ? "text-emerald-600 dark:text-emerald-400"
      : run.status === "failed" || run.status === "interrupted"
        ? "text-amber-600 dark:text-amber-400"
        : run.status === "cancelled"
          ? "text-muted-foreground"
          : "text-blue-600 dark:text-blue-400";

  return (
    <section
      className="my-3 overflow-hidden rounded-xl border border-border bg-muted/20"
      aria-label={t("agentRunTitle")}
    >
      <div className="flex items-stretch">
        <Button
          variant="bare"
          type="button"
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-3 text-left hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/60"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <StatusIcon
            size={16}
            className={`${statusClass} ${isActive ? "animate-pulse motion-reduce:animate-none" : ""}`}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-foreground">
              {statusLabel}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {latestTool
                ? t("agentRunLatestTool", { name: latestTool.toolName })
                : t("agentRunNoTool")}
            </span>
          </span>
          <span className="hidden items-center gap-3 text-[11px] text-muted-foreground sm:flex">
            <span className="inline-flex items-center gap-1">
              <Wrench size={12} aria-hidden="true" />
              {run.usage.toolCalls}/{run.budget.maxToolCalls}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock3 size={12} aria-hidden="true" />
              {formatDuration(elapsedMs)}
            </span>
          </span>
          <ChevronDown
            size={15}
            className={`text-muted-foreground transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </Button>
        {isActive && onStop ? (
          <Button
            variant="bare"
            type="button"
            onClick={onStop}
            className="min-h-11 min-w-11 shrink-0 border-l border-border px-3 text-muted-foreground hover:bg-red-500/10 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500/60 dark:hover:text-red-400"
            aria-label={t("agentRunStop")}
            title={t("agentRunStop")}
          >
            <CircleStop size={16} aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      <div hidden={!expanded} className="border-t border-border px-3 py-2.5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] sm:grid-cols-5">
          <div>
            <dt className="text-muted-foreground">{t("agentRunRounds")}</dt>
            <dd className="font-medium text-foreground">
              {run.usage.toolRounds}/{run.budget.maxToolRounds}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("agentRunCalls")}</dt>
            <dd className="font-medium text-foreground">
              {run.usage.toolCalls}/{run.budget.maxToolCalls}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("agentRunTokens")}</dt>
            <dd className="font-medium text-foreground">
              {run.usage.totalTokens.toLocaleString()}
              {run.budget.maxTotalTokens
                ? ` / ${run.budget.maxTotalTokens.toLocaleString()}`
                : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("agentRunElapsed")}</dt>
            <dd className="font-medium text-foreground">
              {formatDuration(elapsedMs)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("agentRunEvidence")}</dt>
            <dd className="font-medium text-foreground">
              {run.evidence.length}
            </dd>
          </div>
        </dl>
        {executionGroups.length > 0 ? (
          <div className="mt-3 space-y-2">
            {executionGroups.map(([round, executions]) => (
              <section
                key={round}
                className="overflow-hidden rounded-lg border border-border bg-background"
              >
                <h4 className="border-b border-border bg-muted/35 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {round > 0
                    ? t("agentRunRoundLabel", { round })
                    : t("agentRunUnassignedRound")}
                </h4>
                <ol className="divide-y divide-border">
                  {executions.map((execution) => {
                    const duration =
                      execution.startedAt && execution.endedAt
                        ? Math.max(0, execution.endedAt - execution.startedAt)
                        : undefined;
                    return (
                      <li
                        key={execution.id}
                        className="flex min-h-11 items-center gap-2.5 px-3 py-2"
                      >
                        <span
                          className={`size-2 shrink-0 rounded-full ${
                            execution.status === "committed"
                              ? "bg-emerald-500"
                              : execution.status === "failed" ||
                                  execution.status === "effect_unknown"
                                ? "bg-amber-500"
                                : "bg-blue-500 motion-safe:animate-pulse"
                          }`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                          {execution.toolName}
                          {execution.targetSummary &&
                          execution.targetSummary !== "*" ? (
                            <span className="ml-2 font-sans text-[10px] text-muted-foreground">
                              {execution.targetSummary}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {t(`agentToolExecution_${execution.status}`)}
                          {duration !== undefined ? ` · ${duration}ms` : ""}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        ) : null}
        {run.stop?.error?.message ? (
          <p className="mt-2 border-l-2 border-amber-500/70 pl-2 text-[11px] text-muted-foreground">
            {run.stop.error.message}
          </p>
        ) : null}
      </div>
    </section>
  );
};

export default React.memo(AgentRunBar);
