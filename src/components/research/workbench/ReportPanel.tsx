"use client";

import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileDown,
  FileText,
  MessageSquareText,
  RefreshCw,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import MarkdownRenderer from "@/components/content/MarkdownRenderer";
import { CustomSelect } from "@/components/ui/controls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button, InlineStatus } from "@/components/ui/primitives";
import type { Source } from "@/types";

import { ResearchRunRail } from "../topology";
import { ActivityList, formatDuration } from "../ui";
import type { ResearchTaskViewModel } from "../types";
import { formatResearchDateTime } from "../formatters";
import { formatTokens } from "./workbenchUtils";

export function ActivityPanel({ task }: { task: ResearchTaskViewModel }) {
  const locale = useLocale();
  const t = useTranslations("Research");
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      {task.run ? <ResearchRunRail run={task.run} /> : null}
      <div>
        <h2 className="text-lg font-semibold">{t("activity.title")}</h2>
        <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-border py-4 text-xs sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <dt className="text-muted-foreground">{t("metrics.toolCalls")}</dt>
            <dd className="mt-0.5 font-mono tabular-nums text-foreground">
              {task.usage.toolCalls}/{task.usage.maxToolCalls}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("metrics.elapsed")}</dt>
            <dd className="mt-0.5 font-mono tabular-nums text-foreground">
              {formatDuration(task.usage.elapsedMs)}/
              {formatDuration(task.usage.maxWallTimeMs)}
            </dd>
          </div>
          {task.usage.totalTokens !== undefined ? (
            <div>
              <dt className="text-muted-foreground">{t("metrics.tokens")}</dt>
              <dd className="mt-0.5 font-mono tabular-nums text-foreground">
                {formatTokens(task.usage.totalTokens, locale)}
                {task.usage.maxTotalTokens
                  ? `/${formatTokens(task.usage.maxTotalTokens, locale)}`
                  : ""}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-muted-foreground">{t("metrics.questions")}</dt>
            <dd className="mt-0.5 font-mono tabular-nums text-foreground">
              {task.completedQuestions}/{task.totalQuestions}
            </dd>
          </div>
          {task.run ? (
            <>
              <div>
                <dt className="text-muted-foreground">
                  {t("metrics.evidence")}
                </dt>
                <dd className="mt-0.5 font-mono tabular-nums text-foreground">
                  {task.evidence.length}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {t("metrics.verifiedClaims")}
                </dt>
                <dd className="mt-0.5 font-mono tabular-nums text-foreground">
                  {task.run.claimCounts.verified}/{task.run.claimCounts.total}
                </dd>
              </div>
            </>
          ) : null}
        </dl>
      </div>
      {task.activities.length ? (
        <div>
          <ActivityList activities={task.activities} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("activity.empty")}</p>
      )}
    </div>
  );
}

