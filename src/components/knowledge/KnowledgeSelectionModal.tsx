"use client";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  X,
  Check,
  LibraryBig,
  FileText,
  Folder,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useKnowledgeStore } from "@/store/core/knowledgeStore";
import { Attachment, Collection, KnowledgeFileStatus } from "@/types";
import {
  createKnowledgeCollectionAttachment,
  createKnowledgeFileAttachment,
} from "@/lib/utils/knowledgeAttachments";
import { Button } from "@/components/ui/primitives";

interface KnowledgeSelectionModalProps {
  onClose: () => void;
  onSelect: (attachments: Attachment[]) => void;
}

const menuItemFocusClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60";

const collectionKey = (collectionId: string) => `collection:${collectionId}`;
const fileKey = (collectionId: string, fileId: string) =>
  `file:${collectionId}:${fileId}`;

const getKnowledgeStatusLabelKey = (
  status: KnowledgeFileStatus,
):
  | "statusUploading"
  | "statusParsing"
  | "statusIndexing"
  | "statusIndexed"
  | "statusSaved"
  | "statusError"
  | "statusUnknown" => {
  switch (status) {
    case "uploading":
      return "statusUploading";
    case "parsing":
      return "statusParsing";
    case "indexing":
      return "statusIndexing";
    case "indexed":
      return "statusIndexed";
    case "saved":
      return "statusSaved";
    case "error":
      return "statusError";
    default:
      return "statusUnknown";
  }
};

