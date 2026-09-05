"use client";
import React from "react";
import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import type { MarkdownGeneratedFile } from "@/lib/utils/markdownFiles";
import { Button } from "@/components/ui/primitives";
export const FileCard = ({
  file,
  onClick,
}: {
  file: MarkdownGeneratedFile;
  onClick?: (file: MarkdownGeneratedFile) => void;
}) => {
  const t = useTranslations("Content");
  const { name, type, truncated, incomplete } = file;
  const isInteractive = Boolean(onClick);
  const cardBody = (
    <>
      <div className="markdown-file-card-icon">
        <FileText size={20} aria-hidden="true" />
      </div>
      <div className="flex flex-col flex-1 min-w-0">
        <span className="markdown-strong-text text-sm font-medium truncate">
          {name}
        </span>
        <div className="markdown-file-card-meta flex min-w-0 flex-wrap items-center gap-2 text-xs">
          <span className="markdown-file-card-action">
            {isInteractive ? t("openGeneratedFile") : t("generatedFile")}
          </span>
          {type ? (
            <span className="markdown-file-type-badge max-w-40 truncate rounded px-1.5 py-0.5 font-mono text-[10px]">
              {type}
            </span>
          ) : null}
          {truncated ? (
            <span className="markdown-warning-badge rounded px-1.5 py-0.5 text-[10px] font-medium">
              {t("truncated")}
            </span>
          ) : null}
          {incomplete ? (
            <span className="markdown-muted-badge rounded px-1.5 py-0.5 text-[10px] font-medium">
              {t("incomplete")}
            </span>
          ) : null}
        </div>
      </div>
    </>
  );

  const className =
    "group markdown-file-card my-2 inline-flex min-w-50 w-full select-none items-center gap-3 rounded-xl p-3 text-left transition-[border-color,background-color,box-shadow] md:w-auto";

  if (!onClick) {
    return (
      <div
        aria-label={t("generatedFileAria", { name })}
        className={`${className} cursor-default`}
      >
        {cardBody}
      </div>
    );
  }

  return (
    <Button
      variant="bare"
      type="button"
      aria-label={t("openGeneratedFileAria", { name })}
      onClick={() => onClick(file)}
      className={`${className} markdown-file-card-interactive markdown-focus-ring cursor-pointer`}
    >
      {cardBody}
    </Button>
  );
};
