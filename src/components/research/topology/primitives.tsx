"use client";

import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  LoaderCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils/cn";

import type {
  ResearchRunItemStatusView,
  ResearchStopReasonView,
} from "../types";

export function StopReasonText({ reason }: { reason: ResearchStopReasonView }) {
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

export function RunStatusIcon({
  status,
}: {
  status: ResearchRunItemStatusView;
}) {
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

export function PlanList({ items }: { items: string[] }) {
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
