"use client";

import React from "react";
import { ArrowUpRight, Pause } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/primitives";

import {
  ACTIVE_RESEARCH_STATUSES,
  StatusLabel,
  formatDuration,
  useElapsedMs,
} from "./researchUi";
import type { ResearchTaskViewModel } from "./types";

export interface ResearchGlobalBarProps {
  task: ResearchTaskViewModel;
  onOpenWorkbench: () => void;
  onPause?: () => void;
}

export default function ResearchGlobalBar({
  task,
  onOpenWorkbench,
  onPause,
}: ResearchGlobalBarProps) {
  const t = useTranslations("Research");
  const isRunning = ACTIVE_RESEARCH_STATUSES.has(task.status);
  const elapsedMs = useElapsedMs(
    task.run?.startedAt,
    isRunning && !task.run?.endedAt,
  );
  // The bar is the only research affordance once the card scrolls away, so it
  // carries the same proof-of-life the progress card does.
  const latestActivity = task.activities.at(-1);

  return (
    <aside
      className="border-b border-border bg-background/95 px-3 py-2 backdrop-blur supports-backdrop-filter:bg-background/85"
      aria-label={t("global.label")}
    >
      <div className="mx-auto flex min-h-10 max-w-5xl items-center gap-3">
        <div className="min-w-0 flex-1">
          <div
            className="flex flex-wrap items-center gap-x-2"
            aria-live="polite"
            aria-atomic="true"
          >
            <StatusLabel status={task.status} />
            {task.run ? (
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatDuration(elapsedMs || task.usage.elapsedMs)}
              </span>
            ) : null}
          </div>
          <p className="truncate text-xs text-foreground/80">{task.title}</p>
          {isRunning && latestActivity ? (
            <p className="truncate text-[11px] text-muted-foreground">
              {latestActivity.title}
            </p>
          ) : null}
        </div>
        {onPause ? (
          <Button
            size="sm"
            onClick={onPause}
            aria-label={t("actions.pause")}
            className="h-9 sm:h-8"
          >
            <Pause size={14} aria-hidden="true" />
            <span className="hidden sm:inline">{t("actions.pause")}</span>
          </Button>
        ) : null}
        <Button
          size="sm"
          onClick={onOpenWorkbench}
          aria-label={t("actions.returnWorkbench")}
          className="h-9 sm:h-8"
        >
          <ArrowUpRight size={14} aria-hidden="true" />
          <span className="hidden sm:inline">
            {t("actions.returnWorkbench")}
          </span>
          <span className="sm:hidden">{t("actions.open")}</span>
        </Button>
      </div>
    </aside>
  );
}
