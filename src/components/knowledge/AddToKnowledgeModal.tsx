"use client";
import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, FileText, LibraryBig, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useKnowledgeStore } from "@/store/core/knowledgeStore";
import { Button } from "@/components/ui/primitives";

interface AddToKnowledgeModalProps {
  onClose: () => void;
  defaultTitle: string;
  defaultContent: string;
}

const AddToKnowledgeModal: React.FC<AddToKnowledgeModalProps> = ({
  onClose,
  defaultTitle,
  defaultContent,
}) => {
  const t = useTranslations("Knowledge");
  const { collections, addTextFileToCollection } = useKnowledgeStore();
  const [collectionId, setCollectionId] = useState(collections[0]?.id || "");
  const [title, setTitle] = useState(defaultTitle);
  const [content, setContent] = useState(defaultContent);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const collectionInputId = useId();
  const titleInputId = useId();
  const contentInputId = useId();

  const effectiveCollectionId = collectionId || collections[0]?.id || "";
  const canSave =
    Boolean(effectiveCollectionId) &&
    Boolean(title.trim()) &&
    Boolean(content.trim()) &&
    !isSaving;

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    setError("");
    try {
      await addTextFileToCollection(effectiveCollectionId, title, content);
      onClose();
    } catch {
      setError(t("addToKnowledgeFailed"));
      setIsSaving(false);
    }
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
      className="fixed inset-0 z-9999 flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm animate-in fade-in duration-200 dark:bg-black/60"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="glass-popover flex max-h-[86vh] w-full max-w-xl flex-col rounded-2xl border"
      >
        <div className="flex items-center justify-between border-b border-gray-200/50 px-5 py-4 dark:border-border">
          <h3
            id={titleId}
            className="flex items-center gap-2 text-lg font-bold text-gray-800 dark:text-foreground"
          >
            <LibraryBig
              size={20}
              className="text-purple-500"
              aria-hidden="true"
            />
            {t("addToKnowledge")}
          </h3>
          <Button
            variant="bare"
            type="button"
            aria-label={t("closeSelection")}
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-500 transition-colors hover:bg-gray-200/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60 dark:hover:bg-accent/50"
          >
            <X size={18} aria-hidden="true" />
          </Button>
        </div>

        <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-5">
          <div className="space-y-1.5">
            <label
              htmlFor={collectionInputId}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-muted-foreground"
            >
              <LibraryBig size={12} aria-hidden="true" />
              {t("selectKnowledgeBase")}
            </label>
            <select
              id={collectionInputId}
              value={effectiveCollectionId}
              onChange={(event) => setCollectionId(event.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60 dark:border-border dark:bg-muted dark:text-foreground"
            >
              {collections.length === 0 ? (
                <option value="">{t("noCollectionsFound")}</option>
              ) : (
                collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.name}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor={titleInputId}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-muted-foreground"
            >
              <FileText size={12} aria-hidden="true" />
              {t("fileTitle")}
            </label>
            <input
              id={titleInputId}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60 dark:border-border dark:bg-muted dark:text-foreground"
              placeholder={t("fileTitlePlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor={contentInputId}
              className="text-xs font-semibold text-gray-500 dark:text-muted-foreground"
            >
              {t("fileContentLabel")}
            </label>
            <textarea
              id={contentInputId}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="min-h-56 w-full resize-y rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-sm text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60 dark:border-border dark:bg-muted dark:text-foreground"
            />
          </div>

          {error ? (
            <div
              role="status"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
            >
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-3 rounded-b-2xl border-t border-gray-200/50 bg-gray-50/50 p-5 dark:border-border dark:bg-card/50">
          <Button
            variant="bare"
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60 dark:text-muted-foreground dark:hover:bg-muted"
          >
            {t("cancel")}
          </Button>
          <Button
            variant="bare"
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="flex items-center gap-2 rounded-xl bg-purple-600 px-6 py-2 text-sm font-medium text-white shadow-lg shadow-purple-500/20 transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60"
          >
            {isSaving ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <Check size={16} aria-hidden="true" />
            )}
            {t("save")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default AddToKnowledgeModal;
