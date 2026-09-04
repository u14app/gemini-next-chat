"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, CircleX, SearchCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils/cn";
import { ResearchSteeringPanel } from "../ui/ResearchSteeringPanel";
import SaveResearchTemplateButton from "../SaveResearchTemplateButton";

import ResearchDisclosure from "../ResearchDisclosure";
import {
  ResearchClaimNotice,
  ResearchPlanContract,
  ResearchTopology,
} from "../topology";
import { ResearchSourceScope, StatusLabel } from "../ui";
import type {
  ResearchEvidenceView,
  ResearchPlanView,
  ResearchTaskViewModel,
} from "../types";

import { QuestionEvidenceSummary, QuestionStatusIcon } from "./QuestionSummary";

function PlanStepDisclosure({
  step,
  index,
  evidence,
  defaultOpen,
}: {
  step: ResearchPlanView["steps"][number];
  index: number;
  evidence: ResearchEvidenceView[];
  defaultOpen: boolean;
}) {
  const t = useTranslations("Research");
  const [open, setOpen] = useState(defaultOpen);
  const queryTopicCount = step.queryTopics?.length ?? 0;
  const sourcePriorityCount = step.sourcePriorities?.length ?? 0;

  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  return (
    <li className="border-b border-border last:border-b-0">
      <ResearchDisclosure
        open={open}
        onOpenChange={setOpen}
        ariaCurrent={step.status === "in_progress" ? "step" : undefined}
        triggerClassName="flex min-h-16 w-full cursor-pointer flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:flex-nowrap md:items-center"
        summary={(isOpen) => (
          <>
            <span className="w-7 shrink-0 pt-0.5 font-mono text-lg font-medium tabular-nums text-foreground/85 md:pt-0">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-5 text-foreground">
                {step.title}
              </span>
              {step.objective && step.objective !== step.title ? (
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {step.objective}
                </span>
              ) : null}
            </span>
            <span className="ml-10 flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground md:ml-0 md:w-auto md:max-w-64 md:justify-end">
              <span>
                {step.status === "in_progress"
                  ? t("planStep.searching")
                  : t(`planStep.${step.status}`)}
              </span>
              {queryTopicCount > 0 ? (
                <span>
                  {t("planStep.queryTopicsCount", { count: queryTopicCount })}
                </span>
              ) : null}
              {sourcePriorityCount > 0 ? (
                <span>
                  {t("planStep.sourcePrioritiesCount", {
                    count: sourcePriorityCount,
                  })}
                </span>
              ) : null}
              {evidence.length > 0 ? (
                <span>{t("planStep.sources", { count: evidence.length })}</span>
              ) : null}
              <QuestionStatusIcon status={step.status} />
              <ChevronDown
                size={14}
                className={cn(
                  "transition-transform duration-200 ease-out motion-reduce:transition-none",
                  isOpen && "rotate-180",
                )}
                aria-hidden="true"
              />
            </span>
          </>
        )}
      >
        <div className="border-t border-border bg-research-soft/40 px-4 py-4 pl-14">
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
      </ResearchDisclosure>
    </li>
  );
}

