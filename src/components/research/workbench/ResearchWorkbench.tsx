"use client";

import dynamic from "next/dynamic";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, InlineStatus } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";
import { createReportSectionLabels } from "@/lib/research/reportSections";

import { StatusLabel, TaskActions } from "../ui";
import type { ResearchTaskActions, ResearchTaskViewModel } from "../types";

import { EvidencePanel } from "./EvidencePanel";
import { ClaimPanel } from "./ClaimPanel";
import { PlanPanel } from "./PlanPanel";
import { ActivityPanel, ReportPanel, SupplementPanel } from "./ReportPanel";
import { ResearchFollowupDialog } from "./ResearchFollowupDialog";
import {
  WORKBENCH_TABS,
  type FollowupMode,
  type WorkbenchTab,
  createReportPresentation,
  handleTabKeyDown,
} from "./workbenchUtils";

const EvidenceQuestionsPanel = dynamic(
  () => import("./EvidenceQuestionsPanel"),
);

export interface ResearchWorkbenchProps extends ResearchTaskActions {
  task: ResearchTaskViewModel;
  onClose: () => void;
  onSelectReportVersion?: (versionId: string) => void;
  onSelectEvidence?: (evidenceId: string) => void;
  onDownloadMarkdown?: (versionId: string) => void;
  onPrintPdf?: (versionId: string) => void;
  onContinueResearch?: (instruction: string) => void | Promise<void>;
  onUpdateLatest?: () => void;
}

