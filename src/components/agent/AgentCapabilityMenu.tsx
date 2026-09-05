"use client";

import React, { useRef, useState } from "react";
import {
  Bot,
  Check,
  MessageCircle,
  Route,
  Settings2,
  Telescope,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";

import type { ChatMode } from "@/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ShortcutTooltipContent,
  useShortcutPresentation,
} from "@/components/shortcuts/ShortcutHint";
import { Button, Dialog } from "@/components/ui/primitives";
import Tooltip from "@/components/ui/Tooltip";

export interface ChatModeOption {
  value: ChatMode;
  label: string;
  description: string;
  supported: boolean;
}

interface AgentCapabilityMenuProps {
  mode: ChatMode;
  options: ChatModeOption[];
  disabled?: boolean;
  onModeChange: (mode: ChatMode) => void;
  onOpenSettings: (
    mode: Extract<ChatMode, "agent" | "research">,
    returnFocus: HTMLButtonElement | null,
  ) => void;
  buttonClassName: string;
}

function ModeIcon({ mode, size = 16 }: { mode: ChatMode; size?: number }) {
  switch (mode) {
    case "auto":
      return <Route size={size} aria-hidden="true" />;
    case "chat":
      return <MessageCircle size={size} aria-hidden="true" />;
    case "research":
      return <Telescope size={size} aria-hidden="true" />;
    case "agent":
      return <Bot size={size} aria-hidden="true" />;
  }
}

function SettingsButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label} position="left" portal>
      <Button
        variant="bare"
        type="button"
        aria-label={label}
        onClick={onClick}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Settings2 size={15} aria-hidden="true" />
      </Button>
    </Tooltip>
  );
}

function ModePanel({
  mode,
  options,
  onModeChange,
  onOpenSettings,
  close,
  showHeader = true,
}: Pick<AgentCapabilityMenuProps, "mode" | "options" | "onModeChange"> & {
  onOpenSettings: (mode: Extract<ChatMode, "agent" | "research">) => void;
  close: () => void;
  showHeader?: boolean;
}) {
  const t = useTranslations("MessageInput");
  const settingsMode =
    mode === "agent" || mode === "research" ? mode : undefined;
  const settingsLabel =
    settingsMode === "research"
      ? t("researchSettingsOpen")
      : t("agentSettingsOpen");

  return (
    <div className="w-full">
      {showHeader ? (
        <div className="border-b border-border px-2 py-1">
          <div className="flex min-h-8 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <ModeIcon mode={mode} size={15} />
              <span className="text-xs font-semibold text-foreground">
                {t("chatModeLabel")}
              </span>
            </div>
            {settingsMode ? (
              <SettingsButton
                label={settingsLabel}
                onClick={() => {
                  close();
                  onOpenSettings(settingsMode);
                }}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className="space-y-1 p-2"
        role="group"
        aria-label={t("chatModeLabel")}
      >
        {options.map((option) => {
          const selected = option.value === mode;
          return (
            <Button
              key={option.value}
              variant="bare"
              type="button"
              aria-pressed={selected}
              disabled={!option.supported}
              onClick={() => {
                onModeChange(option.value);
                close();
              }}
              className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-10 ${
                selected
                  ? option.value === "research"
                    ? "bg-research-soft text-research-accent hover:bg-research-accent/15"
                    : "bg-muted text-foreground hover:bg-muted/80"
                  : "text-foreground hover:bg-muted/60"
              }`}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background/80 text-current ring-1 ring-border/70">
                <ModeIcon mode={option.value} size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold">
                  {option.label}
                </span>
                <span className="block text-[10px] leading-4 text-muted-foreground">
                  {option.description}
                </span>
              </span>
              {selected ? (
                <Check size={14} className="shrink-0" aria-hidden="true" />
              ) : null}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

export default function AgentCapabilityMenu({
  mode,
  options,
  disabled,
  onModeChange,
  onOpenSettings,
  buttonClassName,
}: AgentCapabilityMenuProps) {
  const t = useTranslations("MessageInput");
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const desktopTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const modeShortcut = useShortcutPresentation("cycleChatMode");
  const activeOption = options.find((option) => option.value === mode);
  const label = t("chatModeAria", {
    mode: activeOption?.label || t("chatModeAuto"),
  });
  const trigger = (triggerRef: React.Ref<HTMLButtonElement>) => (
    <Button
      ref={triggerRef}
      variant="bare"
      type="button"
      aria-label={label}
      aria-keyshortcuts={modeShortcut.ariaKeyShortcuts}
      className={`${buttonClassName} ${
        mode === "research" ? "text-research-accent" : ""
      }`}
      disabled={disabled}
    >
      <ModeIcon mode={mode} />
    </Button>
  );

  return (
    <>
      <div className="hidden md:block">
        <DropdownMenu open={desktopOpen} onOpenChange={setDesktopOpen}>
          <Tooltip
            content={
              <ShortcutTooltipContent
                label={label}
                shortcut={modeShortcut.display}
              />
            }
            position="top"
            portal
          >
            <DropdownMenuTrigger asChild>
              {trigger(desktopTriggerRef)}
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent
            side="top"
            align="end"
            className="w-80 overflow-hidden p-0"
          >
            <ModePanel
              mode={mode}
              options={options}
              onModeChange={onModeChange}
              onOpenSettings={(settingsMode) =>
                onOpenSettings(settingsMode, desktopTriggerRef.current)
              }
              close={() => setDesktopOpen(false)}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="md:hidden" onClick={() => setMobileOpen(true)}>
        <Tooltip
          content={
            <ShortcutTooltipContent
              label={label}
              shortcut={modeShortcut.display}
            />
          }
          position="top"
          portal
        >
          {trigger(mobileTriggerRef)}
        </Tooltip>
      </div>
      <Dialog
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        title={t("chatModeLabel")}
        headerAction={
          <div className="flex items-center gap-1">
            {mode === "agent" || mode === "research" ? (
              <SettingsButton
                label={
                  mode === "research"
                    ? t("researchSettingsOpen")
                    : t("agentSettingsOpen")
                }
                onClick={() => {
                  setMobileOpen(false);
                  onOpenSettings(mode, mobileTriggerRef.current);
                }}
              />
            ) : null}
            <Tooltip content={t("chatModeClose")} position="left" portal>
              <Button
                variant="bare"
                type="button"
                aria-label={t("chatModeClose")}
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={16} aria-hidden="true" />
              </Button>
            </Tooltip>
          </div>
        }
        placement="responsive-sheet"
        closeOnBackdropClick
        className="max-w-md"
      >
        <ModePanel
          mode={mode}
          options={options}
          onModeChange={onModeChange}
          onOpenSettings={(settingsMode) =>
            onOpenSettings(settingsMode, mobileTriggerRef.current)
          }
          close={() => setMobileOpen(false)}
          showHeader={false}
        />
      </Dialog>
    </>
  );
}
