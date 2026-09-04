"use client";

import React from "react";
import { useTranslations } from "next-intl";

import LongTextBlock from "@/components/content/LongTextBlock";
import { createLongTextPresentation } from "@/lib/chat/longText";
import {
  createReportSectionLabels,
  projectResearchReport,
} from "@/lib/research/reportSections";

import ResearchPlanCard from "./ResearchPlanCard";
import ResearchProgressCard from "./ResearchProgressCard";
import type { ResearchTaskActions, ResearchTaskViewModel } from "./types";

export interface ResearchTaskCardProps extends ResearchTaskActions {
  task: ResearchTaskViewModel;
  onOpenWorkbench: () => void;
}

/**
 * A research task shows one card, but that card means two different things
 * either side of approval: a plan to review, or a run to watch. This picks the
 * right one. `failed`/`cancelled` stay on the plan card until a run exists, so
 * a planning failure is reported where the user was looking.
 */
export default function ResearchTaskCard(props: ResearchTaskCardProps) {
  const t = useTranslations("Research");
  const { task } = props;
  const isPlanPhase =
    task.status === "draft" ||
    task.status === "clarifying" ||
    task.status === "plan_ready" ||
    (!task.run && (task.status === "failed" || task.status === "cancelled"));
  if (isPlanPhase) return <ResearchPlanCard {...props} />;

  const activeReport =
    task.status === "completed" || task.status === "partial_completed"
      ? task.reportVersions.find(
          (report) => report.id === task.activeReportVersionId,
        ) || task.reportVersions.at(-1)
      : undefined;

  return (
    <div className="grid gap-3 [&>section]:m-0!">
      <ResearchProgressCard {...props} />
      {activeReport ? (
        <LongTextBlock
          content={
            projectResearchReport(
              activeReport.markdown,
              createReportSectionLabels((key) => t(key)),
            ).markdown
          }
          presentation={createLongTextPresentation({
            title: activeReport.title,
            format: "markdown",
          })}
          onOpen={props.onOpenWorkbench}
        />
      ) : null}
    </div>
  );
}
