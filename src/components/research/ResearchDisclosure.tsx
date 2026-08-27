"use client";

import React, { useId } from "react";

import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";

type ResearchDisclosureProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: (open: boolean) => React.ReactNode;
  children: React.ReactNode;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  innerClassName?: string;
  contentId?: string;
  ariaCurrent?: React.AriaAttributes["aria-current"];
};

export default function ResearchDisclosure({
  open,
  onOpenChange,
  summary,
  children,
  className,
  triggerClassName,
  contentClassName,
  innerClassName,
  contentId,
  ariaCurrent,
}: ResearchDisclosureProps) {
  const generatedId = useId();
  const resolvedContentId = contentId ?? `${generatedId}-content`;

  return (
    <div className={className} data-state={open ? "open" : "closed"}>
      <Button
        variant="bare"
        type="button"
        aria-current={ariaCurrent}
        aria-expanded={open}
        aria-controls={resolvedContentId}
        className={triggerClassName}
        onClick={() => onOpenChange(!open)}
      >
        {summary(open)}
      </Button>
      <div
        id={resolvedContentId}
        aria-hidden={open ? undefined : true}
        inert={open ? undefined : true}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          contentClassName,
        )}
      >
        <div
          className={cn(
            "min-h-0 overflow-hidden transition-transform duration-200 ease-out motion-reduce:transition-none",
            open ? "translate-y-0" : "-translate-y-1",
            innerClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
