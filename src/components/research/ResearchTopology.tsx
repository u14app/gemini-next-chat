"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Circle,
  GitBranch,
  LoaderCircle,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { InlineStatus } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";

import ResearchDisclosure from "./ResearchDisclosure";
import type {
  ResearchNodeView,
  ResearchPlanView,
  ResearchRunItemStatusView,
  ResearchRunView,
  ResearchStopReasonView,
  ResearchTaskViewModel,
  ResearchWaveView,
} from "./types";

function StopReasonText({ reason }: { reason: ResearchStopReasonView }) {
  const t = useTranslations("Research");
  return (
    <>
      {t.has(`run.stop.${reason.code}`)
        ? t(`run.stop.${reason.code}`)
        : reason.code}
      {reason.detail ? `: ${reason.detail}` : ""}
    </>
  );
}

function RunStatusIcon({ status }: { status: ResearchRunItemStatusView }) {
  if (status === "completed") {
    return (
      <CheckCircle2
        size={15}
        className="text-emerald-600 dark:text-emerald-400"
        aria-hidden="true"
      />
    );
  }
  if (status === "in_progress") {
    return (
      <LoaderCircle
        size={15}
        className="animate-spin text-research-accent motion-reduce:animate-none"
        aria-hidden="true"
      />
    );
  }
  if (status === "blocked" || status === "failed") {
    return (
      <AlertTriangle
        size={15}
        className={cn(
          status === "failed"
            ? "text-red-600 dark:text-red-400"
            : "text-amber-600 dark:text-amber-400",
        )}
        aria-hidden="true"
      />
    );
  }
  return <Circle size={14} className="text-muted-foreground" aria-hidden />;
}

function PlanList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1.5 text-xs leading-5 text-foreground/80">
      {items.map((item) => (
        <li key={item} className="border-l border-border pl-2.5">
          {item}
        </li>
      ))}
    </ul>
  );
}

