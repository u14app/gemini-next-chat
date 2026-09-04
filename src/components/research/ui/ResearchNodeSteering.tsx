"use client";

import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/primitives";
import { useResearchSteering } from "@/hooks/research/useResearchSteering";

export function ResearchNodeSteering({
  taskId,
  nodeId,
}: {
  taskId: string;
  nodeId: string;
}) {
  const t = useTranslations("ResearchSteering");
  const steering = useResearchSteering(taskId);
  const node = steering.run?.nodes.find((item) => item.id === nodeId);
  if (!node || node.status !== "pending" || node.waveId) return null;
  const last = steering.record?.commands
    .filter(
      (command) =>
        command.intent.nodeId === nodeId && command.intent.kind === "priority",
    )
    .at(-1);
  return (
    <section className="mt-4 space-y-2" aria-label={t("priority")}>
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            { priority: -1, label: "promote", Icon: ArrowUp },
            { priority: 1, label: "demote", Icon: ArrowDown },
            { priority: 0, label: "reset", Icon: RotateCcw },
          ] as const
        ).map(({ priority, label, Icon }) => (
          <Button
            key={label}
            size="sm"
            className="min-h-11 whitespace-nowrap text-xs"
            disabled={!steering.available || steering.busy || steering.loading}
            aria-pressed={
              last?.status !== "rejected" &&
              last?.intent.kind === "priority" &&
              last.intent.priority === priority
            }
            onClick={() => void steering.setPriority(nodeId, priority)}
          >
            <Icon size={13} aria-hidden />
            {t(label)}
          </Button>
        ))}
      </div>
      {last ? (
        <p className="text-xs text-muted-foreground" role="status">
          {last.status === "rejected"
            ? t(`errors.${last.reason ?? "closed"}`)
            : t(last.status)}
        </p>
      ) : null}
      {steering.error ? (
        <p role="alert" className="text-xs text-destructive">
          {t(`errors.${steering.error}`)}
        </p>
      ) : null}
    </section>
  );
}
