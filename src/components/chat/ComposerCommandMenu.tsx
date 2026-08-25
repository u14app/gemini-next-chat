"use client";

import React from "react";
import {
  Blocks,
  MessageSquareQuote,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import AnchoredPortal from "@/components/ui/AnchoredPortal";
import type { ComposerFilterableItem } from "@/lib/utils/composerCommands";

export type ComposerCommandKind =
  "action" | "skill" | "plugin" | "conversation";

export interface ComposerCommandItem extends ComposerFilterableItem {
  /** Unique across the whole menu, e.g. `action:new-chat`. */
  id: string;
  kind: ComposerCommandKind;
  hint?: string;
  icon?: LucideIcon;
}

export interface ComposerCommandSection {
  id: string;
  label: string;
  items: ComposerCommandItem[];
}

const KIND_ICONS: Record<ComposerCommandKind, LucideIcon> = {
  action: Sparkles,
  skill: Sparkles,
  plugin: Blocks,
  conversation: MessageSquareQuote,
};

// Matches the accent each capability already uses in the composer toolbar, so
// the menu reads as an extension of it rather than a separate system.
const KIND_ACCENTS: Record<ComposerCommandKind, string> = {
  action: "text-brand bg-brand/10",
  skill: "text-emerald-500 bg-emerald-500/10 dark:text-emerald-400",
  plugin: "text-cyan-500 bg-cyan-500/10 dark:text-cyan-400",
  conversation: "text-indigo-500 bg-indigo-500/10 dark:text-indigo-400",
};

interface ComposerCommandMenuProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  sections: ComposerCommandSection[];
  highlightedId: string | null;
  onHighlight: (id: string) => void;
  onSelect: (item: ComposerCommandItem) => void;
  listboxId: string;
  getOptionId: (itemId: string) => string;
  ariaLabel: string;
  emptyLabel: string;
  hintLabel: string;
}

export default function ComposerCommandMenu({
  anchorRef,
  open,
  onClose,
  sections,
  highlightedId,
  onHighlight,
  onSelect,
  listboxId,
  getOptionId,
  ariaLabel,
  emptyLabel,
  hintLabel,
}: ComposerCommandMenuProps) {
  const hasItems = sections.some((section) => section.items.length > 0);

  return (
    <AnchoredPortal
      anchorRef={anchorRef}
      open={open}
      onClose={onClose}
      id={listboxId}
      role="listbox"
      ariaLabel={ariaLabel}
      placement="top-start"
      matchAnchorWidth
      maxHeight={296}
      className="z-50 overflow-hidden overflow-y-auto rounded-xl border border-input bg-popover text-popover-foreground shadow-xl custom-scrollbar"
    >
      <div className="p-1">
        {hasItems ? (
          sections
            .filter((section) => section.items.length > 0)
            .map((section) => (
              <div key={section.id} role="group" aria-label={section.label}>
                <div className="mx-1 mb-1 mt-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">
                  {section.label}
                </div>
                {section.items.map((item) => {
                  const Icon = item.icon || KIND_ICONS[item.kind];
                  const isHighlighted = highlightedId === item.id;
                  return (
                    <div
                      key={item.id}
                      id={getOptionId(item.id)}
                      role="option"
                      tabIndex={-1}
                      aria-selected={isHighlighted}
                      onMouseEnter={() => onHighlight(item.id)}
                      onPointerDown={(event) => {
                        // Keep composer focus so the caret stays put.
                        event.preventDefault();
                      }}
                      onClick={() => onSelect(item)}
                      className={`mb-0.5 flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                        isHighlighted
                          ? "bg-accent text-accent-foreground"
                          : "text-popover-foreground"
                      }`}
                    >
                      <span
                        className={`flex size-7 shrink-0 items-center justify-center rounded-md ${KIND_ACCENTS[item.kind]}`}
                      >
                        <Icon size={14} aria-hidden="true" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">
                          {item.label}
                        </span>
                        {item.hint ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {item.hint}
                          </span>
                        ) : null}
                      </span>
                      {item.kind !== "conversation" ? (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {item.token}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))
        ) : (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">
            {emptyLabel}
          </div>
        )}
      </div>
      <div className="sticky bottom-0 border-t border-border/60 bg-popover/95 px-3 py-1.5 text-[10px] text-muted-foreground backdrop-blur-sm">
        {hintLabel}
      </div>
    </AnchoredPortal>
  );
}
