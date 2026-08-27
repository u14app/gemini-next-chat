"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Circle,
  Clock3,
  Download,
  ExternalLink,
  FileDown,
  FileText,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  SearchCheck,
  Wrench,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";

import MarkdownRenderer from "@/components/content/MarkdownRenderer";
import {
  Button,
  Dialog,
  IconButton,
  InlineStatus,
} from "@/components/ui/primitives";
import { getSafeExternalHref } from "@/lib/security/clientUrl";
import { cn } from "@/lib/utils/cn";
import type { Source } from "@/types";

import {
  ActivityList,
  ResearchSourceScope,
  PlanSteps,
  StatusLabel,
  TaskActions,
  formatDuration,
} from "./researchUi";
import {
  ResearchClaimNotice,
  ResearchPlanContract,
  ResearchRunRail,
  ResearchTopology,
} from "./ResearchTopology";
import type {
  ResearchEvidenceView,
  ResearchPlanView,
  ResearchTaskActions,
  ResearchTaskViewModel,
} from "./types";

type WorkbenchTab = "plan" | "evidence" | "report" | "activity";
type EvidenceStance = NonNullable<ResearchEvidenceView["stance"]>;
type FollowupMode = "ask" | "continue";

const WORKBENCH_TABS: WorkbenchTab[] = [
  "plan",
  "evidence",
  "report",
  "activity",
];
const EVIDENCE_STANCES: EvidenceStance[] = [
  "supports",
  "contradicts",
  "context",
];

