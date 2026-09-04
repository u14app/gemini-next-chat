"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/primitives";
import { CustomSelect } from "@/components/ui/controls";
import { useResearchSteering } from "@/hooks/research/useResearchSteering";
import {
  canSteerResearchTask,
  RESEARCH_STEERING_MAX_QUESTION_LENGTH,
} from "@/lib/research/steering";

export function ResearchSteeringPanel({ taskId }: { taskId: string }) {
  const t = useTranslations("ResearchSteering");
  const steering = useResearchSteering(taskId);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [selectedStepId, setSelectedStepId] = useState("");
  const stepId = steering.plan?.steps.some((step) => step.id === selectedStepId)
    ? selectedStepId
    : (steering.plan?.steps[0]?.id ?? "");
  if (!steering.task || !steering.run || !canSteerResearchTask(steering.task))
    return null;
  const recent = steering.record?.commands.slice(-5).reverse() ?? [];
  return (
    <section className="space-y-3" aria-labelledby={`steering-${taskId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id={`steering-${taskId}`}
          className="text-sm font-semibold text-foreground"
        >
          {t("title")}
        </h2>
        <Button
          size="sm"
          className="min-h-11 whitespace-nowrap"
          aria-expanded={open}
          aria-controls={`steering-form-${taskId}`}
          disabled={!steering.available || steering.loading}
          onClick={() => setOpen(!open)}
        >
          <Plus size={15} aria-hidden />
          {t("addQuestion")}
        </Button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground" role="status">
        {steering.loading
          ? t("loading")
          : steering.available
            ? t("hint")
            : t("unavailable")}
      </p>
      {open ? (
        <form
          id={`steering-form-${taskId}`}
          className="space-y-3 rounded-lg border border-research-border bg-research-soft/30 p-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await steering.addQuestion(stepId, question)) {
              setQuestion("");
              setOpen(false);
            }
          }}
        >
          <div className="space-y-1.5">
            <label
              htmlFor={`steering-step-${taskId}`}
              className="block text-xs font-medium text-foreground"
            >
              {t("step")}
            </label>
            <CustomSelect
              id={`steering-step-${taskId}`}
              ariaLabel={t("step")}
              value={stepId}
              onChange={setSelectedStepId}
              disabled={steering.busy}
              selectButtonClassName="min-h-11 text-sm"
              options={
                steering.plan?.steps.map((step) => ({
                  value: step.id,
                  label: step.title,
                })) ?? []
              }
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor={`steering-question-${taskId}`}
              className="block text-xs font-medium text-foreground"
            >
              {t("question")}
            </label>
            <textarea
              id={`steering-question-${taskId}`}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={RESEARCH_STEERING_MAX_QUESTION_LENGTH}
              rows={3}
              required
              disabled={steering.busy}
              aria-describedby={`steering-scope-${taskId}`}
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p
              id={`steering-scope-${taskId}`}
              className="text-xs leading-5 text-muted-foreground"
            >
              {t("scopeHint")}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              className="min-h-11"
              onClick={() => setOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="min-h-11 whitespace-nowrap border-research-border bg-research-soft text-research-accent-text"
              disabled={
                !steering.available ||
                steering.busy ||
                !question.trim() ||
                !stepId
              }
            >
              {steering.busy ? t("saving") : t("submit")}
            </Button>
          </div>
        </form>
      ) : null}
      {steering.error ? (
        <p role="alert" className="text-xs leading-5 text-destructive">
          {t(`errors.${steering.error}`)}
        </p>
      ) : null}
      {recent.length ? (
        <ol className="space-y-2" aria-label={t("history")} aria-live="polite">
          {recent.map((command) => (
            <li
              key={command.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs"
            >
              <span className="min-w-0 flex-1 break-words text-foreground">
                {command.intent.kind === "add"
                  ? command.intent.question
                  : t(
                      command.intent.priority === -1
                        ? "promote"
                        : command.intent.priority === 1
                          ? "demote"
                          : "reset",
                    ) +
                    ": " +
                    (steering.run?.nodes.find(
                      (node) => node.id === command.intent.nodeId,
                    )?.query ?? "")}
              </span>
              <span className="text-muted-foreground">
                {command.status === "rejected"
                  ? t(`errors.${command.reason ?? "closed"}`)
                  : t(command.status)}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
