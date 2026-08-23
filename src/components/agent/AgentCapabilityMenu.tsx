"use client";

import React, { useState } from "react";
import { Archive, Bot, Check, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import type { AgentApprovalMode, AgentMemoryScope } from "@/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button, Dialog } from "@/components/ui/primitives";

export interface AgentCapabilitySummary {
  profileId?: string;
  approvalMode: AgentApprovalMode;
  searchEnabled: boolean;
  registeredToolNames: string[];
  discoverableToolCount: number;
  pluginNames: string[];
  automaticSkillNames: string[];
  manualSkillNames: string[];
  memoryScopes: AgentMemoryScope[];
  knowledgeCount: number;
  workspaceAvailable: boolean;
}

interface AgentCapabilityMenuProps {
  enabled: boolean;
  supported: boolean;
  disabled?: boolean;
  summary: AgentCapabilitySummary;
  onToggle: () => void;
  onOpenArtifacts: () => void;
  buttonClassName: string;
}

function CapabilityPanel({
  enabled,
  supported,
  summary,
  onToggle,
  onOpenArtifacts,
  close,
}: Omit<AgentCapabilityMenuProps, "disabled" | "buttonClassName"> & {
  close: () => void;
}) {
  const t = useTranslations("MessageInput");
  const rows = [
    {
      label: t("agentCapabilitiesTools"),
      value: t("agentCapabilitiesToolCount", {
        registered: summary.registeredToolNames.length,
        discoverable: summary.discoverableToolCount,
      }),
      detail: summary.registeredToolNames.join(", "),
    },
    {
      label: t("agentCapabilitiesPlugins"),
      value: String(summary.pluginNames.length),
      detail: summary.pluginNames.join(", "),
    },
    {
      label: t("agentCapabilitiesSkills"),
      value: t("agentCapabilitiesSkillCount", {
        automatic: summary.automaticSkillNames.length,
        manual: summary.manualSkillNames.length,
      }),
      detail: [
        ...summary.automaticSkillNames,
        ...summary.manualSkillNames,
      ].join(", "),
    },
    {
      label: t("agentCapabilitiesMemory"),
      value: summary.memoryScopes.length
        ? summary.memoryScopes.join(" · ")
        : t("agentCapabilitiesNone"),
      detail: "",
    },
    {
      label: t("agentCapabilitiesKnowledge"),
      value: String(summary.knowledgeCount),
      detail: "",
    },
    {
      label: t("agentCapabilitiesSearch"),
      value: summary.searchEnabled
        ? t("agentCapabilitiesAvailable")
        : t("agentCapabilitiesOff"),
      detail: "",
    },
  ];

  return (
    <div className="w-full">
      <div className="border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Bot
              size={15}
              className="shrink-0 text-blue-500"
              aria-hidden="true"
            />
            <span className="shrink-0 text-xs font-semibold text-foreground">
              {t("agentCapabilitiesTitle")}
            </span>
            <span className="truncate font-mono text-[10px] text-muted-foreground">
              {summary.profileId || t("agentCapabilitiesSessionOverride")}
            </span>
          </div>
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] font-medium text-muted-foreground">
            <ShieldCheck size={12} aria-hidden="true" />
            {t(`agentApproval_${summary.approvalMode}`)}
          </span>
        </div>
      </div>

      <div className="space-y-1 p-2">
        <Button
          variant="bare"
          type="button"
          disabled={!supported}
          aria-pressed={enabled}
          onClick={onToggle}
          className="flex min-h-11 w-full items-center justify-between rounded-lg border border-border bg-background px-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 md:min-h-9"
        >
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-foreground">
              {enabled
                ? t("agentCapabilitiesEnabled")
                : t("agentCapabilitiesDisabled")}
            </span>
            <span className="block text-[10px] text-muted-foreground">
              {supported
                ? t("agentCapabilitiesForegroundOnly")
                : t("agentModeUnavailable")}
            </span>
          </span>
          <span
            aria-hidden="true"
            className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors motion-reduce:transition-none ${enabled ? "bg-blue-500" : "bg-muted-foreground/30"}`}
          >
            <span
              className={`flex size-4 items-center justify-center rounded-full bg-white text-blue-600 shadow-sm transition-transform motion-reduce:transition-none ${enabled ? "translate-x-4" : "translate-x-0"}`}
            >
              {enabled ? <Check size={11} aria-hidden="true" /> : null}
            </span>
          </span>
        </Button>

        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
          {rows.map(({ label, value, detail }) => (
            <div key={label} className="min-w-0 bg-background px-3 py-2">
              <dt className="block truncate text-[10px] font-medium text-muted-foreground">
                {label}
              </dt>
              <dd
                className="block truncate text-xs text-foreground"
                title={detail || value}
              >
                {value || t("agentCapabilitiesNone")}
              </dd>
            </div>
          ))}
        </dl>

        <Button
          variant="bare"
          type="button"
          onClick={() => {
            close();
            onOpenArtifacts();
          }}
          disabled={!summary.workspaceAvailable}
          className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 md:min-h-9"
        >
          <span className="inline-flex items-center gap-2">
            <Archive size={14} aria-hidden="true" />
            {t("agentCapabilitiesOpenArtifacts")}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {summary.workspaceAvailable
              ? t("agentCapabilitiesArtifactsHint")
              : t("agentCapabilitiesWorkspaceUnavailable")}
          </span>
        </Button>
      </div>
    </div>
  );
}

export default function AgentCapabilityMenu({
  enabled,
  supported,
  disabled,
  summary,
  onToggle,
  onOpenArtifacts,
  buttonClassName,
}: AgentCapabilityMenuProps) {
  const t = useTranslations("MessageInput");
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const label = supported
    ? t("agentCapabilitiesButton")
    : t("agentModeUnavailable");
  const trigger = (
    <Button
      variant="bare"
      type="button"
      aria-label={label}
      aria-pressed={supported ? enabled : undefined}
      aria-disabled={!supported ? true : undefined}
      className={`${buttonClassName} max-md:h-11 max-md:w-11`}
      disabled={disabled}
    >
      <Bot size={16} aria-hidden="true" />
    </Button>
  );

  return (
    <>
      <div className="hidden md:block">
        <DropdownMenu open={desktopOpen} onOpenChange={setDesktopOpen}>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            className="w-80 overflow-hidden p-0"
          >
            <CapabilityPanel
              enabled={enabled}
              supported={supported}
              summary={summary}
              onToggle={onToggle}
              onOpenArtifacts={onOpenArtifacts}
              close={() => setDesktopOpen(false)}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="md:hidden" onClick={() => setMobileOpen(true)}>
        {trigger}
      </div>
      <Dialog
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        title={t("agentCapabilitiesTitle")}
        placement="responsive-sheet"
        className="max-w-md"
      >
        <CapabilityPanel
          enabled={enabled}
          supported={supported}
          summary={summary}
          onToggle={onToggle}
          onOpenArtifacts={onOpenArtifacts}
          close={() => setMobileOpen(false)}
        />
      </Dialog>
    </>
  );
}
