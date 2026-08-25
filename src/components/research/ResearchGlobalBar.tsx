"use client";

import React from "react";
import { ArrowUpRight, Pause } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/primitives";

import { StatusLabel } from "./researchUi";
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

  return (
    <aside
      className="border-b border-border bg-background/95 px-3 py-2 backdrop-blur supports-backdrop-filter:bg-background/85"
      aria-label={t("global.label")}
    >
      <div className="mx-auto flex min-h-10 max-w-5xl items-center gap-3">
        <div className="min-w-0 flex-1">
          <div aria-live="polite" aria-atomic="true">
            <StatusLabel status={task.status} />
          </div>
          <p className="truncate text-xs text-foreground/80">{task.title}</p>
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
          variant="primary"
          onClick={onOpenWorkbench}
          aria-label={t("actions.returnWorkbench")}
          className="h-9 bg-research-accent text-research-accent-foreground hover:bg-research-accent-hover sm:h-8"
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
