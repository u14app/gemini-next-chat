"use client";

import React, { useEffect, useId, useState } from "react";
import { Archive, Check, Gauge, SlidersHorizontal, X } from "lucide-react";
import { useTranslations } from "next-intl";

import AgentArtifactWorkspace from "@/components/agent/AgentArtifactDrawer";
import { Button, Dialog, IconButton } from "@/components/ui/primitives";
import {
  RESEARCH_BUDGET_PRESETS,
  RESEARCH_STRATEGY_LIMITS,
  RESEARCH_STRATEGY_PRESETS,
  resolveResearchStrategy,
  type ResearchBudgetPreset,
  type ResearchStrategy,
} from "@/lib/research";

interface ResearchSettingsDialogProps {
  open: boolean;
  sessionId?: string | null;
  budgetPreset: ResearchBudgetPreset;
  strategy: ResearchStrategy;
  onChange: (
    budgetPreset: ResearchBudgetPreset,
    strategy: ResearchStrategy,
  ) => void;
  onClose: () => void;
}

type SettingsTab = "research" | "workspace";
type StrategyKey = keyof ResearchStrategy;

const SETTINGS_TABS: SettingsTab[] = ["research", "workspace"];
const BUDGET_PRESETS: ResearchBudgetPreset[] = ["quick", "standard", "deep"];
const STRATEGY_FIELDS: StrategyKey[] = [
  "initialBreadth",
  "maxDepth",
  "maxQueries",
  "resultsPerQuery",
];

function strategyDraft(
  strategy: ResearchStrategy,
): Record<StrategyKey, string> {
  return {
    initialBreadth: String(strategy.initialBreadth),
    maxDepth: String(strategy.maxDepth),
    maxQueries: String(strategy.maxQueries),
    resultsPerQuery: String(strategy.resultsPerQuery),
  };
}

function strategiesMatch(
  left: ResearchStrategy,
  right: ResearchStrategy,
): boolean {
  return STRATEGY_FIELDS.every((key) => left[key] === right[key]);
}

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

export default function ResearchSettingsDialog({
  open,
  sessionId,
  budgetPreset,
  strategy,
  onChange,
  onClose,
}: ResearchSettingsDialogProps) {
  const t = useTranslations("Research");
  const [activeTab, setActiveTab] = useState<SettingsTab>("research");
  const [artifactVisited, setArtifactVisited] = useState(false);
  const [draft, setDraft] = useState(() => strategyDraft(strategy));
  const dialogId = useId();
  const presetStrategy = RESEARCH_STRATEGY_PRESETS[budgetPreset];
  const customStrategy = !strategiesMatch(strategy, presetStrategy);

  useEffect(() => {
    if (open) setDraft(strategyDraft(strategy));
  }, [open, strategy]);

  const selectTab = (tab: SettingsTab) => {
    setActiveTab(tab);
    if (tab === "workspace") setArtifactVisited(true);
  };

  const handleClose = () => {
    setActiveTab("research");
    onClose();
  };

  const selectPreset = (preset: ResearchBudgetPreset) => {
    const next = { ...RESEARCH_STRATEGY_PRESETS[preset] };
    setDraft(strategyDraft(next));
    onChange(preset, next);
  };

  const commitField = (key: StrategyKey) => {
    const next = resolveResearchStrategy(budgetPreset, {
      ...strategy,
      [key]: Number(draft[key]),
    });
    setDraft(strategyDraft(next));
    if (!strategiesMatch(next, strategy)) onChange(budgetPreset, next);
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={t("settings.title")}
      headerAction={
        <IconButton
          size="sm"
          label={t("settings.close")}
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
          aria-label={t("settings.tabsAria")}
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
              className={`inline-flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-research-accent/50 ${
                activeTab === tab
                  ? "border-research-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "research" ? (
                <SlidersHorizontal size={15} aria-hidden="true" />
              ) : (
                <Archive size={15} aria-hidden="true" />
              )}
              {t(`settings.tab_${tab}`)}
            </Button>
          ))}
        </div>

        <div
          id={`${dialogId}-research-panel`}
          role="tabpanel"
          aria-labelledby={`${dialogId}-research-tab`}
          hidden={activeTab !== "research"}
          className="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar sm:p-4"
        >
          <div className="space-y-4">
            <p className="text-xs leading-5 text-muted-foreground">
              {t("settings.futureTasksOnly")}
            </p>

            <section className="rounded-lg border border-border p-3 sm:p-3.5">
              <div className="flex items-start gap-2">
                <Gauge
                  size={15}
                  className="mt-0.5 shrink-0 text-research-accent"
                  aria-hidden="true"
                />
                <div>
                  <h3 className="text-xs font-semibold text-foreground">
                    {t("settings.budgetTitle")}
                  </h3>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    {t("settings.budgetDescription")}
                  </p>
                </div>
              </div>
              <div
                className="mt-3 grid gap-1.5 sm:grid-cols-3"
                role="radiogroup"
                aria-label={t("settings.budgetTitle")}
              >
                {BUDGET_PRESETS.map((preset) => {
                  const selected = preset === budgetPreset;
                  const budget = RESEARCH_BUDGET_PRESETS[preset];
                  return (
                    <Button
                      key={preset}
                      variant="bare"
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={!sessionId}
                      onClick={() => selectPreset(preset)}
                      className={`rounded-md border px-2.5 py-2 text-left transition-[border-color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-research-accent/50 ${
                        selected
                          ? "border-research-accent/60 bg-research-soft"
                          : "border-transparent bg-muted/25 hover:bg-muted/55"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-foreground">
                          {t(`budget.${preset}`)}
                        </span>
                        {selected ? (
                          <Check
                            size={14}
                            className="shrink-0 text-research-accent"
                            aria-hidden="true"
                          />
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                        {t("settings.budgetValues", {
                          rounds: budget.maxToolRounds,
                          calls: budget.maxToolCalls,
                          minutes: Math.round(budget.maxDurationMs / 60_000),
                        })}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-lg border border-border p-3 sm:p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xs font-semibold text-foreground">
                    {t("settings.strategyTitle")}
                  </h3>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    {t("settings.strategyDescription")}
                  </p>
                </div>
                {customStrategy ? (
                  <Button
                    variant="bare"
                    type="button"
                    onClick={() => selectPreset(budgetPreset)}
                    className="h-7 shrink-0 rounded-md px-2 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-research-accent/50"
                  >
                    {t("settings.resetStrategy")}
                  </Button>
                ) : null}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {STRATEGY_FIELDS.map((key) => {
                  const limits = RESEARCH_STRATEGY_LIMITS[key];
                  return (
                    <label key={key} className="grid gap-1">
                      <span className="text-[10px] font-medium text-muted-foreground">
                        {t(`strategyAdjust.${key}`)}
                      </span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={limits.min}
                        max={limits.max}
                        value={draft[key]}
                        disabled={!sessionId}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                        onBlur={() => commitField(key)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                        className="h-9 min-w-0 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground outline-none transition-colors focus:border-research-accent focus:ring-2 focus:ring-research-accent/20 disabled:opacity-50"
                      />
                    </label>
                  );
                })}
              </div>
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
