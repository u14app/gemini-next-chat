"use client";

import { useId, useState } from "react";
import { MessageSquarePlus, Pencil, Send, Square, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import MarkdownRenderer from "@/components/content/MarkdownRenderer";
import { validateEvidenceAnswerCitations } from "@/lib/research/evidenceConversations";
import {
  Button,
  Dialog,
  IconButton,
  InlineStatus,
} from "@/components/ui/primitives";
import { useEvidenceConversation } from "@/hooks/research/useEvidenceConversation";
import { CustomSelect } from "@/components/ui/controls";

export default function EvidenceQuestionsPanel({
  taskId,
  reportId,
  reportVersions,
  onSelectVersion,
}: {
  taskId: string;
  reportId?: string;
  reportVersions: readonly { id: string; version: number }[];
  onSelectVersion: (id: string) => void;
}) {
  const t = useTranslations("EvidenceQuestions");
  const conversation = useEvidenceConversation(taskId, reportId);
  const [question, setQuestion] = useState("");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const formId = useId();
  const busy = Boolean(
    conversation.live ||
    conversation.thread?.turns.some((turn) => turn.status === "generating"),
  );
  const lockAvailable =
    typeof navigator !== "undefined" && Boolean(navigator.locks);
  const canAsk = Boolean(
    conversation.snapshot && conversation.available && lockAvailable && !busy,
  );
  const errorMessage = (code: string) =>
    t.has(`errors.${code}`)
      ? t(`errors.${code}`)
      : t("errors.GENERATION_FAILED");

  if (!reportId)
    return (
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="mt-3 text-sm text-muted-foreground">{t("noReport")}</p>
      </div>
    );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <header>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {t("description")}
        </p>
      </header>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="grid gap-1 text-xs font-medium sm:w-40">
          {t("version")}
          <CustomSelect
            ariaLabel={t("version")}
            selectButtonClassName="min-h-10 text-sm"
            value={reportId}
            onChange={onSelectVersion}
            options={reportVersions.map((report) => ({
              value: report.id,
              label: t("versionValue", { version: report.version }),
            }))}
          />
        </label>
        <label className="grid min-w-0 flex-1 gap-1 text-xs font-medium">
          {t("topic")}
          <CustomSelect
            ariaLabel={t("topic")}
            selectButtonClassName="min-h-10 text-sm"
            value={conversation.selectedId ?? ""}
            disabled={!conversation.threads.length}
            emptyLabel={t("noTopics")}
            onChange={(value) => {
              conversation.select(value);
              setRenameTarget(null);
              setQuestion("");
            }}
            options={conversation.threads.map((thread) => ({
              value: thread.id,
              label: thread.title,
            }))}
          />
        </label>
        <div className="flex gap-1">
          <Button
            variant="secondary"
            size="sm"
            disabled={!conversation.snapshot || !conversation.available}
            onClick={() =>
              void conversation.create(
                t("defaultTopic", { count: conversation.threads.length + 1 }),
              )
            }
          >
            <MessageSquarePlus size={15} aria-hidden="true" />
            {t("newTopic")}
          </Button>
          <IconButton
            size="sm"
            label={t("rename")}
            icon={<Pencil size={15} />}
            disabled={!conversation.thread}
            onClick={() => {
              setTitle(conversation.thread?.title ?? "");
              setRenameTarget(conversation.selectedId);
            }}
          />
          <IconButton
            size="sm"
            label={t("delete")}
            icon={<Trash2 size={15} />}
            disabled={!conversation.thread}
            onClick={() => setDeleteTarget(conversation.selectedId)}
          />
        </div>
      </div>
      {renameTarget ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim())
              void conversation.rename(renameTarget, title).then((saved) => {
                if (saved) setRenameTarget(null);
              });
          }}
        >
          <label className="grid min-w-0 flex-1 gap-1 text-xs font-medium">
            {t("topicName")}
            <input
              autoFocus
              value={title}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-research-accent"
            />
          </label>
          <Button type="submit" size="sm" disabled={!title.trim()}>
            {t("save")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRenameTarget(null)}
          >
            {t("cancel")}
          </Button>
        </form>
      ) : null}
      {conversation.error ? (
        <InlineStatus
          tone={
            conversation.error === "SNAPSHOT_UNAVAILABLE" ? "warning" : "danger"
          }
          live
        >
          {errorMessage(conversation.error)}
        </InlineStatus>
      ) : null}
      {!lockAvailable && conversation.snapshot ? (
        <InlineStatus tone="warning">
          {t("errors.EXCLUSIVE_UNAVAILABLE")}
        </InlineStatus>
      ) : null}
      {conversation.snapshot?.origin === "legacy_reconstruction" ? (
        <InlineStatus tone="warning">{t("legacy")}</InlineStatus>
      ) : null}
      {conversation.loading ? (
        <div role="status" aria-label={t("loading")} className="space-y-3">
          <div className="h-4 w-3/4 rounded bg-muted" />
          <div className="h-4 w-full rounded bg-muted" />
          <div className="h-4 w-1/2 rounded bg-muted" />
          <span className="sr-only">{t("loading")}</span>
        </div>
      ) : null}
      {!conversation.loading && !conversation.thread?.turns.length ? (
        <p className="py-8 text-sm leading-6 text-muted-foreground">
          {t("empty")}
        </p>
      ) : null}
      <div className="space-y-6" aria-label={t("conversation")}>
        {conversation.thread?.turns.map((turn, index, turns) => (
          <article
            key={turn.id}
            className="space-y-3 border-t border-border pt-5"
          >
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground">
                {t("question")}
              </h3>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">
                {turn.question}
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold text-research-accent">
                {t("answer")}
              </h3>
              {turn.status === "completed" ? (
                conversation.snapshot &&
                validateEvidenceAnswerCitations(
                  turn.answer,
                  conversation.snapshot,
                ) ? (
                  <MarkdownRenderer
                    content={turn.answer}
                    contentPolicy="evidence-answer"
                    readOnly
                    className="markdown-content text-sm leading-7"
                  />
                ) : (
                  <InlineStatus tone="danger">
                    {errorMessage("INVALID_CITATION")}
                  </InlineStatus>
                )
              ) : (
                <p className="whitespace-pre-wrap break-words text-sm leading-6">
                  {turn.requestId === conversation.live?.requestId
                    ? conversation.live.text || t("thinking")
                    : turn.answer}
                </p>
              )}
              {turn.status !== "completed" ? (
                <div className="mt-3 flex items-center gap-3">
                  <p role="status" className="text-xs text-muted-foreground">
                    {turn.errorCode
                      ? errorMessage(turn.errorCode)
                      : t(`status.${turn.status}`)}
                  </p>
                  {index === turns.length - 1 &&
                  turn.status !== "generating" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canAsk}
                      onClick={() =>
                        void conversation.ask(turn.question, turn.id)
                      }
                    >
                      {t("retry")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      <form
        className="sticky bottom-0 space-y-2 border-t border-border bg-background py-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canAsk || !question.trim()) return;
          const value = question;
          void conversation.ask(value).then((saved) => {
            if (saved)
              setQuestion((current) => (current === value ? "" : current));
          });
        }}
      >
        <label htmlFor={formId} className="block text-sm font-medium">
          {t("askLabel")}
        </label>
        <textarea
          id={formId}
          value={question}
          maxLength={8_000}
          rows={3}
          disabled={!conversation.snapshot || !conversation.available}
          onChange={(event) => setQuestion(event.target.value)}
          aria-describedby={`${formId}-hint`}
          className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-research-accent disabled:opacity-50"
        />
        <div className="flex items-center justify-between gap-3">
          <p id={`${formId}-hint`} className="text-xs text-muted-foreground">
            {t("hint")}
          </p>
          {busy ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void conversation.cancel()}
            >
              <Square size={14} aria-hidden="true" />
              {t("stop")}
            </Button>
          ) : (
            <Button
              type="submit"
              size="sm"
              disabled={!canAsk || !question.trim()}
            >
              <Send size={14} aria-hidden="true" />
              {t("send")}
            </Button>
          )}
        </div>
      </form>
      <Dialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        title={t("delete")}
        closeOnBackdropClick
        headerAction={
          <Button
            size="sm"
            variant="ghost"
            disabled={deleting}
            onClick={() => setDeleteTarget(null)}
          >
            {t("cancel")}
          </Button>
        }
      >
        <div className="space-y-4 p-4">
          <p className="text-sm">{t("deleteDescription")}</p>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              disabled={deleting}
              onClick={() => {
                if (!deleteTarget || deleting) return;
                setDeleting(true);
                void conversation.remove(deleteTarget).finally(() => {
                  setDeleting(false);
                  setDeleteTarget(null);
                });
              }}
            >
              {t("delete")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
