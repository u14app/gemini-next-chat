"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Telescope, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import MarkdownRenderer from "@/components/content/MarkdownRenderer";
import { Button } from "@/components/ui/primitives";
import ResearchGlobalBar from "./ResearchGlobalBar";
import ResearchTaskCard from "./ResearchTaskCard";
import ResearchWorkbench from "./workbench";
import { StatusLabel } from "./ui";
import type { ResearchTaskViewModel } from "./types";
import { isActiveResearchStatus } from "@/lib/research";
import { openResearchTask } from "@/lib/research/navigation";
import { selectGlobalActiveResearchTaskId } from "@/lib/research/pendingTask";
import { useChatStore } from "@/store/core/chatStore";
import { useResearchStore } from "@/store/core/researchStore";

import { useResearchTaskViewModel } from "@/hooks/research/useResearchTaskViewModel";
import { useTaskActions } from "@/hooks/research/useTaskActions";
import { useResearchRuntime } from "./ResearchRuntimeProvider";

export function ConnectedResearchTaskCard({
  taskId,
  messageId,
  blockId,
}: {
  taskId: string;
  messageId?: string;
  blockId?: string;
}) {
  const t = useTranslations("Research");
  const { task, viewModel } = useResearchTaskViewModel(taskId);
  const hydrated = useResearchStore((state) => state.hydrated);
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  const actions = useTaskActions(taskId);
  if (!task && hydrated) {
    const removeReference = () => {
      if (!currentSessionId || !messageId || !blockId) return;
      const chatStore = useChatStore.getState();
      const message = chatStore.activeMessages.find(
        (candidate) => candidate.id === messageId,
      );
      if (!message) return;
      chatStore.updateMessage(currentSessionId, messageId, {
        outputBlocks: (message.outputBlocks || []).filter(
          (block) => block.id !== blockId,
        ),
      });
    };
    return (
      <section
        className="my-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground"
        role="note"
      >
        <span>{t("legacy.cleared")}</span>
        {messageId && blockId ? (
          <Button
            type="button"
            variant="bare"
            size="sm"
            onClick={removeReference}
            className="h-9 shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("legacy.remove")}
          >
            <Trash2 size={14} aria-hidden="true" />
            {t("legacy.remove")}
          </Button>
        ) : null}
      </section>
    );
  }
  if (!viewModel) return null;
  return (
    <ResearchTaskCard
      task={viewModel}
      onOpenWorkbench={() => openResearchTask(taskId)}
      onNewFollowUp={() => openResearchTask(taskId)}
      {...actions}
    />
  );
}

export function ConnectedResearchGlobalBar() {
  const activeTaskId = useResearchStore((state) => state.activeTaskId);
  const tasksById = useResearchStore((state) => state.tasksById);
  const visibleTaskId = useMemo(
    () => selectGlobalActiveResearchTaskId({ tasksById, activeTaskId }),
    [activeTaskId, tasksById],
  );
  const { viewModel } = useResearchTaskViewModel(visibleTaskId);
  const runtime = useResearchRuntime();
  if (!visibleTaskId || !viewModel) return null;
  return (
    <ResearchGlobalBar
      task={viewModel}
      onOpenWorkbench={() => openResearchTask(visibleTaskId)}
      onPause={
        isActiveResearchStatus(viewModel.status)
          ? () => void runtime.pauseTask(visibleTaskId)
          : undefined
      }
    />
  );
}

