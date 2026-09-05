"use client";

import React, { useId, useMemo, useState } from "react";
import { ExternalLink, Search, SearchCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { CustomSelect } from "@/components/ui/controls";
import { Button, Input } from "@/components/ui/primitives";
import { getSafeExternalHref } from "@/lib/security/clientUrl";
import { cn } from "@/lib/utils/cn";

import type { ResearchEvidenceView, ResearchTaskViewModel } from "../types";
import { formatResearchDateTime } from "../formatters";

import { EVIDENCE_STANCES, type EvidenceStance } from "./workbenchUtils";

function EvidenceListItem({
  evidence,
  questionTitles,
}: {
  evidence: ResearchEvidenceView;
  questionTitles: string[];
}) {
  const locale = useLocale();
  const t = useTranslations("Research");
  const safeHref = evidence.url ? getSafeExternalHref(evidence.url) : null;
  const relatedQuestions = (evidence.questionIndexes ?? []).flatMap((index) =>
    questionTitles[index] ? [index] : [],
  );
  const linkedClaims = evidence.linkedClaims ?? [];
  const isInternalResult = Boolean(
    evidence.locator?.startsWith("workspace:///tool-results/") ||
    evidence.locator?.startsWith("tool-results/") ||
    evidence.title.startsWith("tool-results/"),
  );

  return (
    <article
      className="grid gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_auto]"
      aria-labelledby={`research-evidence-${evidence.id}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            {isInternalResult
              ? t("evidence.internalResult")
              : evidence.domain || t(`sourceType.${evidence.sourceType}`)}
          </span>
          <time dateTime={new Date(evidence.retrievedAt).toISOString()}>
            {formatResearchDateTime(evidence.retrievedAt, locale)}
          </time>
          {evidence.stance ? (
            <span>{t(`stance.${evidence.stance}`)}</span>
          ) : null}
          {linkedClaims.length === 0 && evidence.verificationStatus ? (
            <span>
              {t(`verificationStatus.${evidence.verificationStatus}`)}
            </span>
          ) : null}
          {evidence.authority ? (
            <span>{t(`authority.${evidence.authority}`)}</span>
          ) : null}
        </div>
        {linkedClaims.length > 0 ? (
          <ul className="mt-3 space-y-3">
            {linkedClaims.map((claim, index) => (
              <li key={claim.id}>
                <p
                  id={
                    index === 0 ? `research-evidence-${evidence.id}` : undefined
                  }
                  tabIndex={index === 0 ? -1 : undefined}
                  className="wrap-break-word text-sm font-semibold leading-6 text-foreground"
                >
                  {claim.text}
                </p>
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{t(`claimImportance.${claim.importance}`)}</span>
                  <span>
                    {t(`verificationStatus.${claim.verificationStatus}`)}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p
            id={`research-evidence-${evidence.id}`}
            tabIndex={-1}
            className="mt-3 text-sm font-medium leading-6 text-muted-foreground"
          >
            {t("evidence.unlinkedClaim")}
          </p>
        )}
        {relatedQuestions.length > 0 ? (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {t("metrics.questions")}:{" "}
            {relatedQuestions
              .map((index) =>
                t("evidence.questionShort", { number: index + 1 }),
              )
              .join(", ")}
          </p>
        ) : null}
        {evidence.excerpt ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-foreground/80">
            {evidence.excerpt}
          </p>
        ) : null}
        <div className="mt-3 border-t border-border/70 pt-3 text-xs leading-5 text-muted-foreground">
          <p className="wrap-break-word">
            <span className="font-medium text-foreground/75">
              {t("evidence.sourceLabel")}:{" "}
            </span>
            {isInternalResult ? t("evidence.internalResult") : evidence.title}
          </p>
          {evidence.locator && !safeHref ? (
            isInternalResult ? (
              <details className="mt-1">
                <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {t("evidence.technicalDetails")}
                </summary>
                <p className="mt-1 wrap-break-word font-mono text-[11px]">
                  {evidence.locator}
                </p>
              </details>
            ) : (
              <p className="mt-1 wrap-break-word">{evidence.locator}</p>
            )
          ) : null}
        </div>
      </div>
      {safeHref ? (
        <a
          href={safeHref}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={t("evidence.openSource", { title: evidence.title })}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 self-start rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("evidence.openSource", { title: evidence.title })}
          <ExternalLink size={14} aria-hidden="true" />
        </a>
      ) : null}
    </article>
  );
}

export function EvidencePanel({ task }: { task: ResearchTaskViewModel }) {
  const t = useTranslations("Research");
  const controlId = useId();
  const [query, setQuery] = useState("");
  const [questionFilter, setQuestionFilter] = useState<number | "all">("all");
  const [stanceFilter, setStanceFilter] = useState<EvidenceStance | "all">(
    "all",
  );
  const [domainFilter, setDomainFilter] = useState("all");
  const [authorityFilter, setAuthorityFilter] = useState("all");
  const [freshnessFilter, setFreshnessFilter] = useState("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "claims">("newest");
  const questionTitles = task.plan?.steps.map((step) => step.title) ?? [];
  const domains = useMemo(
    () =>
      Array.from(
        new Set(
          task.evidence.flatMap((item) => (item.domain ? [item.domain] : [])),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [task.evidence],
  );
  const filteredEvidence = useMemo(() => {
    const normalizedQuery = query.normalize("NFKC").trim().toLowerCase();
    return task.evidence
      .filter((item) => {
        const matchesQuestion =
          questionFilter === "all" ||
          item.questionIndexes?.includes(questionFilter);
        const matchesStance =
          stanceFilter === "all" || item.stance === stanceFilter;
        const matchesDomain =
          domainFilter === "all" || item.domain === domainFilter;
        const matchesAuthority =
          authorityFilter === "all" || item.authority === authorityFilter;
        const matchesFreshness =
          freshnessFilter === "all" || item.freshness === freshnessFilter;
        const searchable = [
          item.title,
          item.locator,
          item.domain,
          item.excerpt,
          ...(item.linkedClaims ?? []).map((claim) => claim.text),
        ]
          .filter(Boolean)
          .join("\n")
          .normalize("NFKC")
          .toLowerCase();
        return (
          matchesQuestion &&
          matchesStance &&
          matchesDomain &&
          matchesAuthority &&
          matchesFreshness &&
          (!normalizedQuery || searchable.includes(normalizedQuery))
        );
      })
      .sort((left, right) => {
        if (sort === "oldest") return left.retrievedAt - right.retrievedAt;
        if (sort === "claims") {
          const claimDifference =
            (right.linkedClaims?.length ?? 0) -
            (left.linkedClaims?.length ?? 0);
          if (claimDifference !== 0) return claimDifference;
        }
        return right.retrievedAt - left.retrievedAt;
      });
  }, [
    authorityFilter,
    domainFilter,
    freshnessFilter,
    query,
    questionFilter,
    sort,
    stanceFilter,
    task.evidence,
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <h2 className="text-lg font-semibold">{t("evidence.title")}</h2>
      <div className="mt-4 space-y-3 border-b border-border pb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="min-w-0 text-xs font-medium text-foreground lg:col-span-2">
            <span>{t("evidence.searchLabel")}</span>
            <span className="relative mt-1 block">
              <Search
                size={15}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("evidence.searchPlaceholder")}
                className="h-11 bg-background pl-9 md:h-9"
              />
            </span>
          </label>
          <div className="min-w-0 text-xs font-medium text-foreground">
            <label htmlFor={`${controlId}-domain`}>
              {t("evidence.domain")}
            </label>
            <CustomSelect
              id={`${controlId}-domain`}
              value={domainFilter}
              onChange={setDomainFilter}
              ariaLabel={t("evidence.domain")}
              options={[
                { value: "all", label: t("evidence.allDomains") },
                ...domains.map((domain) => ({ value: domain, label: domain })),
              ]}
              selectButtonClassName="mt-1 flex h-11 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9"
            />
          </div>
          <div className="min-w-0 text-xs font-medium text-foreground">
            <label htmlFor={`${controlId}-sort`}>{t("evidence.sort")}</label>
            <CustomSelect
              id={`${controlId}-sort`}
              value={sort}
              onChange={(value) =>
                setSort(value as "newest" | "oldest" | "claims")
              }
              ariaLabel={t("evidence.sort")}
              options={[
                { value: "newest", label: t("evidence.sortNewest") },
                { value: "oldest", label: t("evidence.sortOldest") },
                { value: "claims", label: t("evidence.sortClaimCount") },
              ]}
              selectButtonClassName="mt-1 flex h-11 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9"
            />
          </div>
          <div className="min-w-0 text-xs font-medium text-foreground">
            <label htmlFor={`${controlId}-authority`}>
              {t("evidence.authorityFilter")}
            </label>
            <CustomSelect
              id={`${controlId}-authority`}
              value={authorityFilter}
              onChange={setAuthorityFilter}
              ariaLabel={t("evidence.authorityFilter")}
              options={[
                { value: "all", label: t("evidence.allAuthorities") },
                ...(["primary", "secondary", "unknown"] as const).map(
                  (authority) => ({
                    value: authority,
                    label: t(`authority.${authority}`),
                  }),
                ),
              ]}
              selectButtonClassName="mt-1 flex h-11 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9"
            />
          </div>
          <div className="min-w-0 text-xs font-medium text-foreground">
            <label htmlFor={`${controlId}-freshness`}>
              {t("evidence.freshnessFilter")}
            </label>
            <CustomSelect
              id={`${controlId}-freshness`}
              value={freshnessFilter}
              onChange={setFreshnessFilter}
              ariaLabel={t("evidence.freshnessFilter")}
              options={[
                { value: "all", label: t("evidence.allFreshness") },
                ...(["current", "stale", "unknown"] as const).map(
                  (freshness) => ({
                    value: freshness,
                    label: t(`freshness.${freshness}`),
                  }),
                ),
              ]}
              selectButtonClassName="mt-1 flex h-11 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9"
            />
          </div>
        </div>
        {questionTitles.length > 0 ? (
          <div
            className="flex gap-1 overflow-x-auto pb-1 [&_button]:h-9 sm:[&_button]:h-8"
            role="group"
            aria-label={t("metrics.questions")}
          >
            <Button
              size="sm"
              variant={questionFilter === "all" ? "primary" : "ghost"}
              onClick={() => setQuestionFilter("all")}
              className={cn(
                "shrink-0",
                questionFilter === "all" &&
                  "bg-research-solid text-research-accent-foreground hover:bg-research-accent-hover",
              )}
            >
              {t("evidence.allQuestions")}
            </Button>
            {questionTitles.map((question, index) => (
              <Button
                key={question}
                size="sm"
                variant={questionFilter === index ? "primary" : "ghost"}
                onClick={() => setQuestionFilter(index)}
                className={cn(
                  "shrink-0",
                  questionFilter === index &&
                    "bg-research-solid text-research-accent-foreground hover:bg-research-accent-hover",
                )}
                aria-label={`${t("evidence.questionShort", { number: index + 1 })}: ${question}`}
              >
                {t("evidence.questionShort", { number: index + 1 })}
              </Button>
            ))}
          </div>
        ) : null}
        <div
          className="flex gap-1 overflow-x-auto pb-1 [&_button]:h-9 sm:[&_button]:h-8"
          role="group"
          aria-label={t("evidence.stance")}
        >
          <Button
            size="sm"
            variant={stanceFilter === "all" ? "primary" : "ghost"}
            onClick={() => setStanceFilter("all")}
            className={cn(
              "shrink-0",
              stanceFilter === "all" &&
                "bg-research-solid text-research-accent-foreground hover:bg-research-accent-hover",
            )}
          >
            {t("evidence.allRelationships")}
          </Button>
          {EVIDENCE_STANCES.map((stance) => (
            <Button
              key={stance}
              size="sm"
              variant={stanceFilter === stance ? "primary" : "ghost"}
              onClick={() => setStanceFilter(stance)}
              className={cn(
                "shrink-0",
                stanceFilter === stance &&
                  "bg-research-solid text-research-accent-foreground hover:bg-research-accent-hover",
              )}
            >
              {t(`stance.${stance}`)}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {t("evidence.results", { count: filteredEvidence.length })}
        </p>
      </div>
      {filteredEvidence.length > 0 ? (
        <ul className="divide-y divide-border">
          {filteredEvidence.map((item) => (
            <li key={item.id}>
              <EvidenceListItem
                evidence={item}
                questionTitles={questionTitles}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center">
          <SearchCheck
            size={26}
            className="text-muted-foreground"
            aria-hidden="true"
          />
          <h3 className="mt-3 text-sm font-semibold">
            {t("evidence.emptyTitle")}
          </h3>
          <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
            {task.evidence.length
              ? t("evidence.noFilterResults")
              : t("evidence.emptyDescription")}
          </p>
        </div>
      )}
    </div>
  );
}
