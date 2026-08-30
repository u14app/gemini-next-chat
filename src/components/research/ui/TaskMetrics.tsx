"use client";

import React from "react";
import { useTranslations } from "next-intl";

import { InlineStatus } from "@/components/ui/primitives";

import type { ResearchTaskViewModel } from "../types";
import {
  ACTIVE_RESEARCH_STATUSES,
  formatDuration,
  useElapsedMs,
} from "./status";

export function TaskMetrics({ task }: { task: ResearchTaskViewModel }) {
  const t = useTranslations("Research");
  const liveElapsedMs = useElapsedMs(
    task.run?.startedAt,
    task.run?.endedAt,
    ACTIVE_RESEARCH_STATUSES.has(task.status),
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

export function ResearchSourceScope({ task }: { task: ResearchTaskViewModel }) {
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
