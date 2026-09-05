"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Copy, ExternalLink, X } from "lucide-react";
import { Button, Dialog, IconButton } from "@/components/ui/primitives";
import { useChatStore } from "@/store/core/chatStore";
import { readSessionForPresentation } from "@/components/chat/sessionPresentation";
import { prepareSessionShare } from "@/services/sharing/snapshot";
import {
  getSessionShare,
  publishSessionShare,
  revokeSessionShare,
} from "@/services/sharing/client";
import type { ShareExpiry, ShareMetadata } from "@/lib/sharing/types";
import { copyTextToClipboard } from "@/lib/utils/clipboard";

export default function ShareDialog({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const t = useTranslations("Sharing");
  const common = useTranslations("Common");
  const locale = useLocale();
  const [share, setShare] = useState<ShareMetadata | null>(null);
  const [expiry, setExpiry] = useState<ShareExpiry>("1d");
  const [expiryChanged, setExpiryChanged] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    void getSessionShare(sessionId)
      .then((value) => {
        if (mounted.current) setShare(value);
      })
      .catch(() => {
        if (mounted.current) setError(t("loadFailed"));
      })
      .finally(() => {
        if (mounted.current) setBusy(false);
      });
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, [sessionId, t]);

  const shareUrl =
    share && typeof window !== "undefined"
      ? new URL(`/share/${share.id}`, window.location.origin).toString()
      : "";
  const isExpired = share?.expiresAt != null && share.expiresAt <= Date.now();
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    const request = new AbortController();
    controller.current = request;
    try {
      const session = useChatStore
        .getState()
        .sessions.find((item) => item.id === sessionId);
      if (!session) throw new Error("SESSION_UNAVAILABLE");
      const frozen = await readSessionForPresentation(session);
      const prepared = await prepareSessionShare({
        session: frozen,
        messages: frozen.messages,
        signal: request.signal,
      });
      request.signal.throwIfAborted();
      const next = await publishSessionShare({
        sessionId,
        signal: request.signal,
        ...prepared,
        ...(!share || isExpired || expiryChanged ? { expiresIn: expiry } : {}),
      });
      if (mounted.current) {
        setShare(next);
        setExpiryChanged(false);
      }
    } catch (failure) {
      if (!mounted.current || request.signal.aborted) return;
      const code =
        failure && typeof failure === "object" && "code" in failure
          ? String(failure.code)
          : "";
      setError(
        code.includes("LIMIT") || code.includes("LARGE")
          ? t("tooLarge")
          : code.includes("IMAGE") || code.includes("ASSET")
            ? t("imageFailed")
            : code.includes("CONFLICT")
              ? t("conflict")
              : t("publishFailed"),
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const revoke = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await revokeSessionShare(sessionId);
      if (mounted.current) {
        setShare(null);
        setCopied(false);
      }
    } catch {
      if (mounted.current) setError(t("revokeFailed"));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("title")}
      closeOnBackdropClick
      placement="responsive-sheet"
      className="flex max-w-lg flex-col"
      headerAction={
        <IconButton
          label={common("close")}
          icon={<X size={16} />}
          onClick={onClose}
        />
      }
    >
      <div className="min-h-0 space-y-4 overflow-y-auto p-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("description")}
        </p>
        {shareUrl && (
          <div className="space-y-2">
            <label htmlFor="session-share-url" className="text-sm font-medium">
              {t("link")}
            </label>
            <div className="flex gap-2">
              <input
                id="session-share-url"
                readOnly
                value={shareUrl}
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 rounded-md border border-input bg-muted/30 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <IconButton
                label={copied ? t("copied") : t("copyLink")}
                icon={copied ? <Check size={16} /> : <Copy size={16} />}
                onClick={() => {
                  void copyTextToClipboard(shareUrl).then((ok) => {
                    setCopied(ok);
                    if (!ok) setError(t("copyFailed"));
                  });
                }}
              />
              <a
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("openLink")}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ExternalLink size={16} aria-hidden="true" />
              </a>
            </div>
            <p className="text-xs text-muted-foreground">
              {isExpired
                ? t("expired")
                : share?.expiresAt
                  ? t("expiresOn", {
                      date: new Date(share.expiresAt).toLocaleString(locale),
                    })
                  : t("forever")}
            </p>
          </div>
        )}
        <div className="space-y-2 text-sm">
          <p id="session-share-expiry-label" className="font-medium">
            {share && !isExpired ? t("changeExpiry") : t("expiry")}
          </p>
          <div
            role="group"
            aria-labelledby="session-share-expiry-label"
            className={`grid grid-cols-2 gap-1.5 ${
              share && !isExpired ? "sm:grid-cols-5" : "sm:grid-cols-4"
            }`}
          >
            {[
              ...(share && !isExpired
                ? [{ value: "keep", label: t("keepExpiry") }]
                : []),
              { value: "1d", label: t("oneDay") },
              { value: "7d", label: t("sevenDays") },
              { value: "30d", label: t("thirtyDays") },
              { value: "forever", label: t("forever") },
            ].map(({ value, label }) => {
              const selected =
                (share && !isExpired && !expiryChanged ? "keep" : expiry) ===
                value;
              return (
                <Button
                  key={value}
                  variant="bare"
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() => {
                    if (value === "keep") setExpiryChanged(false);
                    else {
                      setExpiry(value as ShareExpiry);
                      setExpiryChanged(true);
                    }
                  }}
                  className={`min-h-9 rounded-md border px-2 py-1.5 text-xs font-medium leading-4 transition-colors ${
                    selected
                      ? "border-brand bg-brand/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("deleteNotice")}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {share && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void revoke()}
            >
              {t("revoke")}
            </Button>
          )}
          <Button
            disabled={busy}
            onClick={() => void submit()}
            className="border-blue-600 bg-blue-600 text-white hover:bg-blue-700 dark:border-blue-600 dark:bg-blue-600 dark:text-white dark:hover:bg-blue-700"
          >
            {busy
              ? t("working")
              : share && !isExpired
                ? t("update")
                : t("create")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
