"use client";

import React from "react";
import { GitBranch } from "lucide-react";
import { useTranslations } from "next-intl";

import { InlineStatus } from "@/components/ui/primitives";

import type { ResearchNodeView } from "../types";

import { PlanList, RunStatusIcon, StopReasonText } from "./primitives";

export function NodeInspector({
  node,
  parent,
  evidenceTitles,
}: {
  node: ResearchNodeView | undefined;
  parent: ResearchNodeView | undefined;
  evidenceTitles: string[];
}) {
  const t = useTranslations("Research");
  if (!node) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center">
        <GitBranch size={24} className="text-muted-foreground" aria-hidden />
        <p className="mt-3 text-sm font-medium text-foreground">
          {t("run.selectNode")}
        </p>
      </div>
    );
  }

  return (
    <article
      className="min-w-0 p-4 sm:p-5"
      aria-labelledby={`research-node-inspector-${node.id}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30">
          <RunStatusIcon status={node.status} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {t("run.nodeDepth", { depth: node.depth })}
          </p>
          <h3
            id={`research-node-inspector-${node.id}`}
            className="mt-1 wrap-break-word text-sm font-semibold leading-5 text-foreground"
          >
            {node.objective}
          </h3>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border text-xs">
        <div className="bg-background px-3 py-2.5">
          <dt className="text-muted-foreground">{t("metrics.evidence")}</dt>
          <dd className="mt-1 font-mono tabular-nums text-foreground">
            {node.evidenceIds.length}
          </dd>
        </div>
        <div className="bg-background px-3 py-2.5">
          <dt className="text-muted-foreground">
            {t("metrics.verifiedClaims")}
          </dt>
          <dd className="mt-1 font-mono tabular-nums text-foreground">
            {node.verifiedClaimCount}/{node.claimIds.length}
          </dd>
        </div>
      </dl>

      {node.query ? (
        <section className="mt-5">
          <h4 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {t("run.query")}
          </h4>
          <p className="mt-1.5 wrap-break-word font-mono text-xs leading-5 text-foreground/90">
            {node.query}
          </p>
        </section>
      ) : null}

      {parent ? (
        <section className="mt-5">
          <h4 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {t("run.parentNode")}
          </h4>
          <p className="mt-1.5 text-xs leading-5 text-foreground/80">
            {parent.objective}
          </p>
        </section>
      ) : null}

      {node.learnings.length ? (
        <section className="mt-5">
          <h4 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {t("run.learnings")}
          </h4>
          <PlanList items={node.learnings} />
        </section>
      ) : null}

      {node.followUps.length ? (
        <section className="mt-5">
          <h4 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {t("run.followUps")}
          </h4>
          <PlanList items={node.followUps} />
        </section>
      ) : null}

      {evidenceTitles.length ? (
        <section className="mt-5">
          <h4 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {t("run.linkedEvidence")}
          </h4>
          <PlanList items={evidenceTitles} />
        </section>
      ) : null}

      {node.scopeImpact && node.scopeImpact !== "within" ? (
        <InlineStatus tone="warning" className="mt-5">
          {t("run.scopeApproval")}
        </InlineStatus>
      ) : null}
      {node.stopReason ? (
        <p className="mt-5 text-xs leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">
            {t("run.stopReason")}:{" "}
          </span>
          <StopReasonText reason={node.stopReason} />
        </p>
      ) : null}
    </article>
  );
}
