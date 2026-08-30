"use client";

import React from "react";
import { GitBranch } from "lucide-react";
import { useTranslations } from "next-intl";

import type { ResearchRunView } from "../types";

import { StopReasonText } from "./primitives";

export function ResearchRunRail({ run }: { run: ResearchRunView }) {
  const t = useTranslations("Research");
  return (
    <section
      className="border-b border-research-border bg-research-soft/70 px-4 py-3"
      aria-label={t("run.statusRail")}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-research-accent-text">
          <GitBranch size={14} aria-hidden="true" />
          <span>{t(`run.phase.${run.phase}`)}</span>
        </div>
        <dl className="flex flex-1 flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
          <div className="inline-flex gap-1.5">
            <dt>{t("metrics.wave")}</dt>
            <dd className="font-mono tabular-nums text-foreground">
              {run.currentWave ?? 0}/{run.waves.length}
            </dd>
          </div>
          <div className="inline-flex gap-1.5">
            <dt>{t("metrics.queries")}</dt>
            <dd className="font-mono tabular-nums text-foreground">
              {run.queryUsage.used}/{run.queryUsage.limit}
            </dd>
          </div>
          <div className="inline-flex gap-1.5">
            <dt>{t("metrics.verifiedClaims")}</dt>
            <dd className="font-mono tabular-nums text-foreground">
              {run.claimCounts.verified}/{run.claimCounts.total}
            </dd>
          </div>
          <div className="inline-flex gap-1.5">
            <dt>{t("metrics.depth")}</dt>
            <dd className="font-mono tabular-nums text-foreground">
              {run.currentDepth}/{run.maxDepth}
            </dd>
          </div>
        </dl>
        {run.stopReason ? (
          <p className="w-full text-xs leading-5 text-amber-700 dark:text-amber-300">
            <span className="font-medium">{t("run.stopReason")}: </span>
            <StopReasonText reason={run.stopReason} />
          </p>
        ) : null}
      </div>
    </section>
  );
}
