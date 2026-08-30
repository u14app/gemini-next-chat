"use client";

import React, { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils/cn";

import ResearchDisclosure from "../ResearchDisclosure";
import type { ResearchNodeView, ResearchWaveView } from "../types";

import { RunStatusIcon } from "./primitives";

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

export function WaveGroup({
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
