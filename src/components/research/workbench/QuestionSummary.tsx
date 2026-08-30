"use client";

import React from "react";
import { Check, Circle, ExternalLink, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { getSafeExternalHref } from "@/lib/security/clientUrl";

import type { ResearchEvidenceView, ResearchPlanView } from "../types";

export function QuestionStatusIcon({
  status,
}: {
  status: ResearchPlanView["steps"][number]["status"];
}) {
  if (status === "completed") {
    return (
      <Check
        size={16}
        className="text-emerald-600 dark:text-emerald-400"
        aria-hidden="true"
      />
    );
  }
  if (status === "in_progress") {
    return (
      <LoaderCircle
        size={16}
        className="animate-spin text-research-accent motion-reduce:animate-none"
        aria-hidden="true"
      />
    );
  }
  return (
    <Circle size={15} className="text-muted-foreground" aria-hidden="true" />
  );
}

export function QuestionEvidenceSummary({
  evidence,
}: {
  evidence: ResearchEvidenceView[];
}) {
  const t = useTranslations("Research");
  if (evidence.length === 0) return null;
  const supporting = evidence.filter(
    (item) => item.stance === "supports",
  ).length;
  const conflicting = evidence.filter(
    (item) => item.stance === "contradicts",
  ).length;

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-muted-foreground">
        {t("evidence.questionSummary", {
          count: evidence.length,
          supporting,
          conflicting,
        })}
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {evidence.map((item) => {
          const safeHref = item.url ? getSafeExternalHref(item.url) : null;
          return (
            <li key={item.id} className="min-w-0">
              {safeHref ? (
                <a
                  href={safeHref}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex min-h-11 items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <ExternalLink
                    size={13}
                    className="shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </a>
              ) : (
                <div className="rounded-md border border-border px-3 py-2 text-xs text-foreground">
                  {item.title}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