function handleTabKeyDown({
  event,
  index,
  select,
}: {
  event: React.KeyboardEvent<HTMLButtonElement>;
  index: number;
  select: (tab: WorkbenchTab) => void;
}) {
  let nextIndex = index;
  if (event.key === "ArrowRight") {
    nextIndex = (index + 1) % WORKBENCH_TABS.length;
  } else if (event.key === "ArrowLeft") {
    nextIndex = (index - 1 + WORKBENCH_TABS.length) % WORKBENCH_TABS.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = WORKBENCH_TABS.length - 1;
  } else {
    return;
  }
  event.preventDefault();
  select(WORKBENCH_TABS[nextIndex]);
  event.currentTarget.parentElement
    ?.querySelectorAll<HTMLElement>('[role="tab"]')
    [nextIndex]?.focus();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createLocalEvidenceCitations(
  markdown: string,
  evidence: ResearchEvidenceView[],
): { markdown: string; sources: Source[] } {
  const localEvidence = evidence.filter((item) => !item.url);
  let linkedMarkdown = markdown;
  const lines = markdown.split(/\r?\n/);
  const sources = localEvidence.map((item, index): Source => {
    const sourceLines = lines.filter(
      (line) =>
        /\[Source\s+\d+\]/i.test(line) &&
        (Boolean(item.locator && line.includes(item.locator)) ||
          (item.title.length >= 8 && line.includes(item.title))),
    );
    const markers = new Set(
      sourceLines.flatMap((line) =>
        Array.from(line.matchAll(/\[Source\s+\d+\]/gi)).map(
          (match) => match[0],
        ),
      ),
    );
    if (markers.size === 0) {
      markers.add(`[Source ${evidence.indexOf(item) + 1}]`);
    }
    for (const marker of markers) {
      linkedMarkdown = linkedMarkdown.replace(
        new RegExp(`${escapeRegExp(marker)}(?!\\s*\\()`, "gi"),
        `${marker}(#citation-${index})`,
      );
    }
    return {
      title: item.title,
      url: "",
      content: item.excerpt || item.locator || "",
      metadata: { researchEvidenceId: item.id },
    };
  });
  return { markdown: linkedMarkdown, sources };
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function QuestionStatusIcon({
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

function ApprovalBanner({ task }: { task: ResearchTaskViewModel }) {
  const t = useTranslations("Research");
  const [planOpen, setPlanOpen] = useState(false);
  if (task.status !== "plan_ready" || !task.plan) return null;

  return (
    <>
      <section
        className="border-b border-research-border bg-research-soft px-4 py-4"
        aria-labelledby={`research-approval-${task.id}`}
      >
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id={`research-approval-${task.id}`}
              className="text-sm font-semibold text-foreground"
            >
              {t("status.plan_ready")}
            </h2>
            <span className="text-xs font-medium text-research-accent-text">
              {t("plan.version", { version: task.plan.version })}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/70">
            <span>
              {t("metrics.questions")}: {task.totalQuestions}
            </span>
            {task.budgetPreset ? (
              <span>{t(`budget.${task.budgetPreset}`)}</span>
            ) : null}
          </div>
          <p
            id={`research-plan-summary-${task.id}`}
            className="mt-3 line-clamp-2 max-w-3xl text-sm leading-6 text-foreground/90"
          >
            {task.plan.summary}
          </p>
          <div className="mt-3 max-w-3xl">
            <ResearchPlanContract plan={task.plan} compact />
          </div>
          <Button
            size="sm"
            variant="bare"
            className="mt-1 -ml-2 h-9 text-research-accent-text hover:bg-research-accent/10 hover:text-research-accent-hover sm:h-8"
            onClick={() => setPlanOpen(true)}
            aria-haspopup="dialog"
          >
            <ChevronDown size={14} aria-hidden="true" />
            {t("plan.showFull")}
          </Button>
          <div className="mt-2">
            <ResearchSourceScope task={task} />
          </div>
        </div>
      </section>
      <Dialog
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        title={t("plan.title")}
        headerAction={
          <IconButton
            label={t("actions.closePlan")}
            icon={<X size={16} aria-hidden="true" />}
            onClick={() => setPlanOpen(false)}
          />
        }
        placement="responsive-sheet"
        closeOnBackdropClick
      >
        <div className="max-h-[70dvh] space-y-5 overflow-y-auto p-4">
          <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/90">
            {task.plan.summary}
          </p>
          <ResearchPlanContract plan={task.plan} />
          <section aria-labelledby={`research-plan-steps-${task.id}`}>
            <h3
              id={`research-plan-steps-${task.id}`}
              className="mb-3 text-sm font-semibold text-foreground"
            >
              {t("plan.steps")}
            </h3>
            <PlanSteps plan={task.plan} detailed />
          </section>
          <div className="border-t border-border pt-4">
            <ResearchSourceScope task={task} />
          </div>
        </div>
      </Dialog>
    </>
  );
}

function QuestionEvidenceSummary({
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

function PlanPanel({ task }: { task: ResearchTaskViewModel }) {
  const t = useTranslations("Research");
  const evidenceByStepId = useMemo(() => {
    const result = new Map<string, ResearchEvidenceView[]>();
    for (const [index, step] of (task.plan?.steps ?? []).entries()) {
      const evidence = task.evidence.filter(
        (item) =>
          item.stepId === step.id || item.questionIndexes?.includes(index),
      );
      result.set(step.id, evidence);
    }
    return result;
  }, [task.evidence, task.plan?.steps]);
  const defaultExpandedStepId = useMemo(() => {
    const steps = task.plan?.steps ?? [];
    return (
      steps.find((step) => step.status === "in_progress") ??
      steps.find((step) => step.status === "pending") ??
      [...steps].reverse().find((step) => step.status === "completed")
    )?.id;
  }, [task.plan?.steps]);

  if (!task.plan) {
    return (
      <div className="mx-auto flex min-h-72 w-full max-w-5xl flex-col items-center justify-center px-5 text-center">
        <SearchCheck
          size={26}
          className="text-muted-foreground"
          aria-hidden="true"
        />
        <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
          {t("plan.empty")}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-10 p-4 sm:p-6">
      <section
        className="border-b border-border pb-6"
        aria-labelledby={`research-plan-overview-${task.id}`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id={`research-plan-overview-${task.id}`}
            className="text-lg font-semibold tracking-tight"
          >
            {t("plan.title")}
          </h2>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {t("plan.version", { version: task.plan.version })}
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          {task.plan.summary}
        </p>
      </section>

      <section aria-labelledby={`research-plan-contract-${task.id}`}>
        <h2
          id={`research-plan-contract-${task.id}`}
          className="text-sm font-semibold text-foreground"
        >
          {t("plan.planContract")}
        </h2>
        <div className="mt-4 border-t border-border pt-4">
          <ResearchPlanContract plan={task.plan} />
        </div>
      </section>

      {task.run ? <ResearchClaimNotice run={task.run} /> : null}
      <ResearchTopology task={task} />

      <section aria-labelledby={`research-step-ledger-${task.id}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id={`research-step-ledger-${task.id}`}
            className="text-sm font-semibold text-foreground"
          >
            {t("plan.steps")}
          </h2>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {task.completedQuestions}/{task.totalQuestions}
          </span>
        </div>
        <ol className="mt-3 border-t border-border">
          {task.plan.steps.map((step, index) => {
            const evidence = evidenceByStepId.get(step.id) ?? [];
            return (
              <li key={step.id} className="border-b border-border">
                <details open={step.id === defaultExpandedStepId || undefined}>
                  <summary className="group flex cursor-pointer list-none items-start gap-3 px-1 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <span className="w-7 shrink-0 pt-0.5 font-mono text-xs font-medium tabular-nums text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-medium leading-5 text-foreground">
                      {step.title}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      <span className="hidden sm:inline">
                        {step.status === "in_progress"
                          ? t("planStep.searching")
                          : t(`planStep.${step.status}`)}
                        {evidence.length > 0
                          ? `, ${t("planStep.sources", { count: evidence.length })}`
                          : ""}
                      </span>
                      <QuestionStatusIcon status={step.status} />
                      <ChevronDown
                        size={14}
                        className="transition-transform group-open:rotate-180 motion-reduce:transition-none"
                        aria-hidden="true"
                      />
                    </span>
                  </summary>
                  <div className="pb-4 pl-11 pr-1">
                    {step.objective && step.objective !== step.title ? (
                      <p className="mb-2 text-xs leading-5 text-foreground/80">
                        {step.objective}
                      </p>
                    ) : null}
                    {step.queryTopics?.length ? (
                      <p className="mb-1 text-xs leading-5 text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {t("plan.queryTopics")}:{" "}
                        </span>
                        {step.queryTopics.join(", ")}
                      </p>
                    ) : null}
                    {step.sourcePriorities?.length ? (
                      <p className="mb-1 text-xs leading-5 text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {t("plan.sourcePriorities")}:{" "}
                        </span>
                        {step.sourcePriorities.join(", ")}
                      </p>
                    ) : null}
                    {step.evidenceStandard ? (
                      <p className="mb-2 text-xs leading-5 text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {t("plan.evidenceStandard")}:{" "}
                        </span>
                        {step.evidenceStandard}
                      </p>
                    ) : null}
                    <QuestionEvidenceSummary evidence={evidence} />
                    {evidence.length === 0 ? (
                      <p className="text-xs leading-5 text-muted-foreground">
                        {step.status === "in_progress"
                          ? t("planStep.searchingDetail")
                          : step.status === "pending"
                            ? t("planStep.pendingDetail")
                            : t("evidence.none")}
                      </p>
                    ) : null}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

function EvidenceListItem({
  evidence,
  questionTitles,
}: {
  evidence: ResearchEvidenceView;
  questionTitles: string[];
}) {
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
            {new Date(evidence.retrievedAt).toLocaleString()}
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

function EvidencePanel({ task }: { task: ResearchTaskViewModel }) {
  const t = useTranslations("Research");
  const [questionFilter, setQuestionFilter] = useState<number | "all">("all");
  const [stanceFilter, setStanceFilter] = useState<EvidenceStance | "all">(
    "all",
  );
  const questionTitles = task.plan?.steps.map((step) => step.title) ?? [];
  const filteredEvidence = task.evidence.filter((item) => {
    const matchesQuestion =
      questionFilter === "all" ||
      item.questionIndexes?.includes(questionFilter);
    const matchesStance =
      stanceFilter === "all" || item.stance === stanceFilter;
    return matchesQuestion && matchesStance;
  });

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <h2 className="text-lg font-semibold">{t("evidence.title")}</h2>
      <div className="mt-4 space-y-3 border-b border-border pb-4">
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

function ActivityPanel({ task }: { task: ResearchTaskViewModel }) {
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

function ReportPanel({
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
          <select
            id={`report-version-${task.id}`}
            value={report.id}
            onChange={(event) => onSelectVersion(event.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {task.reportVersions.map((version) => (
              <option key={version.id} value={version.id}>
                {t("plan.version", { version: version.version })}
              </option>
            ))}
          </select>
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
      {task.status === "partial_completed" && task.gapSummary ? (
        <InlineStatus tone="warning" className="mt-4">
          <span className="font-medium">{t("card.knownGaps")}: </span>
          {task.gapSummary}
        </InlineStatus>
      ) : null}
      {report.changeSummary ? (
        <p className="mt-4 border-l-2 border-research-accent/60 pl-3 text-xs leading-5 text-muted-foreground">
          {report.changeSummary}
        </p>
      ) : null}
      {report.diff ? (
        <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
          {(["added", "changed", "unchanged"] as const).map((key) => (
            <div key={key}>
              <dt className="text-muted-foreground">
                {t(`report.diff.${key}`)}
              </dt>
              <dd className="mt-0.5 font-medium tabular-nums text-foreground">
                {report.diff?.[key]}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
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

function ResearchFollowupDialog({
  mode,
  onClose,
  onSubmit,
}: {
  mode: FollowupMode | null;
  onClose: () => void;
  onSubmit: (value: string) => void | Promise<void>;
}) {
  const t = useTranslations("Research");
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const fieldId = `research-followup-${mode ?? "closed"}`;

  const close = () => {
    if (submitting) return;
    setValue("");
    setError(false);
    onClose();
  };

  return (
    <Dialog
      open={mode !== null}
      onClose={close}
      title={mode ? t(`followup.${mode}.title`) : ""}
      placement="responsive-sheet"
    >
      {mode ? (
        <form
          className="space-y-4 p-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const input = value.trim();
            if (!input || submitting) return;
            setSubmitting(true);
            setError(false);
            try {
              await onSubmit(input);
              setValue("");
              onClose();
            } catch {
              setError(true);
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <div>
            <label
              htmlFor={fieldId}
              className="text-sm font-medium text-foreground"
            >
              {t(`followup.${mode}.label`)}
            </label>
            <p
              id={`${fieldId}-help`}
              className="mt-1 text-xs leading-5 text-muted-foreground"
            >
              {t(`followup.${mode}.help`)}
            </p>
            <textarea
              id={fieldId}
              aria-describedby={`${fieldId}-help`}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              rows={5}
              placeholder={t(`followup.${mode}.placeholder`)}
              className="mt-2 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            {error ? (
              <p
                className="mt-2 text-xs text-red-700 dark:text-red-300"
                role="alert"
              >
                {t("followup.error")}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 [&_button]:h-9 [&_button]:min-h-0 sm:[&_button]:h-8">
            <Button onClick={close} disabled={submitting}>
              {t("actions.dismiss")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!value.trim() || submitting}
              className="bg-research-solid text-research-accent-foreground hover:bg-research-accent-hover"
            >
              {submitting
                ? t("followup.submitting")
                : t(`followup.${mode}.submit`)}
            </Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}

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
        ? createLocalEvidenceCitations(report.markdown, task.evidence)
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
          className="h-9 min-h-0 min-w-9 sm:h-8 sm:min-w-0"
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

      <ApprovalBanner task={task} />
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
                "h-10 shrink-0 border-b-2 px-3 text-sm font-medium sm:h-9",
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

      <footer className="shrink-0 border-t border-border bg-background px-3 py-3 sm:px-4">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {task.run ? (
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
            <div className="inline-flex items-center gap-1.5">
              <Wrench size={13} aria-hidden="true" />
              <dt className="sr-only">{t("metrics.toolCalls")}</dt>
              <dd className="tabular-nums">
                {task.usage.toolCalls}/{task.usage.maxToolCalls}{" "}
                {t("metrics.toolCalls").toLocaleLowerCase()}
              </dd>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <Clock3 size={13} aria-hidden="true" />
              <dt className="sr-only">{t("metrics.elapsed")}</dt>
              <dd className="tabular-nums">
                {formatDuration(task.usage.elapsedMs)}/
                {formatDuration(task.usage.maxWallTimeMs)}
              </dd>
            </div>
            {task.usage.totalTokens !== undefined ? (
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
            <div>
              <dt className="sr-only">{t("metrics.questions")}</dt>
              <dd className="tabular-nums">
                {task.completedQuestions}/{task.totalQuestions}{" "}
                {t("metrics.questions").toLocaleLowerCase()}
              </dd>
            </div>
          </dl>
          <TaskActions
            compact
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
