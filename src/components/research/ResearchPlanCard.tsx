"use client";

import React from "react";
import { ArrowUpRight, LoaderCircle, Check, Circle } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, InlineStatus } from "@/components/ui/primitives";

import { ResearchPlanContract } from "./ResearchTopology";
import {
  PlanSteps,
  ResearchSourceScope,
  StatusLabel,
  TaskActions,
} from "./researchUi";
import type { ResearchTaskActions, ResearchTaskViewModel } from "./types";

export interface ResearchPlanCardProps extends ResearchTaskActions {
  task: ResearchTaskViewModel;
  onOpenWorkbench: () => void;
}

/**
 * The stages the planning pipeline moves through before a plan is reviewable.
 * Planning takes minutes and emits nothing the user can read, so the card
 * shows where it is rather than a bare pulsing label.
 */
const PREPARING_STEPS = ["scope", "sources", "review"] as const;

function PreparingChecklist({ activeIndex }: { activeIndex: number }) {
  const t = useTranslations("Research");
  return (
    <ol className="space-y-2.5" aria-live="polite">
      {PREPARING_STEPS.map((step, index) => (
        <li key={step} className="flex items-start gap-2 text-sm leading-5">
          <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center">
            {index < activeIndex ? (
              <Check
                size={14}
                className="text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />
            ) : index === activeIndex ? (
              <LoaderCircle
                size={14}
                className="animate-spin text-research-accent motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Circle
                size={13}
                className="text-muted-foreground"
                aria-hidden="true"
              />
            )}
          </span>
          <span
            className={
              index < activeIndex
                ? "text-muted-foreground"
                : "text-foreground/90"
            }
          >
            {t(`card.preparingSteps.${step}`)}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The pre-run half of a research task: the plan is drafted, reviewed and
 * approved here. Once the run starts, `ResearchProgressCard` takes over.
 */
export default function ResearchPlanCard({
  task,
  onOpenWorkbench,
  onConfirmPlan,
  onAdjustPlan,
  onUpdatePlanStrategy,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onDismiss,
  onNewFollowUp,
}: ResearchPlanCardProps) {
  const t = useTranslations("Research");
  const plan = task.plan;
  const isPreparing = task.status === "draft" || task.status === "clarifying";
  // The plan itself is the only evidence of how far planning has come: no plan
  // means scoping, a plan without steps means the contract is still forming.
  const preparingIndex = !plan ? 0 : plan.recon ? 2 : 1;
  const scopeParts = [
    plan?.scope?.audience,
    plan?.scope?.timeRange,
    plan?.scope?.allowedSourceTypes?.length
      ? plan.scope.allowedSourceTypes
          .map((sourceType) => t(`sourceType.${sourceType}`))
          .join(", ")
      : undefined,
    plan?.deliverable ? t(`deliverable.${plan.deliverable.kind}`) : undefined,
  ].filter((part): part is string => Boolean(part));

  return (
    <section
      className="my-3 overflow-hidden rounded-xl border border-border bg-muted/15"
      aria-labelledby={`research-plan-${task.id}`}
    >
      <header className="flex items-start gap-3 border-b border-border px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div aria-live="polite" aria-atomic="true">
            <StatusLabel status={task.status} />
          </div>
          <h2
            id={`research-plan-${task.id}`}
            className="mt-1 wrap-break-word text-sm font-semibold leading-5 text-foreground"
          >
            {task.title}
          </h2>
        </div>
        {plan ? (
          <Button
            size="sm"
            onClick={onOpenWorkbench}
            className="h-9 shrink-0 sm:h-8"
            aria-label={t("actions.openWorkbench")}
          >
            <ArrowUpRight size={14} aria-hidden="true" />
            <span className="hidden sm:inline">
              {t("actions.openWorkbench")}
            </span>
            <span className="sm:hidden">{t("actions.open")}</span>
          </Button>
        ) : null}
      </header>

      <div className="space-y-4 px-4 py-4">
        {task.error ? (
          <InlineStatus tone="danger" live>
            {task.error.message}
          </InlineStatus>
        ) : null}

        {isPreparing && !task.error ? (
          <PreparingChecklist activeIndex={preparingIndex} />
        ) : null}

        {task.status !== "plan_ready" && task.summary ? (
          <p className="text-sm leading-6 text-foreground/85">{task.summary}</p>
        ) : null}

        {task.status === "plan_ready" && plan ? (
          <div>
            {plan.objective ? (
              <p className="text-sm leading-6 text-foreground/85">
                {plan.objective}
              </p>
            ) : null}
            {scopeParts.length ? (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {scopeParts.join(" · ")}
              </p>
            ) : null}

            <div className="mt-4 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">
                {t("plan.steps")}
              </h3>
              <span className="text-[11px] text-muted-foreground">
                {t("plan.version", { version: plan.version })}
              </span>
            </div>
            <div className="mt-3">
              <PlanSteps plan={plan} />
            </div>

            <details className="group mt-4">
              <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground hover:text-foreground">
                {t("card.fullContract")}
              </summary>
              <div className="mt-3">
                <ResearchPlanContract plan={plan} compact />
              </div>
            </details>

            {plan.strategy ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {t("card.budgetSummary", {
                  preset: task.budgetPreset
                    ? t(`budget.${task.budgetPreset}`)
                    : "—",
                  queries: plan.strategy.queryLimit,
                  depth: plan.strategy.maxDepth,
                })}
              </p>
            ) : null}

            <div className="mt-3 border-t border-border pt-3">
              <ResearchSourceScope task={task} />
            </div>
          </div>
        ) : null}

        {task.status === "plan_ready" ? (
          <p className="text-xs leading-5 text-muted-foreground">
            {t("card.replyHint")}
          </p>
        ) : null}

        <TaskActions
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
            onNewFollowUp,
          }}
        />
      </div>
    </section>
  );
}
