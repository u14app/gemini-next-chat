"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Clock3, FileText, SearchCheck, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, InlineStatus } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";

import { ResearchRunRail } from "../topology";
import { StatusLabel, TaskActions, formatDuration } from "../ui";
import type { ResearchTaskActions, ResearchTaskViewModel } from "../types";

import { EvidencePanel } from "./EvidencePanel";
import { PlanPanel } from "./PlanPanel";
import { ActivityPanel, ReportPanel } from "./ReportPanel";
import { ResearchFollowupDialog } from "./ResearchFollowupDialog";
import {
  WORKBENCH_TABS,
  type FollowupMode,
  type WorkbenchTab,
  createLocalEvidenceCitations,
  formatTokens,
  handleTabKeyDown,
  stripLeadingMarkdownTitle,
} from "./workbenchUtils";

export interface ResearchWorkbenchProps extends ResearchTaskActions {
  task: ResearchTaskViewModel;
  onClose: () => void;
  onSelectReportVersion?: (versionId: string) => void;
  onSelectEvidence?: (evidenceId: string) => void;
  onDownloadMarkdown?: (versionId: string) => void;
  onPrintPdf?: (versionId: string) => void;
  onAskEvidence?: (question: string) => void | Promise<void>;
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
  onAskEvidence,
  onContinueResearch,
  onUpdateLatest,
}: ResearchWorkbenchProps) {
  const t = useTranslations("Research");
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
  const reportCitations = useMemo(
    () =>
      report
        ? createLocalEvidenceCitations(
            stripLeadingMarkdownTitle(report.markdown),
            task.evidence,
          )
        : { markdown: "", sources: [] },
    [report, task.evidence],
  );

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
    item === "plan" ? t("plan.title") : t(`tabs.${item}`);

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

      {task.run ? <ResearchRunRail run={task.run} /> : null}

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
        {tab === "report" ? (
          <ReportPanel
            task={task}
            report={report}
            reportMarkdown={reportCitations.markdown}
            reportSources={reportCitations.sources}
            onSelectVersion={selectVersion}
            onInspectEvidence={inspectEvidence}
            onDownloadMarkdown={onDownloadMarkdown}
            onPrintPdf={onPrintPdf}
            onAskEvidence={
              onAskEvidence ? () => setFollowupMode("ask") : undefined
            }
            onUpdateLatest={
              onUpdateLatest &&
              (task.status === "completed" ||
                task.status === "partial_completed")
                ? onUpdateLatest
                : undefined
            }
          />
        ) : null}
        {tab === "activity" ? <ActivityPanel task={task} /> : null}
      </main>

      <footer className="shrink-0 border-t border-research-border bg-background/95 px-3 py-3 shadow-[0_-8px_24px_-20px_rgba(0,0,0,0.45)] backdrop-blur sm:px-4">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {task.status === "plan_ready" && task.plan ? (
              <>
                <div className="inline-flex items-center gap-1.5">
                  <FileText size={13} aria-hidden="true" />
                  <dt className="sr-only">{t("metrics.questions")}</dt>
                  <dd className="font-mono tabular-nums text-foreground">
                    {t("plan.decisionSteps", {
                      count: task.plan.steps.length,
                    })}
                  </dd>
                </div>
                {task.plan.strategy ? (
                  <>
                    <div className="inline-flex items-center gap-1.5">
                      <SearchCheck size={13} aria-hidden="true" />
                      <dt className="sr-only">{t("metrics.queries")}</dt>
                      <dd className="font-mono tabular-nums text-foreground">
                        {t("plan.decisionQueries", {
                          count: task.plan.strategy.queryLimit,
                        })}
                      </dd>
                    </div>
                    <div className="inline-flex items-center gap-1.5">
                      <dt>{t("metrics.depth")}</dt>
                      <dd className="font-mono tabular-nums text-foreground">
                        {task.plan.strategy.maxDepth}
                      </dd>
                    </div>
                  </>
                ) : null}
              </>
            ) : task.run ? (
              <>
                <div className="inline-flex items-center gap-1.5">
                  <SearchCheck size={13} aria-hidden="true" />
                  <dt>{t("metrics.queries")}</dt>
                  <dd className="font-mono tabular-nums text-foreground">
                    {task.run.queryUsage.used}/{task.run.queryUsage.limit}
                  </dd>
                </div>
                <div className="inline-flex items-center gap-1.5">
                  <dt>{t("metrics.verifiedClaims")}</dt>
                  <dd className="font-mono tabular-nums text-foreground">
                    {task.run.claimCounts.verified}/{task.run.claimCounts.total}
                  </dd>
                </div>
                <div className="inline-flex items-center gap-1.5">
                  <dt>{t("metrics.depth")}</dt>
                  <dd className="font-mono tabular-nums text-foreground">
                    {task.run.currentDepth}/{task.run.maxDepth}
                  </dd>
                </div>
              </>
            ) : null}
            {task.status !== "plan_ready" ? (
              <div className="inline-flex items-center gap-1.5">
                <Wrench size={13} aria-hidden="true" />
                <dt className="sr-only">{t("metrics.toolCalls")}</dt>
                <dd className="tabular-nums">
                  {task.usage.toolCalls}/{task.usage.maxToolCalls}{" "}
                  {t("metrics.toolCalls").toLocaleLowerCase()}
                </dd>
              </div>
            ) : null}
            {task.status !== "plan_ready" ? (
              <div className="inline-flex items-center gap-1.5">
                <Clock3 size={13} aria-hidden="true" />
                <dt className="sr-only">{t("metrics.elapsed")}</dt>
                <dd className="tabular-nums">
                  {formatDuration(task.usage.elapsedMs)}/
                  {formatDuration(task.usage.maxWallTimeMs)}
                </dd>
              </div>
            ) : null}
            {task.status !== "plan_ready" &&
            task.usage.totalTokens !== undefined ? (
              <div className="inline-flex items-center gap-1.5">
                <dt>{t("metrics.tokens")}</dt>
                <dd className="tabular-nums">
                  {formatTokens(task.usage.totalTokens)}
                  {task.usage.maxTotalTokens
                    ? `/${formatTokens(task.usage.maxTotalTokens)}`
                    : ""}
                </dd>
              </div>
            ) : null}
            {task.status !== "plan_ready" ? (
              <div>
                <dt className="sr-only">{t("metrics.questions")}</dt>
                <dd className="tabular-nums">
                  {task.completedQuestions}/{task.totalQuestions}{" "}
                  {t("metrics.questions").toLocaleLowerCase()}
                </dd>
              </div>
            ) : null}
          </dl>
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
          if (followupMode === "ask") return onAskEvidence?.(value);
          return onContinueResearch?.(value);
        }}
      />
    </section>
  );
}
