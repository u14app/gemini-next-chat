"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";

import type {
  AgentUserInputAnswerValue,
  AgentUserInputRequest,
  AgentUserInputResult,
} from "@/types";
import { Button, Dialog, Input } from "@/components/ui/primitives";

interface AgentUserInputDialogProps {
  request?: AgentUserInputRequest;
  onRespond: (requestId: string, result: AgentUserInputResult) => void;
}

type DraftAnswers = Partial<Record<string, AgentUserInputAnswerValue>>;

export default function AgentUserInputDialog({
  request,
  onRespond,
}: AgentUserInputDialogProps) {
  const t = useTranslations("Content");
  const [answers, setAnswers] = useState<DraftAnswers>({});

  useEffect(() => setAnswers({}), [request?.requestId]);

  const canSubmit = useMemo(
    () =>
      Boolean(
        request?.questions.every((question) => {
          if (question.required === false) return true;
          const answer = answers[question.id];
          if (question.kind === "multiple_choice") {
            return Array.isArray(answer) && answer.length > 0;
          }
          if (question.kind === "confirmation") {
            return typeof answer === "boolean";
          }
          return typeof answer === "string" && answer.trim().length > 0;
        }),
      ),
    [answers, request?.questions],
  );

  if (!request) return null;

  const cancel = () =>
    onRespond(request.requestId, { status: "cancelled", answers: {} });

  return (
    <Dialog open onClose={cancel} title={t("agentInputTitle")}>
      <form
        className="flex max-h-[min(720px,85dvh)] flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onRespond(request.requestId, {
            status: "answered",
            answers: answers as Record<string, AgentUserInputAnswerValue>,
          });
        }}
      >
        <p className="border-b border-border px-4 py-3 text-sm leading-6 text-muted-foreground">
          {t("agentInputDescription")}
        </p>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 custom-scrollbar">
          {request.questions.map((question, questionIndex) => (
            <fieldset
              key={question.id}
              className="space-y-3 border-l-2 border-border pl-3"
            >
              <legend className="text-sm font-semibold leading-6 text-foreground">
                <span className="mr-2 font-mono text-[11px] text-muted-foreground">
                  {String(questionIndex + 1).padStart(2, "0")}
                </span>
                {question.header || question.question}
              </legend>
              {question.header ? (
                <p className="text-sm leading-6 text-muted-foreground">
                  {question.question}
                </p>
              ) : null}

              {question.kind === "short_text" ? (
                <Input
                  value={
                    typeof answers[question.id] === "string"
                      ? (answers[question.id] as string)
                      : ""
                  }
                  maxLength={question.maxLength || 500}
                  required={question.required !== false}
                  autoFocus={questionIndex === 0}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: event.target.value,
                    }))
                  }
                />
              ) : question.kind === "confirmation" ? (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: true, label: t("agentInputYes"), Icon: Check },
                    { value: false, label: t("agentInputNo"), Icon: X },
                  ].map(({ value, label, Icon }) => {
                    const selected = answers[question.id] === value;
                    return (
                      <Button
                        key={String(value)}
                        variant="bare"
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          setAnswers((current) => ({
                            ...current,
                            [question.id]: value,
                          }))
                        }
                        className={`min-h-11 rounded-md border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-brand bg-brand/10 text-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}
                      >
                        <Icon size={15} aria-hidden="true" />
                        {label}
                      </Button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2">
                  {(question.options || []).map((option) => {
                    const current = answers[question.id];
                    const selected = Array.isArray(current)
                      ? current.includes(option.value)
                      : current === option.value;
                    return (
                      <label
                        key={option.value}
                        className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 ${selected ? "border-brand bg-brand/8" : "border-border bg-background hover:bg-muted/60"}`}
                      >
                        <input
                          type={
                            question.kind === "multiple_choice"
                              ? "checkbox"
                              : "radio"
                          }
                          name={question.id}
                          value={option.value}
                          checked={selected}
                          onChange={() => {
                            setAnswers((draft) => {
                              if (question.kind !== "multiple_choice") {
                                return {
                                  ...draft,
                                  [question.id]: option.value,
                                };
                              }
                              const values = Array.isArray(draft[question.id])
                                ? (draft[question.id] as string[])
                                : [];
                              const next = values.includes(option.value)
                                ? values.filter(
                                    (value) => value !== option.value,
                                  )
                                : values.length <
                                    (question.maxSelections ||
                                      question.options?.length ||
                                      1)
                                  ? [...values, option.value]
                                  : values;
                              return { ...draft, [question.id]: next };
                            });
                          }}
                          className="mt-1 size-4 accent-brand"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-foreground">
                            {option.label}
                          </span>
                          {option.description ? (
                            <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" onClick={cancel} className="min-h-11">
            {t("agentInputCancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!canSubmit}
            className="min-h-11"
          >
            {t("agentInputContinue")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