export function ResearchPlanContract({
  plan,
  compact = false,
  advancedOnly = false,
}: {
  plan: ResearchPlanView;
  compact?: boolean;
  advancedOnly?: boolean;
}) {
  const t = useTranslations("Research");
  const [reconOpen, setReconOpen] = useState(false);
  const recon = plan.recon;
  const hasScope = Boolean(
    plan.scope &&
    (plan.scope.audience ||
      plan.scope.timeRange ||
      plan.scope.allowedSourceTypes?.length ||
      plan.scope.includes.length ||
      plan.scope.excludes.length),
  );
  const hasPlanContract = advancedOnly
    ? Boolean(
        plan.assumptions?.length ||
        plan.deliverable ||
        plan.strategy ||
        plan.completionCriteria?.length,
      )
    : Boolean(
        plan.objective ||
        hasScope ||
        plan.assumptions?.length ||
        plan.deliverable ||
        plan.strategy ||
        plan.completionCriteria?.length,
      );

  if (!hasPlanContract && !plan.recon) return null;

  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      {plan.strategy || plan.deliverable ? (
        <dl
          className={cn(
            "grid gap-px overflow-hidden rounded-lg border border-research-border bg-research-border",
            compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4",
          )}
        >
          {plan.deliverable ? (
            <div className="bg-background px-3 py-2.5">
              <dt className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                {t("plan.deliverable")}
              </dt>
              <dd className="mt-1 text-xs font-medium text-foreground">
                {t(`deliverable.${plan.deliverable.kind}`)}
              </dd>
              {!compact && plan.deliverable.description ? (
                <dd className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  {plan.deliverable.description}
                </dd>
              ) : null}
            </div>
          ) : null}
          {plan.strategy ? (
            <>
              <div className="bg-background px-3 py-2.5">
                <dt className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  {t("plan.initialBreadth")}
                </dt>
                <dd className="mt-1 font-mono text-xs font-medium tabular-nums text-foreground">
                  {plan.strategy.initialBreadth}
                </dd>
              </div>
              <div className="bg-background px-3 py-2.5">
                <dt className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  {t("plan.maxDepth")}
                </dt>
                <dd className="mt-1 font-mono text-xs font-medium tabular-nums text-foreground">
                  {plan.strategy.maxDepth}
                </dd>
              </div>
              <div className="bg-background px-3 py-2.5">
                <dt className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  {t("plan.queryLimit")}
                </dt>
                <dd className="mt-1 font-mono text-xs font-medium tabular-nums text-foreground">
                  {plan.strategy.queryLimit}
                </dd>
              </div>
            </>
          ) : null}
        </dl>
      ) : null}

      {!compact && !advancedOnly && plan.objective ? (
        <section>
          <h4 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {t("plan.objective")}
          </h4>
          <p className="mt-1.5 text-sm leading-6 text-foreground/90">
            {plan.objective}
          </p>
        </section>
      ) : null}

      {!compact && !advancedOnly && hasScope && plan.scope ? (
        <section>
          <h4 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {t("plan.scope")}
          </h4>
          <dl className="mt-2 grid gap-3 text-xs sm:grid-cols-2">
            {plan.scope.audience ? (
              <div>
                <dt className="text-muted-foreground">{t("plan.audience")}</dt>
                <dd className="mt-1 leading-5 text-foreground">
                  {plan.scope.audience}
                </dd>
              </div>
            ) : null}
            {plan.scope.timeRange ? (
              <div>
                <dt className="text-muted-foreground">{t("plan.timeRange")}</dt>
                <dd className="mt-1 leading-5 text-foreground">
                  {plan.scope.timeRange}
                </dd>
              </div>
            ) : null}
            {plan.scope.allowedSourceTypes?.length ? (
              <div>
                <dt className="text-muted-foreground">
                  {t("plan.allowedSources")}
                </dt>
                <dd className="mt-1 leading-5 text-foreground">
                  {plan.scope.allowedSourceTypes
                    .map((sourceType) => t(`sourceType.${sourceType}`))
                    .join(", ")}
                </dd>
              </div>
            ) : null}
            {plan.scope.includes.length ? (
              <div>
                <dt className="text-muted-foreground">{t("plan.includes")}</dt>
                <dd>
                  <PlanList items={plan.scope.includes} />
                </dd>
              </div>
            ) : null}
            {plan.scope.excludes.length ? (
              <div>
                <dt className="text-muted-foreground">{t("plan.excludes")}</dt>
                <dd>
                  <PlanList items={plan.scope.excludes} />
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      {!compact && plan.strategy ? (
        <section>
          <h4 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {t("plan.strategy")}
          </h4>
          <dl className="mt-2 grid grid-cols-2 gap-x-5 gap-y-2 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">
                {t("plan.resultsPerQuery")}
              </dt>
              <dd className="mt-0.5 font-mono tabular-nums text-foreground">
                {plan.strategy.resultsPerQuery}
              </dd>
            </div>
            {plan.strategy.reservedValidationQueries !== undefined ? (
              <div>
                <dt className="text-muted-foreground">
                  {t("plan.validationReserve")}
                </dt>
                <dd className="mt-0.5 font-mono tabular-nums text-foreground">
                  {plan.strategy.reservedValidationQueries}
                </dd>
              </div>
            ) : null}
            {plan.strategy.sourceContentLimit !== undefined ? (
              <div>
                <dt className="text-muted-foreground">
                  {t("plan.sourceLimit")}
                </dt>
                <dd className="mt-0.5 font-mono tabular-nums text-foreground">
                  {plan.strategy.sourceContentLimit}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      {!compact && plan.assumptions?.length ? (
        <section>
          <h4 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {t("plan.assumptions")}
          </h4>
          <PlanList items={plan.assumptions} />
        </section>
      ) : null}

      {!compact && plan.completionCriteria?.length ? (
        <section>
          <h4 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {t("plan.completionCriteria")}
          </h4>
          <PlanList items={plan.completionCriteria} />
        </section>
      ) : null}

      {recon ? (
        <ResearchDisclosure
          open={reconOpen}
          onOpenChange={setReconOpen}
          className="border-t border-border pt-3"
          triggerClassName="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm text-left text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          summary={(isOpen) => (
            <>
              <Search
                size={14}
                className="text-research-accent"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                {t("plan.reconSummary", {
                  used: recon.queryCount,
                  limit: recon.maxQueries,
                })}
              </span>
              <ChevronDown
                size={14}
                className={cn(
                  "transition-transform duration-200 ease-out motion-reduce:transition-none",
                  isOpen && "rotate-180",
                )}
                aria-hidden="true"
              />
            </>
          )}
        >
          <div className="mt-2 rounded-md border border-border p-3">
            <InlineStatus
              tone={recon.status === "completed" ? "neutral" : "warning"}
            >
              {t("plan.reconDisclosure")}
            </InlineStatus>
            {recon.status !== "completed" ? (
              <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
                {t(`plan.reconStatus.${recon.status}`)}
              </p>
            ) : null}
            {recon.queries.length ? (
              <ol className="mt-3 space-y-2">
                {recon.queries.map((item, index) => (
                  <li
                    key={item.id}
                    className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 text-xs"
                  >
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <p className="wrap-break-word font-medium text-foreground">
                        {item.query}
                      </p>
                      <p className="mt-0.5 wrap-break-word leading-5 text-muted-foreground">
                        {t("plan.reconResult", {
                          count: item.resultCount,
                          domains: item.domains.length
                            ? item.domains.join(", ")
                            : t("plan.noDomains"),
                        })}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        </ResearchDisclosure>
      ) : null}
    </div>
  );
}

export function ResearchRunRail({ run }: { run: ResearchRunView }) {
  const t = useTranslations("Research");
  return (
    <section
      className="border-b border-research-border bg-research-soft/70 px-4 py-3"
      aria-label={t("run.statusRail")}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-research-accent-text">
          <GitBranch size={14} aria-hidden="true" />
          <span>{t(`run.phase.${run.phase}`)}</span>
        </div>
        <dl className="flex flex-1 flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
          <div className="inline-flex gap-1.5">
            <dt>{t("metrics.wave")}</dt>
            <dd className="font-mono tabular-nums text-foreground">
              {run.currentWave ?? 0}/{run.waves.length}
            </dd>
          </div>
          <div className="inline-flex gap-1.5">
            <dt>{t("metrics.queries")}</dt>
            <dd className="font-mono tabular-nums text-foreground">
              {run.queryUsage.used}/{run.queryUsage.limit}
            </dd>
          </div>
          <div className="inline-flex gap-1.5">
            <dt>{t("metrics.verifiedClaims")}</dt>
            <dd className="font-mono tabular-nums text-foreground">
              {run.claimCounts.verified}/{run.claimCounts.total}
            </dd>
          </div>
          <div className="inline-flex gap-1.5">
            <dt>{t("metrics.depth")}</dt>
            <dd className="font-mono tabular-nums text-foreground">
              {run.currentDepth}/{run.maxDepth}
            </dd>
          </div>
        </dl>
        {run.stopReason ? (
          <p className="w-full text-xs leading-5 text-amber-700 dark:text-amber-300">
            <span className="font-medium">{t("run.stopReason")}: </span>
            <StopReasonText reason={run.stopReason} />
          </p>
        ) : null}
      </div>
    </section>
  );
}

function NodeInspector({
  node,
  parent,
  evidenceTitles,
}: {
  node: ResearchNodeView | undefined;
  parent: ResearchNodeView | undefined;
  evidenceTitles: string[];
}) {
  const t = useTranslations("Research");
  if (!node) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center">
        <GitBranch size={24} className="text-muted-foreground" aria-hidden />
        <p className="mt-3 text-sm font-medium text-foreground">
          {t("run.selectNode")}
        </p>
      </div>
    );
  }

  return (
    <article
      className="min-w-0 p-4 sm:p-5"
      aria-labelledby={`research-node-inspector-${node.id}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30">
          <RunStatusIcon status={node.status} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {t("run.nodeDepth", { depth: node.depth })}
          </p>
          <h3
            id={`research-node-inspector-${node.id}`}
            className="mt-1 wrap-break-word text-sm font-semibold leading-5 text-foreground"
          >
            {node.objective}
          </h3>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border text-xs">
        <div className="bg-background px-3 py-2.5">
          <dt className="text-muted-foreground">{t("metrics.evidence")}</dt>
          <dd className="mt-1 font-mono tabular-nums text-foreground">
            {node.evidenceIds.length}
          </dd>
        </div>
        <div className="bg-background px-3 py-2.5">
          <dt className="text-muted-foreground">
            {t("metrics.verifiedClaims")}
          </dt>
          <dd className="mt-1 font-mono tabular-nums text-foreground">
            {node.verifiedClaimCount}/{node.claimIds.length}
          </dd>
        </div>
      </dl>

      {node.query ? (
        <section className="mt-5">
          <h4 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {t("run.query")}
          </h4>
          <p className="mt-1.5 wrap-break-word font-mono text-xs leading-5 text-foreground/90">
            {node.query}
          </p>
        </section>
      ) : null}

      {parent ? (
        <section className="mt-5">
          <h4 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {t("run.parentNode")}
          </h4>
          <p className="mt-1.5 text-xs leading-5 text-foreground/80">
            {parent.objective}
          </p>
        </section>
      ) : null}

      {node.learnings.length ? (
        <section className="mt-5">
          <h4 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {t("run.learnings")}
          </h4>
          <PlanList items={node.learnings} />
        </section>
      ) : null}

      {node.followUps.length ? (
        <section className="mt-5">
          <h4 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {t("run.followUps")}
          </h4>
          <PlanList items={node.followUps} />
        </section>
      ) : null}

      {evidenceTitles.length ? (
        <section className="mt-5">
          <h4 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {t("run.linkedEvidence")}
          </h4>
          <PlanList items={evidenceTitles} />
        </section>
      ) : null}

      {node.scopeImpact && node.scopeImpact !== "within" ? (
        <InlineStatus tone="warning" className="mt-5">
          {t("run.scopeApproval")}
        </InlineStatus>
      ) : null}
      {node.stopReason ? (
        <p className="mt-5 text-xs leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">
            {t("run.stopReason")}:{" "}
          </span>
          <StopReasonText reason={node.stopReason} />
        </p>
      ) : null}
    </article>
  );
}

function TopologyNode({
  node,
  index,
  selected,
  onSelect,
}: {
  node: ResearchNodeView;
  index: number;
  selected: boolean;
  onSelect: (nodeId: string) => void;
}) {
  const t = useTranslations("Research");
  const defaultOpen = node.status === "in_progress";
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  return (
    <li className="relative border-l border-border pl-4 before:absolute before:top-[1.35rem] before:left-0 before:w-3 before:border-t before:border-border last:pb-0">
      <ResearchDisclosure
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) onSelect(node.id);
        }}
        ariaCurrent={selected ? "true" : undefined}
        triggerClassName={cn(
          "flex min-h-11 w-full cursor-pointer items-start gap-2 rounded-md border border-transparent px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected && "border-research-border bg-research-soft",
        )}
        summary={(isOpen) => (
          <>
            <span className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
              {String(index + 1).padStart(2, "0")}
            </span>
            <RunStatusIcon status={node.status} />
            <span className="min-w-0 flex-1 wrap-break-word text-xs font-medium leading-5 text-foreground">
              {node.objective}
            </span>
            <ChevronDown
              size={13}
              className={cn(
                "mt-0.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none",
                isOpen && "rotate-180",
              )}
              aria-hidden
            />
          </>
        )}
      >
        <div className="pb-3 pl-9 pr-2 text-[11px] leading-5 text-muted-foreground">
          {node.query ? (
            <p className="wrap-break-word font-mono">{node.query}</p>
          ) : (
            <p>{t("run.queryPending")}</p>
          )}
          <p className="mt-1 font-mono tabular-nums">
            {t("run.nodeSummary", {
              sources: node.evidenceIds.length,
              claims: node.verifiedClaimCount,
            })}
          </p>
        </div>
      </ResearchDisclosure>
    </li>
  );
}

function WaveGroup({
  wave,
  nodes,
  selectedNodeId,
  onSelectNode,
}: {
  wave: ResearchWaveView;
  nodes: ResearchNodeView[];
  selectedNodeId?: string;
  onSelectNode: (nodeId: string) => void;
}) {
  const t = useTranslations("Research");
  const defaultOpen =
    wave.status === "in_progress" || wave.status === "completed";
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  return (
    <li>
      <ResearchDisclosure
        open={open}
        onOpenChange={setOpen}
        triggerClassName="flex min-h-12 w-full cursor-pointer items-center gap-3 border-b border-border px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        summary={(isOpen) => (
          <>
            <RunStatusIcon status={wave.status} />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-foreground">
                {t("run.wave", { wave: wave.index })}
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {t("run.waveSummary", {
                  queries: wave.queryCount,
                  sources: wave.sourceCount,
                  claims: wave.verifiedClaimCount,
                })}
              </span>
            </span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {t("run.nodeDepth", { depth: wave.depth })}
            </span>
            <ChevronDown
              size={14}
              className={cn(
                "transition-transform duration-200 ease-out motion-reduce:transition-none",
                isOpen && "rotate-180",
              )}
              aria-hidden
            />
          </>
        )}
      >
        <ol className="border-b border-border bg-muted/10 px-3 py-2">
          {nodes.map((node, index) => (
            <TopologyNode
              key={node.id}
              node={node}
              index={index}
              selected={selectedNodeId === node.id}
              onSelect={onSelectNode}
            />
          ))}
        </ol>
      </ResearchDisclosure>
    </li>
  );
}

export function ResearchTopology({ task }: { task: ResearchTaskViewModel }) {
  const t = useTranslations("Research");
  const run = task.run;
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(
    () =>
      run?.nodes.find((node) => node.status === "in_progress")?.id ??
      run?.nodes[0]?.id,
  );

  useEffect(() => {
    setSelectedNodeId((current) => {
      if (current && run?.nodes.some((node) => node.id === current)) {
        return current;
      }
      return (
        run?.nodes.find((node) => node.status === "in_progress")?.id ??
        run?.nodes[0]?.id
      );
    });
  }, [run?.id, run?.nodes]);

  const topology = useMemo(() => {
    const nodeById = new Map(
      (run?.nodes ?? []).map((node) => [node.id, node] as const),
    );
    const nodesByWave = new Map<string, ResearchNodeView[]>();
    for (const node of run?.nodes ?? []) {
      const waveNodes = nodesByWave.get(node.waveId) ?? [];
      waveNodes.push(node);
      nodesByWave.set(node.waveId, waveNodes);
    }
    const evidenceTitleById = new Map(
      task.evidence.map((item) => [item.id, item.title] as const),
    );
    return { nodeById, nodesByWave, evidenceTitleById };
  }, [run?.nodes, task.evidence]);

  if (!run || run.waves.length === 0 || run.nodes.length === 0) return null;

  const selectedNode = selectedNodeId
    ? topology.nodeById.get(selectedNodeId)
    : undefined;
  const selectedParent = selectedNode?.parentId
    ? topology.nodeById.get(selectedNode.parentId)
    : undefined;
  const selectedEvidenceTitles = (selectedNode?.evidenceIds ?? []).flatMap(
    (id) => {
      const title = topology.evidenceTitleById.get(id);
      return title ? [title] : [];
    },
  );

  return (
    <section aria-labelledby={`research-topology-${task.id}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.16em] text-research-accent-text uppercase">
            {t(`run.phase.${run.phase}`)}
          </p>
          <h2
            id={`research-topology-${task.id}`}
            className="mt-1 text-lg font-semibold tracking-tight text-foreground"
          >
            {t("run.topology")}
          </h2>
        </div>
        <p className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {t("run.waveCount", { count: run.waves.length })}
        </p>
      </div>
      <div className="grid overflow-hidden rounded-lg border border-border bg-background lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <div className="min-w-0 lg:border-r lg:border-border">
          <ol className="divide-y divide-border" aria-label={t("run.waves")}>
            {run.waves.map((wave) => (
              <WaveGroup
                key={wave.id}
                wave={wave}
                nodes={topology.nodesByWave.get(wave.id) ?? []}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
              />
            ))}
          </ol>
        </div>
        <aside
          className="min-w-0 border-t border-border bg-muted/10 lg:border-t-0"
          aria-label={t("run.inspector")}
        >
          <NodeInspector
            node={selectedNode}
            parent={selectedParent}
            evidenceTitles={selectedEvidenceTitles}
          />
        </aside>
      </div>
    </section>
  );
}

export function ResearchClaimNotice({ run }: { run: ResearchRunView }) {
  const t = useTranslations("Research");
  if (run.claimCounts.unresolved === 0 && run.claimCounts.conflicting === 0) {
    return null;
  }
  return (
    <InlineStatus tone="warning">
      <ShieldCheck size={15} aria-hidden="true" />
      {t("run.claimWarning", {
        conflicts: run.claimCounts.conflicting,
        unresolved: run.claimCounts.unresolved,
      })}
    </InlineStatus>
  );
}
