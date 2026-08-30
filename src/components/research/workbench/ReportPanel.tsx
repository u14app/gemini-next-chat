"use client";

import React from "react";
import {
  Download,
  FileDown,
  FileText,
  MessageSquareText,
  RefreshCw,
} from "lucide-react";
import { useTranslations } from "next-intl";

import MarkdownRenderer from "@/components/content/MarkdownRenderer";
import { CustomSelect } from "@/components/ui/controls";
import { Button } from "@/components/ui/primitives";
import type { Source } from "@/types";

import { ActivityList } from "../ui";
import type { ResearchTaskViewModel } from "../types";

export function ActivityPanel({ task }: { task: ResearchTaskViewModel }) {
  const t = useTranslations("Research");
  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <h2 className="text-lg font-semibold">{t("activity.title")}</h2>
      {task.activities.length ? (
        <div className="mt-5">
          <ActivityList activities={task.activities} />
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {t("activity.empty")}
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
  onSelectVersion: (versionId: string) => void;
  onInspectEvidence: (evidenceId: string) => void;
  onDownloadMarkdown?: (versionId: string) => void;
  onPrintPdf?: (versionId: string) => void;
  onAskEvidence?: () => void;
  onUpdateLatest?: () => void;
}) {
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
              date: new Date(report.createdAt).toLocaleString(),
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
          {onDownloadMarkdown ? (
            <Button size="sm" onClick={() => onDownloadMarkdown(report.id)}>
              <Download size={14} aria-hidden="true" />
              {t("actions.markdown")}
            </Button>
          ) : null}
          {onPrintPdf ? (
            <Button size="sm" onClick={() => onPrintPdf(report.id)}>
              <FileDown size={14} aria-hidden="true" />
              {t("actions.pdf")}
            </Button>
          ) : null}
        </div>
      </div>
      <MarkdownRenderer
        content={reportMarkdown}
        searchSources={reportSources}
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