export default function ResearchWorkbench({
  task,
  onClose,
  onConfirmPlan,
  onAdjustPlan,
  onUpdatePlanStrategy,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onDismiss,
  onNewFollowUp,
  onSelectReportVersion,
  onSelectEvidence,
  onDownloadMarkdown,
  onPrintPdf,
  onContinueResearch,
  onUpdateLatest,
}: ResearchWorkbenchProps) {
  const t = useTranslations("Research");
  const questionText = useTranslations("EvidenceQuestions");
  const [tab, setTab] = useState<WorkbenchTab>(
    task.reportVersions.length > 0 ? "report" : "plan",
  );
  const [followupMode, setFollowupMode] = useState<FollowupMode | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState(
    task.activeReportVersionId ?? task.reportVersions.at(-1)?.id,
  );
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [task.id]);

  const effectiveVersionId = task.reportVersions.some(
    (version) => version.id === selectedVersionId,
  )
    ? selectedVersionId
    : (task.activeReportVersionId ?? task.reportVersions.at(-1)?.id);
  const report = useMemo(
    () =>
      task.reportVersions.find((version) => version.id === effectiveVersionId),
    [effectiveVersionId, task.reportVersions],
  );
  const reportPresentation = useMemo(() => {
    if (!report) {
      return {
        markdown: "",
        bodyMarkdown: "",
        supplementsMarkdown: "",
        sources: [],
      };
    }
    const labels = createReportSectionLabels((key) => t(key));
    return createReportPresentation(report.markdown, task.evidence, labels);
  }, [report, t, task.evidence]);

  const selectVersion = (versionId: string) => {
    setSelectedVersionId(versionId);
    onSelectReportVersion?.(versionId);
  };
  const inspectEvidence = (evidenceId: string) => {
    onSelectEvidence?.(evidenceId);
    setTab("evidence");
    window.requestAnimationFrame(() => {
      document.getElementById(`research-evidence-${evidenceId}`)?.focus();
    });
  };
  const tabLabel = (item: WorkbenchTab) =>
    item === "questions"
      ? questionText("tab")
      : item === "plan"
        ? t("plan.title")
        : t(`tabs.${item}`);

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      aria-labelledby={`research-workbench-${task.id}`}
    >
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border px-3 sm:px-4">
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          aria-label={t("actions.closeWorkbench")}
          className="h-11 min-h-11 min-w-11 md:h-8 md:min-h-0 md:min-w-0"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <span className="hidden sm:inline">{t("actions.backToChat")}</span>
        </Button>
        <div className="min-w-0 flex-1">
          <h1
            ref={headingRef}
            id={`research-workbench-${task.id}`}
            tabIndex={-1}
            className="truncate text-sm font-semibold"
          >
            {task.title}
          </h1>
          <div aria-live="polite" aria-atomic="true">
            <StatusLabel status={task.status} />
          </div>
        </div>
      </header>

      {task.error ? (
        <div className="shrink-0 border-b border-border px-4 py-3">
          <div className="mx-auto max-w-5xl">
            <InlineStatus tone="danger" live>
              {task.error.message}
            </InlineStatus>
          </div>
        </div>
      ) : null}

      <nav
        className="shrink-0 overflow-x-auto border-b border-border"
        aria-label={t("workbench.contentTabs")}
        role="tablist"
      >
        <div className="mx-auto flex min-w-max max-w-5xl px-2 sm:px-4">
          {WORKBENCH_TABS.map((item, index) => (
            <Button
              key={item}
              variant="bare"
              id={`research-tab-${task.id}-${item}`}
              role="tab"
              tabIndex={tab === item ? 0 : -1}
              aria-selected={tab === item}
              aria-controls={`research-panel-${task.id}-${item}`}
              className={cn(
                "h-11 shrink-0 border-b-2 px-3 text-sm font-medium md:h-9",
                tab === item
                  ? "border-research-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setTab(item)}
              onKeyDown={(event) =>
                handleTabKeyDown({ event, index, select: setTab })
              }
            >
              {tabLabel(item)}
            </Button>
          ))}
        </div>
      </nav>

      <main
        id={`research-panel-${task.id}-${tab}`}
        role="tabpanel"
        aria-labelledby={`research-tab-${task.id}-${tab}`}
        aria-label={tabLabel(tab)}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {tab === "plan" ? <PlanPanel task={task} /> : null}
        {tab === "evidence" ? <EvidencePanel task={task} /> : null}
        {tab === "claims" ? (
          <ClaimPanel
            task={task}
            claims={report?.claims ?? task.claims ?? []}
            onInspectEvidence={inspectEvidence}
          />
        ) : null}
        {tab === "report" ? (
          <ReportPanel
            task={task}
            report={report}
            reportMarkdown={reportPresentation.bodyMarkdown}
            reportSources={reportPresentation.sources}
            onSelectVersion={selectVersion}
            onInspectEvidence={inspectEvidence}
            onDownloadMarkdown={onDownloadMarkdown}
            onPrintPdf={onPrintPdf}
            onAskEvidence={() => setTab("questions")}
            onUpdateLatest={
              onUpdateLatest &&
              (task.status === "completed" ||
                task.status === "partial_completed")
                ? onUpdateLatest
                : undefined
            }
          />
        ) : null}
        {tab === "supplements" ? (
          <SupplementPanel
            task={task}
            report={report}
            supplementsMarkdown={reportPresentation.supplementsMarkdown}
            reportSources={reportPresentation.sources}
            onSelectVersion={selectVersion}
            onInspectEvidence={inspectEvidence}
          />
        ) : null}
        {tab === "questions" ? (
          <EvidenceQuestionsPanel
            key={effectiveVersionId}
            taskId={task.id}
            reportId={effectiveVersionId}
            reportVersions={task.reportVersions}
            onSelectVersion={selectVersion}
          />
        ) : null}
        {tab === "activity" ? <ActivityPanel task={task} /> : null}
      </main>

      <footer className="shrink-0 border-t border-research-border bg-background/95 px-3 py-3 shadow-[0_-8px_24px_-20px_rgba(0,0,0,0.45)] backdrop-blur sm:px-4">
        <div className="mx-auto flex max-w-5xl justify-end">
          <TaskActions
            compact
            presentation="decision-bar"
            task={task}
            actions={{
              onConfirmPlan,
              onAdjustPlan,
              onUpdatePlanStrategy,
              onPause,
              onResume,
              onCancel,
              onRetry,
              onDismiss,
              onNewFollowUp:
                onNewFollowUp ??
                (onContinueResearch
                  ? () => setFollowupMode("continue")
                  : undefined),
            }}
          />
        </div>
      </footer>

      <ResearchFollowupDialog
        mode={followupMode}
        onClose={() => setFollowupMode(null)}
        onSubmit={(value) => {
          return onContinueResearch?.(value);
        }}
      />
    </section>
  );
}
