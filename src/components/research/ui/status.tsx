"use client";

import React, { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  CircleStop,
  ShieldAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils/cn";

import type { ResearchTaskStatus } from "../types";

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

export function formatDuration(milliseconds: number): string {
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

export function StatusLabel({ status }: { status: ResearchTaskStatus }) {
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
export function useElapsedMs(
  startedAt: number | undefined,
  endedAt: number | undefined,
  live: boolean,
): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live || startedAt === undefined || endedAt !== undefined) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [endedAt, live, startedAt]);
  if (startedAt === undefined) return 0;
  const stoppedAt = endedAt ?? (live ? now : undefined);
  return stoppedAt === undefined ? 0 : Math.max(0, stoppedAt - startedAt);
}
