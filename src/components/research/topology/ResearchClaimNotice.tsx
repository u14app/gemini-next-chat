"use client";

import React from "react";
import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { InlineStatus } from "@/components/ui/primitives";

import type { ResearchRunView } from "../types";

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
