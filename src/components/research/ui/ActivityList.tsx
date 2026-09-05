"use client";

import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  CircleStop,
  CircleX,
  LoaderCircle,
} from "lucide-react";
import { useLocale } from "next-intl";

import { cn } from "@/lib/utils/cn";

import type { ResearchActivityView } from "../types";
import { formatResearchTime } from "../formatters";

/**
 * The run's activity timeline. Shared by the workbench panel and the progress
 * card so the two never drift; `limit` keeps the card to a glanceable tail.
 */
export function ActivityList({
  activities,
  limit,
}: {
  activities: ResearchActivityView[];
  limit?: number;
}) {
  const locale = useLocale();
  const items = limit ? activities.slice(-limit) : activities;
  return (
    <ol className="border-l border-border pl-4">
      {items.map((item) => {
        const status = item.status ?? "info";
        const isPending = status === "prepared" || status === "running";
        return (
          <li key={item.id} className="relative pb-3 last:pb-0">
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3
                  className={cn(
                    "flex min-w-0 items-center gap-1.5 wrap-break-word text-sm font-medium",
                    item.tone === "warning" &&
                      "text-amber-800 dark:text-amber-200",
                  )}
                >
                  {isPending ? (
                    <LoaderCircle
                      size={12}
                      className="shrink-0 animate-spin text-research-accent motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : status === "committed" || status === "completed" ? (
                    item.tone === "warning" ? (
                      <AlertTriangle
                        size={13}
                        className="shrink-0 text-amber-600 dark:text-amber-400"
                        aria-hidden="true"
                      />
                    ) : (
                      <CheckCircle2
                        size={13}
                        className="shrink-0 text-emerald-600 dark:text-emerald-400"
                        aria-hidden="true"
                      />
                    )
                  ) : status === "failed" ? (
                    <CircleX
                      size={13}
                      className="shrink-0 text-red-600 dark:text-red-400"
                      aria-hidden="true"
                    />
                  ) : status === "effect_unknown" ? (
                    <CircleHelp
                      size={13}
                      className="shrink-0 text-amber-600 dark:text-amber-400"
                      aria-hidden="true"
                    />
                  ) : status === "interrupted" ? (
                    <CircleStop
                      size={13}
                      className="shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : item.tone === "warning" ? (
                    <AlertTriangle
                      size={13}
                      className="shrink-0 text-amber-600 dark:text-amber-400"
                      aria-hidden="true"
                    />
                  ) : null}
                  {item.title}
                </h3>
                <time className="shrink-0 text-[11px] text-muted-foreground">
                  {formatResearchTime(item.createdAt, locale)}
                </time>
              </div>
              {item.detail ? (
                <p className="mt-1 wrap-break-word text-xs leading-5 text-muted-foreground">
                  {item.detail}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
