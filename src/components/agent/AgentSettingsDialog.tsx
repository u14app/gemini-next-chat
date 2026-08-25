"use client";

import React, { useId, useState } from "react";
import {
  Archive,
  Check,
  Gauge,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";

import type {
  AgentApprovalMode,
  AgentMemoryScope,
  AgentRunBudget,
} from "@/types";
import {
  AGENT_RUN_BUDGET_PRESETS,
  getAgentRunBudgetPreset,
  type AgentRunBudgetPreset,
} from "@/lib/agent/run";
import { Button, Dialog, IconButton } from "@/components/ui/primitives";
import AgentArtifactWorkspace from "./AgentArtifactDrawer";

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

interface AgentSettingsDialogProps {
  open: boolean;
  sessionId?: string | null;
  summary: AgentCapabilitySummary;
  budgetOverride?: AgentRunBudget;
  onApprovalModeChange: (mode: AgentApprovalMode) => void;
  onBudgetChange: (budget: AgentRunBudget) => void;
  onBudgetReset: () => void;
  onClose: () => void;
}

type SettingsTab = "agent" | "workspace";

const SETTINGS_TABS: SettingsTab[] = ["agent", "workspace"];
const APPROVAL_MODES: AgentApprovalMode[] = [
  "permissive",
  "balanced",
  "strict",
];
const BUDGET_PRESETS: AgentRunBudgetPreset[] = [
  "light",
  "standard",
  "extended",
];

function handleTabKeyDown({
  event,
  index,
  select,
}: {
  event: React.KeyboardEvent<HTMLButtonElement>;
  index: number;
  select: (tab: SettingsTab) => void;
}) {
  let nextIndex = index;
  if (event.key === "ArrowRight") {
    nextIndex = (index + 1) % SETTINGS_TABS.length;
  } else if (event.key === "ArrowLeft") {
    nextIndex = (index - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = SETTINGS_TABS.length - 1;
  } else {
    return;
  }

  event.preventDefault();
  select(SETTINGS_TABS[nextIndex]);
  event.currentTarget.parentElement
    ?.querySelectorAll<HTMLElement>('[role="tab"]')
    [nextIndex]?.focus();
}

export default function AgentSettingsDialog({
  open,
  sessionId,
  summary,
  budgetOverride,
  onApprovalModeChange,
  onBudgetChange,
  onBudgetReset,
  onClose,
}: AgentSettingsDialogProps) {
  const t = useTranslations("MessageInput");
  const [activeTab, setActiveTab] = useState<SettingsTab>("agent");
  const [artifactVisited, setArtifactVisited] = useState(false);
  const [appliedNotice, setAppliedNotice] = useState<string | null>(null);
  const dialogId = useId();
  const selectedPreset = getAgentRunBudgetPreset(budgetOverride);
  const hasCustomBudget = Boolean(budgetOverride && !selectedPreset);

  const selectTab = (tab: SettingsTab) => {
    setActiveTab(tab);
    setAppliedNotice(null);
    if (tab === "workspace") setArtifactVisited(true);
  };

  const handleClose = () => {
    setActiveTab("agent");
    setAppliedNotice(null);
    onClose();
  };

  const capabilityRows = [
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
        ? summary.memoryScopes.join(" / ")
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
    <Dialog
      open={open}
      onClose={handleClose}
      title={t("agentSettingsTitle")}
      headerAction={
        <IconButton
          size="sm"
          label={t("agentSettingsClose")}
          icon={<X size={16} aria-hidden="true" />}
          onClick={handleClose}
        />
      }
      placement="responsive-sheet"
      closeOnBackdropClick
      className="sm:max-w-3xl"
    >
      <div className="flex max-h-[calc(92dvh-3.25rem)] min-h-0 flex-col">
        <div
          className="flex shrink-0 overflow-x-auto border-b border-border px-2 sm:px-4"
          role="tablist"
          aria-label={t("agentSettingsTabsAria")}
        >
          {SETTINGS_TABS.map((tab, index) => (
            <Button
              key={tab}
              variant="bare"
              id={`${dialogId}-${tab}-tab`}
              role="tab"
              tabIndex={activeTab === tab ? 0 : -1}
              aria-selected={activeTab === tab}
              aria-controls={`${dialogId}-${tab}-panel`}
              onClick={() => selectTab(tab)}
              onKeyDown={(event) =>
                handleTabKeyDown({ event, index, select: selectTab })
              }
              className={`inline-flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                activeTab === tab
                  ? "border-blue-500 text-foreground dark:border-blue-400"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "agent" ? (
                <SlidersHorizontal size={15} aria-hidden="true" />
              ) : (
                <Archive size={15} aria-hidden="true" />
              )}
              {t(`agentSettingsTab_${tab}`)}
            </Button>
          ))}
        </div>

        <div
          id={`${dialogId}-agent-panel`}
          role="tabpanel"
          aria-labelledby={`${dialogId}-agent-tab`}
          hidden={activeTab !== "agent"}
          className="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar sm:p-4"
        >
          <div className="space-y-4">
            <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
              <section className="min-w-0 bg-background p-3 sm:p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <ShieldCheck
                        size={15}
                        className="text-blue-500"
                        aria-hidden="true"
                      />
                      {t("agentSecurityTitle")}
                    </h3>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                      {t("agentSecurityDescription")}
                    </p>
                  </div>
                  <span className="max-w-32 shrink-0 truncate rounded-md bg-muted/50 px-1.5 py-1 font-mono text-[10px] text-muted-foreground">
                    {summary.profileId || t("agentCapabilitiesSessionOverride")}
                  </span>
                </div>
                <div
                  className="mt-2.5 grid gap-1.5"
                  role="radiogroup"
                  aria-label={t("agentSecurityTitle")}
                >
                  {APPROVAL_MODES.map((mode) => {
                    const selected = summary.approvalMode === mode;
                    return (
                      <Button
                        key={mode}
                        variant="bare"
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={!sessionId}
                        onClick={() => onApprovalModeChange(mode)}
                        className={`w-full rounded-md border px-2.5 py-2 text-left transition-[border-color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                          selected
                            ? "border-blue-400 bg-blue-50/70 dark:border-blue-700 dark:bg-blue-950/30"
                            : "border-transparent bg-muted/25 hover:bg-muted/55"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-foreground">
                            {t(`agentApproval_${mode}`)}
                          </span>
                          {selected ? (
                            <Check
                              size={14}
                              className="shrink-0 text-blue-600 dark:text-blue-300"
                              aria-hidden="true"
                            />
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                          {t(`agentApprovalDescription_${mode}`)}
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </section>

              <section className="min-w-0 bg-background p-3 sm:p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Gauge
                        size={15}
                        className="text-blue-500"
                        aria-hidden="true"
                      />
                      {t("agentBudgetTitle")}
                    </h3>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                      {t("agentBudgetDescription")}
                    </p>
                  </div>
                  {budgetOverride ? (
                    <Button
                      variant="bare"
                      type="button"
                      onClick={() => {
                        onBudgetReset();
                        setAppliedNotice(t("agentBudgetResetApplied"));
                      }}
                      className="h-7 shrink-0 rounded-md px-2 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                    >
                      {t("agentBudgetReset")}
                    </Button>
                  ) : (
                    <span className="shrink-0 rounded-md bg-muted/50 px-1.5 py-1 text-[10px] font-medium text-muted-foreground">
                      {t("agentBudgetInherited")}
                    </span>
                  )}
                </div>
                <div className="mt-2.5 grid gap-1.5">
                  {BUDGET_PRESETS.map((preset) => {
                    const budget = AGENT_RUN_BUDGET_PRESETS[preset];
                    const selected = selectedPreset === preset;
                    return (
                      <Button
                        key={preset}
                        variant="bare"
                        type="button"
                        aria-pressed={selected}
                        disabled={!sessionId}
                        onClick={() => onBudgetChange({ ...budget })}
                        className={`w-full rounded-md border px-2.5 py-2 text-left transition-[border-color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                          selected
                            ? "border-blue-400 bg-blue-50/70 dark:border-blue-700 dark:bg-blue-950/30"
                            : "border-transparent bg-muted/25 hover:bg-muted/55"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-foreground">
                            {t(`agentBudget_${preset}`)}
                          </span>
                          {selected ? (
                            <Check
                              size={14}
                              className="shrink-0 text-blue-600 dark:text-blue-300"
                              aria-hidden="true"
                            />
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                          {t("agentBudgetValues", {
                            rounds: budget.maxToolRounds,
                            calls: budget.maxToolCalls,
                            minutes: Math.round(
                              (budget.maxDurationMs || 0) / 60_000,
                            ),
                          })}
                        </span>
                      </Button>
                    );
                  })}
                </div>
                {hasCustomBudget ? (
                  <p className="mt-2 text-[11px] leading-4 text-amber-700 dark:text-amber-300">
                    {t("agentBudgetCustom")}
                  </p>
                ) : null}
              </section>
            </div>

            {appliedNotice ? (
              <p
                className="text-xs font-medium text-emerald-700 dark:text-emerald-300"
                role="status"
                aria-live="polite"
              >
                {appliedNotice}
              </p>
            ) : null}

            <section className="space-y-2 border-t border-border pt-4">
              <div>
                <h3 className="text-xs font-semibold text-foreground">
                  {t("agentCapabilitiesTitle")}
                </h3>
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                  {t("agentCapabilitiesReadOnly")}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
                {capabilityRows.map(({ label, value, detail }) => (
                  <div
                    key={label}
                    className="min-w-0 bg-background px-2.5 py-2"
                  >
                    <dt className="text-[10px] font-medium text-muted-foreground">
                      {label}
                    </dt>
                    <dd
                      className="mt-0.5 truncate text-xs text-foreground"
                      title={detail || value}
                    >
                      {value || t("agentCapabilitiesNone")}
                    </dd>
                  </div>
                ))}
              </dl>
              {!summary.workspaceAvailable ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  {t("agentCapabilitiesWorkspaceUnavailable")}
                </p>
              ) : null}
            </section>
          </div>
        </div>

        <div
          id={`${dialogId}-workspace-panel`}
          role="tabpanel"
          aria-labelledby={`${dialogId}-workspace-tab`}
          hidden={activeTab !== "workspace"}
          className="min-h-0 flex-1"
        >
          {artifactVisited ? (
            <AgentArtifactWorkspace
              key={sessionId || "no-session"}
              active={activeTab === "workspace"}
              sessionId={sessionId}
            />
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
