"use client";

import React from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils/cn";

import type { ResearchActivityView } from "../types";

/**
 * The run's activity timeline. Shared by the workbench panel and the progress
 * card so the two never drift; `limit` keeps the card to a glanceable tail.
 */
export function ActivityList({
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
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3
                  className={cn(
                    "flex min-w-0 items-center gap-1.5 wrap-break-word text-sm font-medium",
                    item.tone === "warning" &&
                      "text-amber-800 dark:text-amber-200",
                  )}
                >
                  {isNewest ? (
                    <LoaderCircle
                      size={12}
                      className="shrink-0 animate-spin text-research-accent motion-reduce:animate-none"
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
                  {new Date(item.createdAt).toLocaleTimeString()}
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