function PlanBoundary({ task }: { task: ResearchTaskViewModel }) {
  const t = useTranslations("Research");
  const scope = task.plan?.scope;
  const included = [
    ...(scope?.includes ?? []),
    ...(scope?.timeRange ? [`${t("plan.timeRange")}: ${scope.timeRange}`] : []),
    ...(scope?.audience ? [`${t("plan.audience")}: ${scope.audience}`] : []),
    ...(scope?.allowedSourceTypes?.length
      ? [
          `${t("plan.allowedSources")}: ${scope.allowedSourceTypes
            .map((sourceType) => t(`sourceType.${sourceType}`))
            .join(", ")}`,
        ]
      : []),
    ...(scope?.preferredDomains?.length
      ? [`${t("plan.preferredDomains")}: ${scope.preferredDomains.join(", ")}`]
      : []),
  ];
  const excluded = [
    ...(scope?.excludes ?? []),
    ...(scope?.excludedDomains?.length
      ? [`${t("plan.excludedDomains")}: ${scope.excludedDomains.join(", ")}`]
      : []),
  ];

  return (
    <section
      className="border-y border-border py-5"
      aria-labelledby={`research-boundary-${task.id}`}
    >
      <h2 id={`research-boundary-${task.id}`} className="sr-only">
        {t("plan.boundaries")}
      </h2>
      <div className="grid gap-6 md:grid-cols-2 md:gap-0">
        <div className="md:pr-7">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CheckCircle2
              size={18}
              className="text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
            {t("plan.willResearch")}
          </h3>
          {included.length > 0 ? (
            <ul className="mt-3 space-y-2 pl-7 text-sm leading-6 text-foreground/80">
              {included.map((item) => (
                <li
                  key={item}
                  className="relative before:absolute before:-left-4 before:content-['•']"
                >
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 pl-7">
            <ResearchSourceScope task={task} />
          </div>
          {included.length === 0 && !task.sourceScope ? (
            <p className="mt-3 pl-7 text-sm leading-6 text-muted-foreground">
              {t("plan.noExplicitInclusions")}
            </p>
          ) : null}
        </div>
        <div className="border-t border-border pt-5 md:border-t-0 md:border-l md:pt-0 md:pl-7">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CircleX
              size={18}
              className="text-red-600 dark:text-red-400"
              aria-hidden="true"
            />
            {t("plan.willNotResearch")}
          </h3>
          {excluded.length > 0 ? (
            <ul className="mt-3 space-y-2 pl-7 text-sm leading-6 text-foreground/80">
              {excluded.map((item) => (
                <li
                  key={item}
                  className="relative before:absolute before:-left-4 before:content-['•']"
                >
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 pl-7 text-sm leading-6 text-muted-foreground">
              {t("plan.noExplicitExclusions")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export function PlanPanel({ task }: { task: ResearchTaskViewModel }) {
  const t = useTranslations("Research");
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
    if (!task.run) return steps[0]?.id;
    return (
      steps.find((step) => step.status === "in_progress") ??
      steps.find((step) => step.status === "pending") ??
      [...steps].reverse().find((step) => step.status === "completed")
    )?.id;
  }, [task.plan?.steps, task.run]);

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

  const hasAdvancedInformation = Boolean(
    task.plan.recon ||
    task.plan.assumptions?.length ||
    task.plan.deliverable ||
    task.plan.strategy ||
    task.plan.completionCriteria?.length,
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 p-4 pb-8 sm:p-6 sm:pb-10">
      <section aria-labelledby={`research-plan-overview-${task.id}`}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-research-border bg-research-soft px-2.5 py-1">
            <StatusLabel status={task.status} />
          </span>
          <span className="font-mono tabular-nums text-muted-foreground">
            {t("plan.version", { version: task.plan.version })}
          </span>
        </div>
        <h2
          id={`research-plan-overview-${task.id}`}
          className="mt-5 max-w-4xl text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
        >
          {task.plan.objective || task.title}
        </h2>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
          {task.plan.summary}
        </p>
        <div className="mt-4">
          <SaveResearchTemplateButton plan={task.plan} />
        </div>
      </section>

      <PlanBoundary task={task} />

      <ResearchSteeringPanel key={task.id} taskId={task.id} />

      <section aria-labelledby={`research-step-ledger-${task.id}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id={`research-step-ledger-${task.id}`}
            className="text-base font-semibold text-foreground"
          >
            {t("plan.steps")}
          </h2>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {task.completedQuestions}/{task.totalQuestions}
          </span>
        </div>
        <ol className="mt-3 overflow-hidden rounded-lg border border-research-border bg-background">
          {task.plan.steps.map((step, index) => {
            const evidence = evidenceByStepId.get(step.id) ?? [];
            return (
              <PlanStepDisclosure
                key={step.id}
                step={step}
                index={index}
                evidence={evidence}
                defaultOpen={step.id === defaultExpandedStepId}
              />
            );
          })}
        </ol>
      </section>

      {hasAdvancedInformation ? (
        <ResearchDisclosure
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
          className="overflow-hidden rounded-lg border border-border"
          triggerClassName="flex min-h-11 w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          summary={(isOpen) => (
            <>
              <ChevronDown
                size={16}
                className={cn(
                  "shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none",
                  isOpen && "rotate-180",
                )}
                aria-hidden="true"
              />
              <span>{t("plan.advancedDisclosure")}</span>
              <span className="ml-auto hidden text-xs font-normal text-muted-foreground md:inline">
                {t("plan.advancedDisclosureHint")}
              </span>
            </>
          )}
        >
          <div className="border-t border-border p-4 sm:p-5">
            <ResearchPlanContract plan={task.plan} advancedOnly />
          </div>
        </ResearchDisclosure>
      ) : null}

      {task.run ? (
        <div className="space-y-6 border-t border-border pt-7">
          <ResearchClaimNotice run={task.run} />
          <ResearchTopology task={task} />
        </div>
      ) : null}
    </div>
  );
}