export function ConnectedResearchTaskList({
  onClose,
}: {
  onClose: () => void;
}) {
  const t = useTranslations("Research");
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  const tasksById = useResearchStore((state) => state.tasksById);
  const hydrated = useResearchStore((state) => state.hydrated);
  const loadSessionTasks = useResearchStore((state) => state.loadSessionTasks);

  useEffect(() => {
    if (currentSessionId) void loadSessionTasks(currentSessionId);
  }, [currentSessionId, loadSessionTasks]);

  const tasks = useMemo(
    () =>
      Object.values(tasksById)
        .filter((task) => task.sessionId === currentSessionId)
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [currentSessionId, tasksById],
  );

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex items-center gap-3 border-b border-border px-4 sm:px-6">
        <Button
          variant="bare"
          type="button"
          onClick={onClose}
          aria-label={t("actions.backToChat")}
          className="h-9 w-9 shrink-0 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-foreground">
            {t("taskList.title")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {t("taskList.description")}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        {!hydrated && tasks.length === 0 ? (
          <p
            className="mx-auto max-w-3xl text-sm text-muted-foreground"
            role="status"
          >
            {t("workbench.loading")}
          </p>
        ) : tasks.length === 0 ? (
          <div className="mx-auto flex max-w-xl flex-col items-start gap-4 py-16">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted/50 text-muted-foreground">
              <Telescope size={22} aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {t("taskList.emptyTitle")}
              </h2>
              <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                {t("taskList.emptyDescription")}
              </p>
            </div>
            <Button className="h-9 sm:h-8" onClick={onClose}>
              {t("actions.backToChat")}
            </Button>
          </div>
        ) : (
          <ol className="mx-auto max-w-3xl space-y-2">
            {tasks.map((task) => {
              const plan = task.planVersions.find(
                (item) => item.version === task.activePlanVersion,
              );
              const title = plan?.title || task.goal;
              return (
                <li key={task.id}>
                  <button
                    type="button"
                    onClick={() => openResearchTask(task.id)}
                    className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border border-border bg-card px-4 py-4 text-left transition-[border-color,background-color,transform] hover:border-foreground/20 hover:bg-muted/40 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    aria-label={t("taskList.openTask", { title })}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {title}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <StatusLabel status={task.status} />
                        <span>{new Date(task.updatedAt).toLocaleString()}</span>
                      </span>
                    </span>
                    <ArrowUpRight
                      size={17}
                      className="text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

export function ConnectedResearchWorkbench({
  taskId,
  onClose,
}: {
  taskId: string;
  onClose: () => void;
}) {
  const t = useTranslations("Research");
  const { viewModel } = useResearchTaskViewModel(taskId);
  const task = useResearchStore((state) => state.tasksById[taskId]);
  const hydrated = useResearchStore((state) => state.hydrated);
  const actions = useTaskActions(taskId);
  const runtime = useResearchRuntime();
  const [printReport, setPrintReport] = useState<{
    title: string;
    markdown: string;
  }>();

  useEffect(() => {
    if (!printReport) return;
    const previousTitle = document.title;
    document.title = `${printReport.title}.pdf`;
    const handleAfterPrint = () => {
      document.title = previousTitle;
      setPrintReport(undefined);
    };
    window.addEventListener("afterprint", handleAfterPrint, { once: true });
    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.print());
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.removeEventListener("afterprint", handleAfterPrint);
      document.title = previousTitle;
    };
  }, [printReport]);

  if (!viewModel) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
        <p>
          {hydrated && !task ? t("workbench.notFound") : t("workbench.loading")}
        </p>
        {hydrated && !task ? (
          <Button className="h-9 sm:h-8" onClick={onClose}>
            {t("actions.backToChat")}
          </Button>
        ) : null}
      </div>
    );
  }

  const findReport = (versionId: string) =>
    viewModel.reportVersions.find((report) => report.id === versionId);
  const buildExportMarkdown = (
    report: ResearchTaskViewModel["reportVersions"][number],
  ) => {
    const body = report.markdown.replace(/^#\s+.+(?:\r?\n|$)/, "").trim();
    return [`# ${report.title}`, body].filter(Boolean).join("\n\n");
  };
  const downloadMarkdown = (versionId: string) => {
    const report = findReport(versionId);
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([buildExportMarkdown(report)], {
        type: "text/markdown;charset=utf-8",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${report.title.replace(/[^\p{L}\p{N}._-]+/gu, "-") || "research-report"}.md`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <>
      <ResearchWorkbench
        task={viewModel}
        onClose={onClose}
        {...actions}
        onDownloadMarkdown={downloadMarkdown}
        onPrintPdf={(versionId) => {
          const report = findReport(versionId);
          if (report) {
            setPrintReport({
              title: report.title,
              markdown: buildExportMarkdown(report),
            });
          }
        }}
        onAskEvidence={(question) =>
          runtime.askExistingEvidence(taskId, question)
        }
        onContinueResearch={(instruction) =>
          runtime.continueResearch(taskId, instruction)
        }
        onUpdateLatest={() => void runtime.updateLatest(taskId)}
      />
      {printReport ? (
        <div className="message-pdf-print-root" aria-hidden="true">
          <MarkdownRenderer content={printReport.markdown} />
        </div>
      ) : null}
    </>
  );
}
