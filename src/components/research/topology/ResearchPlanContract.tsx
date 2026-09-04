"use client";

import React, { useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { useTranslations } from "next-intl";

import { InlineStatus } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";

import ResearchDisclosure from "../ResearchDisclosure";
import type { ResearchPlanView } from "../types";

import { PlanList } from "./primitives";

export function ResearchPlanContract({
  plan,
  compact = false,
  advancedOnly = false,
}: {
  plan: ResearchPlanView;
  compact?: boolean;
  advancedOnly?: boolean;
}) {
  const t = useTranslations("Research");
  const [reconOpen, setReconOpen] = useState(false);
  const recon = plan.recon;
  const knowledgeQueries = recon?.knowledgeQueries ?? [];
  const reconNeedsWarning =
    recon?.status === "partial" || recon?.status === "unavailable";
  const reconSummary = recon
    ? knowledgeQueries.length > 0
      ? `${t("plan.knowledgeRecon", { count: knowledgeQueries.length })}${
          recon.queryCount > 0
            ? ` · ${t("plan.reconSummary", {
                used: recon.queryCount,
                limit: recon.maxQueries,
              })}`
            : ""
        }`
      : recon.status === "skipped"
        ? t("plan.reconStatus.skipped")
        : t("plan.reconSummary", {
            used: recon.queryCount,
            limit: recon.maxQueries,
          })
    : "";
  const hasScope = Boolean(
    plan.scope &&
    (plan.scope.audience ||
      plan.scope.timeRange ||
      plan.scope.allowedSourceTypes?.length ||
      plan.scope.includes.length ||
      plan.scope.excludes.length ||
      plan.scope.preferredDomains?.length ||
      plan.scope.excludedDomains?.length),
  );
  const hasPlanContract = advancedOnly
    ? Boolean(
        plan.assumptions?.length ||
        plan.deliverable ||
        plan.strategy ||
        plan.completionCriteria?.length,
      )
    : Boolean(
        plan.objective ||
        hasScope ||
        plan.assumptions?.length ||
        plan.deliverable ||
        plan.strategy ||
        plan.completionCriteria?.length,
      );

  if (!hasPlanContract && !plan.recon) return null;

  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      {plan.strategy || plan.deliverable ? (
        <dl
          className={cn(
            "grid gap-px overflow-hidden rounded-lg border border-research-border bg-research-border",
            compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4",
          )}
        >
          {plan.deliverable ? (
            <div className="bg-background px-3 py-2.5">
              <dt className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                {t("plan.deliverable")}
              </dt>
              <dd className="mt-1 text-xs font-medium text-foreground">
                {t(`deliverable.${plan.deliverable.kind}`)}
              </dd>
              {!compact && plan.deliverable.description ? (
                <dd className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  {plan.deliverable.description}
                </dd>
              ) : null}
            </div>
          ) : null}
          {plan.strategy ? (
            <>
              <div className="bg-background px-3 py-2.5">
                <dt className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  {t("plan.initialBreadth")}
                </dt>
                <dd className="mt-1 font-mono text-xs font-medium tabular-nums text-foreground">
                  {plan.strategy.initialBreadth}
                </dd>
              </div>
              <div className="bg-background px-3 py-2.5">
                <dt className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  {t("plan.maxDepth")}
                </dt>
                <dd className="mt-1 font-mono text-xs font-medium tabular-nums text-foreground">
                  {plan.strategy.maxDepth}
                </dd>
              </div>
              <div className="bg-background px-3 py-2.5">
                <dt className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  {t("plan.queryLimit")}
                </dt>
                <dd className="mt-1 font-mono text-xs font-medium tabular-nums text-foreground">
                  {plan.strategy.queryLimit}
                </dd>
              </div>
            </>
          ) : null}
        </dl>
      ) : null}

      {!compact && !advancedOnly && plan.objective ? (
        <section>
          <h4 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {t("plan.objective")}
          </h4>
          <p className="mt-1.5 text-sm leading-6 text-foreground/90">
            {plan.objective}
          </p>
        </section>
      ) : null}

      {!compact && !advancedOnly && hasScope && plan.scope ? (
        <section>
          <h4 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {t("plan.scope")}
          </h4>
          <dl className="mt-2 grid gap-3 text-xs sm:grid-cols-2">
            {plan.scope.audience ? (
              <div>
                <dt className="text-muted-foreground">{t("plan.audience")}</dt>
                <dd className="mt-1 leading-5 text-foreground">
                  {plan.scope.audience}
                </dd>
              </div>
            ) : null}
            {plan.scope.timeRange ? (
              <div>
                <dt className="text-muted-foreground">{t("plan.timeRange")}</dt>
                <dd className="mt-1 leading-5 text-foreground">
                  {plan.scope.timeRange}
                </dd>
              </div>
            ) : null}
            {plan.scope.allowedSourceTypes?.length ? (
              <div>
                <dt className="text-muted-foreground">
                  {t("plan.allowedSources")}
                </dt>
                <dd className="mt-1 leading-5 text-foreground">
                  {plan.scope.allowedSourceTypes
                    .map((sourceType) => t(`sourceType.${sourceType}`))
                    .join(", ")}
                </dd>
              </div>
            ) : null}
            {plan.scope.includes.length ? (
              <div>
                <dt className="text-muted-foreground">{t("plan.includes")}</dt>
                <dd>
                  <PlanList items={plan.scope.includes} />
                </dd>
              </div>
            ) : null}
            {plan.scope.excludes.length ? (
              <div>
                <dt className="text-muted-foreground">{t("plan.excludes")}</dt>
                <dd>
                  <PlanList items={plan.scope.excludes} />
                </dd>
              </div>
            ) : null}
            {plan.scope.preferredDomains?.length ? (
              <div>
                <dt className="text-muted-foreground">
                  {t("plan.preferredDomains")}
                </dt>
                <dd className="mt-1 leading-5 text-foreground">
                  {plan.scope.preferredDomains.join(", ")}
                </dd>
              </div>
            ) : null}
            {plan.scope.excludedDomains?.length ? (
              <div>
                <dt className="text-muted-foreground">
                  {t("plan.excludedDomains")}
                </dt>
                <dd className="mt-1 leading-5 text-foreground">
                  {plan.scope.excludedDomains.join(", ")}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      {!compact && plan.strategy ? (
        <section>
          <h4 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {t("plan.strategy")}
          </h4>
          <dl className="mt-2 grid grid-cols-2 gap-x-5 gap-y-2 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">
                {t("plan.resultsPerQuery")}
              </dt>
              <dd className="mt-0.5 font-mono tabular-nums text-foreground">
                {plan.strategy.resultsPerQuery}
              </dd>
            </div>
            {plan.strategy.reservedValidationQueries !== undefined ? (
              <div>
                <dt className="text-muted-foreground">
                  {t("plan.validationReserve")}
                </dt>
                <dd className="mt-0.5 font-mono tabular-nums text-foreground">
                  {plan.strategy.reservedValidationQueries}
                </dd>
              </div>
            ) : null}
            {plan.strategy.sourceContentLimit !== undefined ? (
              <div>
                <dt className="text-muted-foreground">
                  {t("plan.sourceLimit")}
                </dt>
                <dd className="mt-0.5 font-mono tabular-nums text-foreground">
                  {plan.strategy.sourceContentLimit}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      {!compact && plan.assumptions?.length ? (
        <section>
          <h4 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {t("plan.assumptions")}
          </h4>
          <PlanList items={plan.assumptions} />
        </section>
      ) : null}

      {!compact && plan.completionCriteria?.length ? (
        <section>
          <h4 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {t("plan.completionCriteria")}
          </h4>
          <PlanList items={plan.completionCriteria} />
        </section>
      ) : null}

      {recon ? (
        <ResearchDisclosure
          open={reconOpen}
          onOpenChange={setReconOpen}
          className="border-t border-border pt-3"
          triggerClassName="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm text-left text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          summary={(isOpen) => (
            <>
              <Search
                size={14}
                className="text-research-accent"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">{reconSummary}</span>
              <ChevronDown
                size={14}
                className={cn(
                  "transition-transform duration-200 ease-out motion-reduce:transition-none",
                  isOpen && "rotate-180",
                )}
                aria-hidden="true"
              />
            </>
          )}
        >
          <div className="mt-2 rounded-md border border-border p-3">
            <InlineStatus tone={reconNeedsWarning ? "warning" : "neutral"}>
              {t("plan.reconDisclosure")}
            </InlineStatus>
            {recon.status !== "completed" ? (
              <p
                className={cn(
                  "mt-2 text-xs leading-5",
                  reconNeedsWarning
                    ? "text-amber-700 dark:text-amber-300"
                    : "text-muted-foreground",
                )}
              >
                {t(`plan.reconStatus.${recon.status}`)}
              </p>
            ) : null}
            {recon.queries.length ? (
              <ol className="mt-3 space-y-2">
                {recon.queries.map((item, index) => (
                  <li
                    key={item.id}
                    className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 text-xs"
                  >
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <p className="wrap-break-word font-medium text-foreground">
                        {item.query}
                      </p>
                      <p className="mt-0.5 wrap-break-word leading-5 text-muted-foreground">
                        {t("plan.reconResult", {
                          count: item.resultCount,
                          domains: item.domains.length
                            ? item.domains.join(", ")
                            : t("plan.noDomains"),
                        })}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}
            {knowledgeQueries.length ? (
              <div className={cn(recon.queries.length > 0 && "mt-4")}>
                <p className="text-xs font-medium text-foreground">
                  {t("plan.knowledgeRecon", {
                    count: knowledgeQueries.length,
                  })}
                </p>
                <ol className="mt-2 space-y-2">
                  {knowledgeQueries.map((item, index) => (
                    <li
                      key={item.id}
                      className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 text-xs"
                    >
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <p className="wrap-break-word font-medium text-foreground">
                          {item.query}
                        </p>
                        <p className="mt-0.5 wrap-break-word leading-5 text-muted-foreground">
                          {t("plan.reconResult", {
                            count: item.resultCount,
                            domains: t("sourceType.knowledge"),
                          })}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        </ResearchDisclosure>
      ) : null}
    </div>
  );
}
