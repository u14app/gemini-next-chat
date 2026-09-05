"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Copy, Maximize2, Terminal, X } from "lucide-react";
import { copyTextToClipboard } from "@/lib/utils/clipboard";
import Tooltip from "@/components/ui/Tooltip";
import { Button } from "@/components/ui/primitives";

/** Public reading must not import persisted chat, provider, or settings stores. */
export function ReadOnlyCodeBlock({
  language,
  rawCode,
  children,
  forceExpandCodeBlocks,
}: {
  language: string;
  rawCode: string;
  children: React.ReactNode;
  forceExpandCodeBlocks?: boolean;
}) {
  const t = useTranslations("Content");
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const id = useId();
  const contentId = `${id}-content`;
  const titleId = `${id}-title`;
  const dialog = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (!fullscreen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      previousFocus?.focus();
    };
  }, [fullscreen]);
  const copy = async () => {
    const copied = await copyTextToClipboard(rawCode);
    if (!mounted.current) return;
    setCopyState(copied ? "copied" : "error");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopyState("idle"), 2000);
  };
  const copyLabel = t(
    copyState === "copied"
      ? "codeCopiedAria"
      : copyState === "error"
        ? "copyFailed"
        : "copyCodeAria",
  );
  const header = (expanded: boolean) => (
    <div className="markdown-codeblock-header flex items-center justify-between py-1 pl-4 pr-2">
      <span
        id={expanded ? titleId : undefined}
        className="markdown-codeblock-label flex items-center gap-2 text-xs font-semibold uppercase"
      >
        <Terminal size={14} aria-hidden="true" />
        {language}
      </span>
      <div className="flex items-center gap-2">
        <Tooltip content={copyLabel} position="bottom">
          <Button
            variant="bare"
            type="button"
            onClick={() => {
              void copy();
            }}
            aria-label={copyLabel}
            className="markdown-icon-button markdown-focus-ring rounded p-1.5"
          >
            {copyState === "copied" ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              <Copy size={14} aria-hidden="true" />
            )}
          </Button>
        </Tooltip>
        <Tooltip
          content={t(expanded ? "exitFullscreen" : "fullscreen")}
          position="bottom"
        >
          <Button
            variant="bare"
            type="button"
            onClick={() => setFullscreen(!expanded)}
            aria-label={t(expanded ? "exitFullscreenAria" : "fullscreenAria")}
            className="markdown-icon-button markdown-focus-ring rounded p-1.5"
          >
            {expanded ? (
              <X size={14} aria-hidden="true" />
            ) : (
              <Maximize2 size={14} aria-hidden="true" />
            )}
          </Button>
        </Tooltip>
        {!expanded && !forceExpandCodeBlocks ? (
          <Tooltip
            content={t(collapsed ? "expand" : "collapse")}
            position="bottom"
          >
            <Button
              variant="bare"
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              aria-controls={contentId}
              aria-expanded={!collapsed}
              aria-label={t(collapsed ? "expandCodeAria" : "collapseCodeAria")}
              className="markdown-icon-button markdown-focus-ring rounded p-1.5"
            >
              <ChevronDown
                size={14}
                className={collapsed ? "" : "rotate-180"}
                aria-hidden="true"
              />
            </Button>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
  return (
    <>
      <div
        className="markdown-codeblock group/codeblock my-2 overflow-hidden rounded-xl"
        data-readonly-code
      >
        {header(false)}
        <div
          id={contentId}
          className="markdown-codeblock-content overflow-auto p-4 font-mono text-sm"
          style={{
            maxHeight: collapsed && !forceExpandCodeBlocks ? "40vh" : undefined,
          }}
        >
          <pre>{children}</pre>
        </div>
      </div>
      {fullscreen
        ? createPortal(
            <div className="fixed inset-0 z-100 flex bg-background p-3 sm:p-6">
              <div
                ref={dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="markdown-codeblock flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setFullscreen(false);
                  }
                  if (event.key === "Tab") {
                    const buttons = Array.from(
                      dialog.current?.querySelectorAll<HTMLElement>(
                        "button:not([disabled]), [tabindex='0']",
                      ) || [],
                    );
                    const first = buttons[0];
                    const last = buttons[buttons.length - 1];
                    if (event.shiftKey && document.activeElement === first) {
                      event.preventDefault();
                      last?.focus();
                    }
                    if (!event.shiftKey && document.activeElement === last) {
                      event.preventDefault();
                      first?.focus();
                    }
                  }
                }}
              >
                {header(true)}
                <div
                  className="markdown-codeblock-content min-h-0 flex-1 overflow-auto p-4 font-mono text-sm"
                  tabIndex={0}
                >
                  <pre>{children}</pre>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