function ReportTrustSummary({
  report,
}: {
  report: ResearchTaskViewModel["reportVersions"][number];
}) {
  const t = useTranslations("Research");
  const auditIssueCount = report.audit
    ? report.audit.blocking.length + report.audit.advisory.length
    : 0;
  const hasDiff = report.version > 1 && Boolean(report.diff);
  const stopReasonLabel = report.stopReason
    ? t.has(`run.stop.${report.stopReason.code}`)
      ? t(`run.stop.${report.stopReason.code}`)
      : report.stopReason.code
    : undefined;

  return (
    <section
      className="mt-5 space-y-5 border-b border-border pb-5"
      aria-labelledby={`research-report-trust-${report.id}`}
    >
      <div>
        <h3
          id={`research-report-trust-${report.id}`}
          className="text-sm font-semibold text-foreground"
        >
          {t("report.trustTitle")}
        </h3>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {(report.planStepCount ?? 0) > 0 ? (
            <span>
              {t("report.coverageSummary", {
                covered: report.coveredStepIds?.length ?? 0,
                total: report.planStepCount ?? 0,
              })}
            </span>
          ) : null}
          {stopReasonLabel ? (
            <span>
              {t("report.stopReason", {
                reason: stopReasonLabel,
              })}
            </span>
          ) : null}
        </div>
      </div>

      {report.audit ? (
        <InlineStatus
          tone={auditIssueCount > 0 ? "warning" : "success"}
          className="flex items-start gap-2"
        >
          {auditIssueCount > 0 ? (
            <AlertTriangle
              size={16}
              className="mt-0.5 shrink-0"
              aria-hidden="true"
            />
          ) : (
            <CheckCircle2
              size={16}
              className="mt-0.5 shrink-0"
              aria-hidden="true"
            />
          )}
          <span>
            {auditIssueCount > 0
              ? t("report.qualityIssues", { count: auditIssueCount })
              : t("report.qualityClean")}
            <span className="mt-0.5 block text-xs opacity-80">
              {t("report.qualityCounts", {
                unknown: report.audit.unknownCitationCount,
                unsupported: report.audit.unsupportedFindingCount,
                missing: report.audit.missingSectionCount,
              })}
            </span>
          </span>
        </InlineStatus>
      ) : null}

      <div>
        <h4 className="text-xs font-semibold text-foreground">
          {t("report.gapsTitle")}
        </h4>
        {(report.gaps?.length ?? 0) > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
            {report.gaps?.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            {t("report.noGaps")}
          </p>
        )}
      </div>

      {hasDiff && report.diff ? (
        <div>
          <h4 className="text-xs font-semibold text-foreground">
            {t("report.changeSummary")}
          </h4>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <li>
              {t("report.evidenceAdded", {
                count: report.diff.addedEvidenceIds.length,
              })}
            </li>
            <li>
              {t("report.sourcesChanged", {
                count: report.diff.changedSourceIds.length,
              })}
            </li>
            <li>
              {t("report.sourcesUnchanged", {
                count: report.diff.unchangedSourceIds.length,
              })}
            </li>
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function SupplementPanel({
  task,
  report,
  supplementsMarkdown,
  reportSources,
  imageSources,
  onSelectVersion,
  onInspectEvidence,
}: {
  task: ResearchTaskViewModel;
  report: ResearchTaskViewModel["reportVersions"][number] | undefined;
  supplementsMarkdown: string;
  reportSources: Source[];
  imageSources: NonNullable<
    ResearchTaskViewModel["reportVersions"][number]["imageSources"]
  >;
  onSelectVersion: (versionId: string) => void;
  onInspectEvidence: (evidenceId: string) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("Research");
  if (!report) {
    return (
      <div className="mx-auto flex min-h-72 w-full max-w-5xl flex-col items-center justify-center p-5 text-center">
        <FileText
          size={26}
          className="text-muted-foreground"
          aria-hidden="true"
        />
        <h2 className="mt-3 text-sm font-semibold">{t("tabs.supplements")}</h2>
        <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
          {t("report.supplementsEmpty")}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{t("tabs.supplements")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("report.versionDate", {
              version: report.version,
              date: formatResearchDateTime(report.createdAt, locale),
            })}
          </p>
        </div>
        <div>
          <label className="sr-only" htmlFor={`supplements-version-${task.id}`}>
            {t("report.selectVersion")}
          </label>
          <CustomSelect
            id={`supplements-version-${task.id}`}
            value={report.id}
            onChange={onSelectVersion}
            options={task.reportVersions.map((version) => ({
              value: version.id,
              label: t("plan.version", { version: version.version }),
            }))}
            ariaLabel={t("report.selectVersion")}
            selectButtonClassName="flex h-9 min-h-0 min-w-28 items-center justify-between gap-2 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </header>
      <ReportTrustSummary report={report} />
      {supplementsMarkdown.trim() ? (
        <MarkdownRenderer
          content={supplementsMarkdown}
          searchSources={reportSources}
          imageSources={imageSources}
          onCitationClick={(source) => {
            const evidenceId = source.metadata?.researchEvidenceId;
            if (typeof evidenceId === "string") onInspectEvidence(evidenceId);
          }}
        />
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">
          {t("report.supplementsEmpty")}
        </p>
      )}
    </div>
  );
}

export function ReportPanel({
  task,
  report,
  reportMarkdown,
  reportSources,
  imageSources,
  onSelectVersion,
  onInspectEvidence,
  onDownloadMarkdown,
  onPrintPdf,
  onAskEvidence,
  onUpdateLatest,
}: {
  task: ResearchTaskViewModel;
  report: ResearchTaskViewModel["reportVersions"][number] | undefined;
  reportMarkdown: string;
  reportSources: Source[];
  imageSources: NonNullable<
    ResearchTaskViewModel["reportVersions"][number]["imageSources"]
  >;
  onSelectVersion: (versionId: string) => void;
  onInspectEvidence: (evidenceId: string) => void;
  onDownloadMarkdown?: (versionId: string) => void;
  onPrintPdf?: (versionId: string) => void;
  onAskEvidence?: () => void;
  onUpdateLatest?: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations("Research");
  if (!report) {
    return (
      <div className="mx-auto flex min-h-72 w-full max-w-5xl flex-col items-center justify-center p-5 text-center">
        <FileText
          size={26}
          className="text-muted-foreground"
          aria-hidden="true"
        />
        <h2 className="mt-3 text-sm font-semibold">{t("report.emptyTitle")}</h2>
        <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
          {t("report.emptyDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <div className="border-b border-border pb-4 sm:flex sm:flex-wrap sm:items-start sm:gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="wrap-break-word text-lg font-semibold">
            {report.title}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("report.versionDate", {
              version: report.version,
              date: formatResearchDateTime(report.createdAt, locale),
            })}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 [&_button]:h-9 [&_button]:min-h-0 sm:mt-0 sm:[&_button]:h-8">
          <label className="sr-only" htmlFor={`report-version-${task.id}`}>
            {t("report.selectVersion")}
          </label>
          <CustomSelect
            id={`report-version-${task.id}`}
            value={report.id}
            onChange={onSelectVersion}
            options={task.reportVersions.map((version) => ({
              value: version.id,
              label: t("plan.version", { version: version.version }),
            }))}
            ariaLabel={t("report.selectVersion")}
            selectButtonClassName="flex h-9 min-h-0 min-w-28 items-center justify-between gap-2 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {onDownloadMarkdown || onPrintPdf ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" aria-label={t("actions.downloadReport")}>
                  <Download size={14} aria-hidden="true" />
                  {t("actions.downloadReport")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onDownloadMarkdown ? (
                  <DropdownMenuItem
                    onSelect={() => onDownloadMarkdown(report.id)}
                  >
                    <Download size={14} aria-hidden="true" />
                    {t("actions.markdown")}
                  </DropdownMenuItem>
                ) : null}
                {onPrintPdf ? (
                  <DropdownMenuItem onSelect={() => onPrintPdf(report.id)}>
                    <FileDown size={14} aria-hidden="true" />
                    {t("actions.pdf")}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
      <MarkdownRenderer
        content={reportMarkdown}
        searchSources={reportSources}
        imageSources={imageSources}
        onCitationClick={(source) => {
          const evidenceId = source.metadata?.researchEvidenceId;
          if (typeof evidenceId === "string") onInspectEvidence(evidenceId);
        }}
        className="mt-6"
      />
      {onAskEvidence || onUpdateLatest ? (
        <div className="mt-8 flex flex-wrap gap-2 border-t border-border pt-4 [&_button]:h-9 [&_button]:min-h-0 sm:[&_button]:h-8">
          {onAskEvidence ? (
            <Button onClick={onAskEvidence}>
              <MessageSquareText size={15} aria-hidden="true" />
              {t("actions.askEvidence")}
            </Button>
          ) : null}
          {onUpdateLatest ? (
            <Button onClick={onUpdateLatest}>
              <RefreshCw size={15} aria-hidden="true" />
              {t("actions.updateLatest")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
