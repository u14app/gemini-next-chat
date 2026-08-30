"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import type { ResearchNodeView, ResearchTaskViewModel } from "../types";

import { NodeInspector } from "./NodeInspector";
import { WaveGroup } from "./TopologyNode";

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
