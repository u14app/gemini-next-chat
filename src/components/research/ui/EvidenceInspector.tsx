"use client";

import React from "react";
import { ExternalLink, SearchCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { getSafeExternalHref } from "@/lib/security/clientUrl";

import type { ResearchEvidenceView } from "../types";

export function EvidenceInspector({
  evidence,
  idPrefix = "evidence",
}: {
  evidence: ResearchEvidenceView | undefined;
  idPrefix?: string;
}) {
  const t = useTranslations("Research");
  if (!evidence) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center px-5 text-center">
        <SearchCheck
          size={24}
          className="text-muted-foreground"
          aria-hidden="true"
        />
        <p className="mt-3 text-sm font-medium text-foreground">
          {t("evidence.emptyTitle")}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {t("evidence.emptyDescription")}
        </p>
      </div>
    );
  }

  const safeHref = evidence.url ? getSafeExternalHref(evidence.url) : null;
  return (
    <article
      id={`${idPrefix}-${evidence.id}`}
      className="min-w-0 p-4"
      aria-labelledby={`${idPrefix}-${evidence.id}-title`}
      tabIndex={-1}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t(`sourceType.${evidence.sourceType}`)}
          </p>
          <h3
            id={`${idPrefix}-${evidence.id}-title`}
            className="mt-1 wrap-break-word text-sm font-semibold text-foreground"
          >
            {evidence.title}
          </h3>
        </div>
        {safeHref ? (
          <a
            href={safeHref}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={t("evidence.openSource", { title: evidence.title })}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLink size={15} aria-hidden="true" />
          </a>
        ) : null}
      </div>
      <dl className="mt-4 space-y-2 border-y border-border py-3 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("evidence.retrieved")}</dt>
          <dd className="text-right text-foreground">
            {new Date(evidence.retrievedAt).toLocaleString()}
          </dd>
        </div>
        {evidence.locator ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("evidence.location")}</dt>
            <dd className="wrap-break-word text-right text-foreground">
              {evidence.locator}
            </dd>
          </div>
        ) : null}
        {evidence.stance ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("evidence.stance")}</dt>
            <dd className="text-right text-foreground">
              {t(`stance.${evidence.stance}`)}
            </dd>
          </div>
        ) : null}
        {evidence.freshness ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("evidence.freshness")}</dt>
            <dd className="text-right text-foreground">
              {t(`freshness.${evidence.freshness}`)}
            </dd>
          </div>
        ) : null}
        {evidence.verificationStatus ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">
              {t("evidence.verification")}
            </dt>
            <dd className="text-right text-foreground">
              {t(`verificationStatus.${evidence.verificationStatus}`)}
            </dd>
          </div>
        ) : null}
        {evidence.authority ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("evidence.authority")}</dt>
            <dd className="text-right text-foreground">
              {t(`authority.${evidence.authority}`)}
            </dd>
          </div>
        ) : null}
      </dl>
      {evidence.excerpt ? (
        <blockquote className="mt-4 border-l-2 border-research-accent/60 pl-3 text-sm leading-6 text-foreground/85">
          {evidence.excerpt}
        </blockquote>
      ) : null}
    </article>
  );
}
