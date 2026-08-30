"use client";

import React, { useState } from "react";
import {
  Pause,
  Play,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Button,
  DangerAction,
  Dialog,
  IconButton,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";

import type { ResearchTaskActions, ResearchTaskViewModel } from "../types";
import { AdjustmentForm, StrategyAdjustmentForm } from "./AdjustmentForm";
import { ACTIVE_RESEARCH_STATUSES } from "./status";

export function TaskActions({
  task,
  actions,
  compact = false,
  presentation = "default",
}: {
  task: ResearchTaskViewModel;
  actions: ResearchTaskActions;
  compact?: boolean;
  presentation?: "default" | "decision-bar";
}) {
  const t = useTranslations("Research");
  const [adjusting, setAdjusting] = useState(false);
  const [tuningStrategy, setTuningStrategy] = useState(false);
  const isRunning = ACTIVE_RESEARCH_STATUSES.has(task.status);
  const canRetry =
    (task.status === "failed" || task.status === "clarifying") &&
    task.error?.recoverable;
  const retryLabel = t("actions.retry");
  const newFollowUpLabel = t("actions.newFollowUp");
  const isDecisionBar = presentation === "decision-bar";
  const isPlanDecision = isDecisionBar && task.status === "plan_ready";

  const openAdjustment = () => {
    setTuningStrategy(false);
    setAdjusting(true);
  };
  const openStrategy = () => {
    setAdjusting(false);
    setTuningStrategy(true);
  };

  return (
    <>
      <div
        className={cn(
          isDecisionBar
            ? "w-full [&_button]:h-auto [&_button]:min-h-11 md:w-auto md:[&_button]:h-8 md:[&_button]:min-h-0"
            : "[&_button]:h-9 [&_button]:min-h-0 sm:[&_button]:h-8",
        )}
      >
        <div
          className={cn(
            "flex flex-wrap gap-2",
            compact && "justify-end",
            isPlanDecision &&
              "grid w-full grid-cols-1 md:flex md:w-auto md:justify-end",
          )}
        >
          {isPlanDecision &&
          task.plan?.strategy &&
          actions.onUpdatePlanStrategy ? (
            <Button size="sm" onClick={openStrategy}>
              <SlidersHorizontal size={14} aria-hidden="true" />
              {t("actions.advancedStrategy")}
            </Button>
          ) : null}
          {isPlanDecision && actions.onAdjustPlan ? (
            <Button size="sm" onClick={openAdjustment}>
              <Sparkles size={14} aria-hidden="true" />
              {t("actions.adjust")}
            </Button>
          ) : null}
          {isPlanDecision && actions.onConfirmPlan ? (
            <Button
              size="sm"
              variant="primary"
              onClick={actions.onConfirmPlan}
              className="bg-research-solid text-research-accent-foreground hover:bg-research-accent-hover"
            >
              <Play size={14} aria-hidden="true" />
              {t("actions.start")}
            </Button>
          ) : null}
          {!isPlanDecision &&
          task.status === "plan_ready" &&
          actions.onConfirmPlan ? (
            <Button
              size="sm"
              variant="primary"
              onClick={actions.onConfirmPlan}
              className="bg-research-solid text-research-accent-foreground hover:bg-research-accent-hover"
            >
              <Play size={14} aria-hidden="true" />
              {t("actions.start")}
            </Button>
          ) : null}
          {!isPlanDecision &&
          (task.status === "plan_ready" ||
            task.status === "paused" ||
            isRunning) &&
          actions.onAdjustPlan ? (
            <Button
              size="sm"
              onClick={() => {
                setTuningStrategy(false);
                setAdjusting((value) => !value);
              }}
            >
              <Sparkles size={14} aria-hidden="true" />
              {t("actions.adjust")}
            </Button>
          ) : null}
          {!isPlanDecision &&
          task.status === "plan_ready" &&
          task.plan?.strategy &&
          actions.onUpdatePlanStrategy ? (
            <Button
              size="sm"
              onClick={() => {
                setAdjusting(false);
                setTuningStrategy((value) => !value);
              }}
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
              {t("actions.tuneStrategy")}
            </Button>
          ) : null}
          {isRunning && actions.onPause ? (
            <Button size="sm" onClick={actions.onPause}>
              <Pause size={14} aria-hidden="true" />
              {t("actions.pause")}
            </Button>
          ) : null}
          {task.status === "paused" && actions.onResume ? (
            <Button
              size="sm"
              variant="primary"
              onClick={actions.onResume}
              className="bg-research-solid text-research-accent-foreground hover:bg-research-accent-hover"
            >
              <Play size={14} aria-hidden="true" />
              {t("actions.resume")}
            </Button>
          ) : null}
          {canRetry && actions.onRetry ? (
            <Button
              size="sm"
              variant="primary"
              onClick={actions.onRetry}
              className="bg-research-solid text-research-accent-foreground hover:bg-research-accent-hover"
            >
              <RotateCcw size={14} aria-hidden="true" />
              {retryLabel}
            </Button>
          ) : null}
          {task.status === "failed" &&
          task.error?.recoverable &&
          actions.onDismiss ? (
            <Button size="sm" onClick={actions.onDismiss}>
              <X size={14} aria-hidden="true" />
              {t("actions.dismiss")}
            </Button>
          ) : null}
          {(task.status === "completed" ||
            task.status === "partial_completed") &&
          actions.onNewFollowUp ? (
            <Button size="sm" onClick={actions.onNewFollowUp}>
              <Plus size={14} aria-hidden="true" />
              {newFollowUpLabel}
            </Button>
          ) : null}
          {!isPlanDecision &&
          !["completed", "partial_completed", "failed", "cancelled"].includes(
            task.status,
          ) &&
          actions.onCancel ? (
            <DangerAction
              onConfirm={actions.onCancel}
              confirmLabel={t("actions.confirmCancel")}
              className="h-9 px-2.5 py-0 sm:h-8"
            >
              <X size={14} aria-hidden="true" />
              {t("actions.cancel")}
            </DangerAction>
          ) : null}
        </div>
        {!isDecisionBar && adjusting && actions.onAdjustPlan ? (
          <AdjustmentForm
            onSubmit={actions.onAdjustPlan}
            onDismiss={() => setAdjusting(false)}
          />
        ) : null}
        {!isDecisionBar &&
        tuningStrategy &&
        task.plan?.strategy &&
        actions.onUpdatePlanStrategy ? (
          <StrategyAdjustmentForm
            strategy={task.plan.strategy}
            onSubmit={actions.onUpdatePlanStrategy}
            onDismiss={() => setTuningStrategy(false)}
          />
        ) : null}
      </div>
      {isDecisionBar && adjusting && actions.onAdjustPlan ? (
        <Dialog
          open
          onClose={() => setAdjusting(false)}
          title={t("adjust.title")}
          headerAction={
            <IconButton
              label={t("actions.closeAdjust")}
              icon={<X size={16} aria-hidden="true" />}
              onClick={() => setAdjusting(false)}
              className="h-11 w-11 md:h-9 md:w-9"
            />
          }
          placement="responsive-sheet"
          closeOnBackdropClick
        >
          <AdjustmentForm
            embeddedInDialog
            onSubmit={actions.onAdjustPlan}
            onDismiss={() => setAdjusting(false)}
          />
        </Dialog>
      ) : null}
      {isDecisionBar &&
      tuningStrategy &&
      task.plan?.strategy &&
      actions.onUpdatePlanStrategy ? (
        <Dialog
          open
          onClose={() => setTuningStrategy(false)}
          title={t("strategyAdjust.title")}
          headerAction={
            <IconButton
              label={t("actions.closeStrategy")}
              icon={<X size={16} aria-hidden="true" />}
              onClick={() => setTuningStrategy(false)}
              className="h-11 w-11 md:h-9 md:w-9"
            />
          }
          placement="responsive-sheet"
          closeOnBackdropClick
          className="max-w-2xl"
        >
          <StrategyAdjustmentForm
            embeddedInDialog
            strategy={task.plan.strategy}
            onSubmit={actions.onUpdatePlanStrategy}
            onDismiss={() => setTuningStrategy(false)}
          />
        </Dialog>
      ) : null}
    </>
  );
}
