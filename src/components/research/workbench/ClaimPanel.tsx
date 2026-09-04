"use client";

import React, { useId, useMemo, useState } from "react";
import { ChevronDown, SearchCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { CustomSelect } from "@/components/ui/controls";
import { Button, Input } from "@/components/ui/primitives";

import type { ResearchClaimView, ResearchTaskViewModel } from "../types";

const CLAIM_STATUSES = [
  "pending",
  "verified",
  "unsupported",
  "unresolved",
] as const;

export function ClaimPanel({
  task,
  claims,
  onInspectEvidence,
}: {
  task: ResearchTaskViewModel;
  claims: ResearchClaimView[];
  onInspectEvidence: (evidenceId: string) => void;
}) {
  const t = useTranslations("Research");
  const controlId = useId();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const evidenceById = useMemo(
    () => new Map(task.evidence.map((item) => [item.id, item])),
    [task.evidence],
  );
  const filteredClaims = useMemo(() => {
    const normalized = query.normalize("NFKC").trim().toLowerCase();
    return claims.filter(
      (claim) =>
        (status === "all" || claim.verificationStatus === status) &&
        (!normalized ||
          claim.text.normalize("NFKC").toLowerCase().includes(normalized)),
    );
  }, [claims, query, status]);

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <h2 className="text-lg font-semibold">{t("claims.title")}</h2>
      <div className="mt-4 grid gap-3 border-b border-border pb-4 sm:grid-cols-2">
        <label className="min-w-0 text-xs font-medium text-foreground">
          <span>{t("claims.searchLabel")}</span>
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("claims.searchPlaceholder")}
            className="mt-1 h-11 bg-background md:h-9"
          />
        </label>
        <div className="min-w-0 text-xs font-medium text-foreground">
          <label htmlFor={`${controlId}-status`}>{t("claims.status")}</label>
          <CustomSelect
            id={`${controlId}-status`}
            value={status}
            onChange={setStatus}
            ariaLabel={t("claims.status")}
            options={[
              { value: "all", label: t("claims.allStatuses") },
              ...CLAIM_STATUSES.map((value) => ({
                value,
                label: t(`verificationStatus.${value}`),
              })),
            ]}
            selectButtonClassName="mt-1 flex h-11 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9"
          />
        </div>
      </div>

      {filteredClaims.length > 0 ? (
        <ul className="divide-y divide-border">
          {filteredClaims.map((claim) => {
            const supporting = claim.supportingEvidenceIds.flatMap((id) => {
              const evidence = evidenceById.get(id);
              return evidence ? [evidence] : [];
            });
            const contradicting = claim.contradictingEvidenceIds.flatMap(
              (id) => {
                const evidence = evidenceById.get(id);
                return evidence ? [evidence] : [];
              },
            );
            const evidenceGroups = [
              { key: "supporting" as const, items: supporting },
              { key: "contradicting" as const, items: contradicting },
            ];
            return (
              <li key={claim.id}>
                <details className="group py-5">
                  <summary className="flex min-h-11 cursor-pointer list-none items-start gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="min-w-0 flex-1">
                      <span className="wrap-break-word block text-sm font-semibold leading-6 text-foreground">
                        {claim.text}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{t(`claimImportance.${claim.importance}`)}</span>
                        <span>
                          {t(`verificationStatus.${claim.verificationStatus}`)}
                        </span>
                        <span>
                          {t("claims.publishers", {
                            count: claim.independentPublisherCount,
                          })}
                        </span>
                      </span>
                    </span>
                    <ChevronDown
                      size={16}
                      className="mt-1 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                      aria-hidden="true"
                    />
                  </summary>
                  <div className="mt-3 grid gap-4 pl-0 sm:grid-cols-2 sm:pl-3">
                    {evidenceGroups.map(({ key, items }) => (
                      <section key={key}>
                        <h3 className="text-xs font-semibold text-foreground">
                          {t(`claims.${key}`)}
                        </h3>
                        {items.length > 0 ? (
                          <ul className="mt-2 space-y-1">
                            {items.map((evidence) => (
                              <li key={evidence.id}>
                                <Button
                                  variant="bare"
                                  type="button"
                                  onClick={() => onInspectEvidence(evidence.id)}
                                  aria-label={t("claims.openEvidence", {
                                    title: evidence.title,
                                  })}
                                  className="h-auto min-h-11 w-full justify-start wrap-break-word px-2 py-2 text-left text-sm text-foreground hover:bg-muted"
                                >
                                  {evidence.title}
                                </Button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {t("claims.noEvidence")}
                          </p>
                        )}
                      </section>
                    ))}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center">
          <SearchCheck
            size={26}
            className="text-muted-foreground"
            aria-hidden="true"
          />
          <h3 className="mt-3 text-sm font-semibold">
            {claims.length > 0
              ? t("claims.noFilterResults")
              : t("claims.emptyTitle")}
          </h3>
          {claims.length === 0 ? (
            <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
              {t("claims.emptyDescription")}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