const KnowledgeSelectionModal: React.FC<KnowledgeSelectionModalProps> = ({
  onClose,
  onSelect,
}) => {
  const t = useTranslations("Knowledge");
  const { collections } = useKnowledgeStore();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(
    null,
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const listId = useId();

  const activeCollection = useMemo(
    () =>
      collections.find((collection) => collection.id === activeCollectionId),
    [activeCollectionId, collections],
  );

  const toggleSelection = (key: string) => {
    setSelectedKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys);
      if (nextKeys.has(key)) {
        nextKeys.delete(key);
      } else {
        nextKeys.add(key);
      }
      return nextKeys;
    });
  };

  const handleConfirm = () => {
    const selectedAttachments: Attachment[] = [];

    for (const key of selectedKeys) {
      if (key.startsWith("collection:")) {
        const collectionId = key.slice("collection:".length);
        const collection = collections.find((item) => item.id === collectionId);
        if (!collection) continue;
        selectedAttachments.push(
          createKnowledgeCollectionAttachment({
            collectionId: collection.id,
            collectionName: collection.name,
          }),
        );
        continue;
      }

      if (key.startsWith("file:")) {
        const [, collectionId, fileId] = key.split(":");
        const collection = collections.find((item) => item.id === collectionId);
        const file = collection?.files.find((item) => item.id === fileId);
        if (!collection || !file) continue;
        selectedAttachments.push(
          createKnowledgeFileAttachment({
            collectionId: collection.id,
            fileId: file.id,
            fileName: file.name,
          }),
        );
      }
    }

    onSelect(selectedAttachments);
    onClose();
  };

  const renderSelectionDot = (isSelected: boolean) => (
    <span
      aria-hidden="true"
      className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
        isSelected
          ? "bg-purple-500 border-purple-500 text-white"
          : "border-gray-300 dark:border-input"
      }`}
    >
      {isSelected && <Check size={12} strokeWidth={3} />}
    </span>
  );

  const renderCollectionRow = (collection: Collection) => {
    const key = collectionKey(collection.id);
    const isSelected = selectedKeys.has(key);

    return (
      <div
        key={collection.id}
        className={`flex items-center gap-2 rounded-xl border p-2 transition-[background-color,border-color,box-shadow] ${
          isSelected
            ? "bg-purple-50 dark:bg-purple-900/20 border-purple-500/50"
            : "bg-white dark:bg-muted border-gray-200 dark:border-border hover:border-purple-300 dark:hover:border-purple-700"
        }`}
      >
        <Button
          variant="bare"
          type="button"
          aria-label={
            isSelected
              ? t("unselectCollectionAria", { name: collection.name })
              : t("selectCollectionAria", { name: collection.name })
          }
          aria-pressed={isSelected}
          onClick={() => toggleSelection(key)}
          className={`shrink-0 rounded-lg p-1 ${menuItemFocusClass}`}
        >
          {renderSelectionDot(isSelected)}
        </Button>

        <Button
          variant="bare"
          type="button"
          onClick={() => setActiveCollectionId(collection.id)}
          className={`flex min-w-0 flex-1 items-center rounded-lg p-1 text-left ${menuItemFocusClass}`}
        >
          <span
            aria-hidden="true"
            className={`w-10 h-10 rounded-lg flex items-center justify-center mr-3 ${
              isSelected
                ? "bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300"
                : "bg-gray-100 text-gray-500 dark:bg-accent dark:text-muted-foreground"
            }`}
          >
            <Folder size={20} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-gray-800 dark:text-foreground">
              {collection.name}
            </span>
            <span className="flex min-w-0 items-center gap-2 text-xs text-gray-500 dark:text-muted-foreground">
              <span className="flex shrink-0 items-center gap-1">
                <FileText size={10} aria-hidden="true" />
                {t("fileCount", { count: collection.files.length })}
              </span>
              <span aria-hidden="true">-</span>
              <span className="truncate">
                {collection.description || t("noDescription")}
              </span>
            </span>
          </span>
          <ChevronRight
            size={16}
            className="ml-2 shrink-0 text-gray-400"
            aria-hidden="true"
          />
        </Button>
      </div>
    );
  };

  const renderFileRow = (collection: Collection) => {
    const collectionSelectionKey = collectionKey(collection.id);
    const isCollectionSelected = selectedKeys.has(collectionSelectionKey);

    return (
      <div className="space-y-2">
        <Button
          variant="bare"
          type="button"
          aria-pressed={isCollectionSelected}
          onClick={() => toggleSelection(collectionSelectionKey)}
          className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${menuItemFocusClass} ${
            isCollectionSelected
              ? "border-purple-500/50 bg-purple-50 dark:bg-purple-900/20"
              : "border-gray-200 bg-white hover:border-purple-300 dark:border-border dark:bg-muted"
          }`}
        >
          {renderSelectionDot(isCollectionSelected)}
          <Folder size={18} className="text-purple-500" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-gray-800 dark:text-foreground">
              {t("selectEntireCollection")}
            </span>
            <span className="block truncate text-xs text-gray-500 dark:text-muted-foreground">
              {collection.name}
            </span>
          </span>
        </Button>

        {collection.files.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400 dark:border-border">
            {t("noDocuments")}
          </div>
        ) : (
          collection.files.map((file) => {
            const key = fileKey(collection.id, file.id);
            const isSelected = selectedKeys.has(key);
            return (
              <Button
                variant="bare"
                type="button"
                key={file.id}
                aria-pressed={isSelected}
                onClick={() => toggleSelection(key)}
                className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${menuItemFocusClass} ${
                  isSelected
                    ? "border-purple-500/50 bg-purple-50 dark:bg-purple-900/20"
                    : "border-gray-200 bg-white hover:border-purple-300 dark:border-border dark:bg-muted"
                }`}
              >
                {renderSelectionDot(isSelected)}
                <FileText
                  size={18}
                  className="text-blue-500"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-800 dark:text-foreground">
                    {file.name}
                  </span>
                  <span className="block truncate text-xs text-gray-500 dark:text-muted-foreground">
                    {t(getKnowledgeStatusLabelKey(file.status))}
                  </span>
                </span>
              </Button>
            );
          })
        )}
      </div>
    );
  };

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusableSelector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    const focusFirst = () => {
      const focusable =
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector);
      focusable?.[0]?.focus();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ||
          [],
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    queueMicrotask(focusFirst);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-9999 flex items-center justify-center bg-black/20 dark:bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="glass-popover w-full max-w-lg rounded-2xl border flex flex-col max-h-[80vh]"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200/50 dark:border-border">
          <div className="min-w-0">
            <h3
              id={titleId}
              className="text-lg font-bold text-gray-800 dark:text-foreground flex items-center gap-2"
            >
              <LibraryBig
                size={20}
                className="text-purple-500"
                aria-hidden="true"
              />
              {t("selectKnowledgeBase")}
            </h3>
            {activeCollection ? (
              <Button
                variant="bare"
                type="button"
                onClick={() => setActiveCollectionId(null)}
                className={`mt-1 inline-flex max-w-full items-center gap-1 text-xs text-gray-500 hover:text-purple-600 dark:text-muted-foreground dark:hover:text-purple-300 ${menuItemFocusClass}`}
              >
                <ChevronLeft size={12} aria-hidden="true" />
                <span className="truncate">{activeCollection.name}</span>
              </Button>
            ) : null}
          </div>
          <Button
            variant="bare"
            type="button"
            aria-label={t("closeSelection")}
            onClick={onClose}
            className="p-1.5 hover:bg-gray-200/50 dark:hover:bg-accent/50 rounded-full transition-colors text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60"
          >
            <X size={18} aria-hidden="true" />
          </Button>
        </div>

        <div
          id={listId}
          className="p-4 overflow-y-auto custom-scrollbar flex-1 space-y-2"
          aria-label={t("collectionsLabel")}
        >
          {collections.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <p>{t("noCollectionsFound")}</p>
              <p className="text-xs mt-1">{t("createCollectionFirst")}</p>
            </div>
          ) : activeCollection ? (
            renderFileRow(activeCollection)
          ) : (
            collections.map(renderCollectionRow)
          )}
        </div>

        <div className="p-5 border-t border-gray-200/50 dark:border-border bg-gray-50/50 dark:bg-card/50 flex items-center justify-between gap-3 rounded-b-2xl">
          <span className="text-xs text-gray-500 dark:text-muted-foreground">
            {t("selectedCount", { count: selectedKeys.size })}
          </span>
          <div className="flex gap-3">
            <Button
              variant="bare"
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-muted-foreground hover:bg-white dark:hover:bg-muted rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60"
            >
              {t("cancel")}
            </Button>
            <Button
              variant="bare"
              type="button"
              onClick={handleConfirm}
              disabled={selectedKeys.size === 0}
              className="px-6 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-xl shadow-lg shadow-purple-500/20 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60"
            >
              <Check size={16} aria-hidden="true" />
              {t("attachSelected")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default KnowledgeSelectionModal;
