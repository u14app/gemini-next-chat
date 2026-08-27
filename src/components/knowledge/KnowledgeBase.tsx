"use client";
import React, {
  useCallback,
  useEffect,
  useState,
  useRef,
  useMemo,
  useId,
} from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import {
  Folder,
  Search,
  Plus,
  FileText,
  ChevronRight,
  UploadCloud,
  Trash2,
  RefreshCw,
  AlertCircle,
  X,
  LibraryBig,
  Archive,
  Settings,
  Save,
  Check,
  Atom,
  BookText,
  Microscope,
  Cat,
  ChartLine,
  ChessKnight,
  CodeXml,
  Coffee,
  GraduationCap,
  MessagesSquare,
  Copy,
  FileCode,
  Image as ImageIcon,
  Headphones,
  Film,
  Download,
  FileUp,
  RotateCcw,
  Ban,
} from "lucide-react";
import { useKnowledgeStore } from "@/store/core/knowledgeStore";
import { useSettingsStore } from "@/store/core/settingsStore";
import {
  Collection,
  KnowledgeChunkingConfig,
  KnowledgeFile,
  KnowledgeFileStatus,
} from "@/types";
import Tooltip from "../ui/Tooltip";
import { resolveOPFSUrl, isOPFSUrl } from "@/utils/opfs";
import {
  formatBytes as formatLimitBytes,
  KNOWLEDGE_LIMITS,
} from "@/config/limits";
import {
  getKnowledgeFileSelectionMessage,
  selectKnowledgeFilesForUpload,
} from "@/lib/utils/knowledgeFiles";
import { copyTextToClipboard } from "@/lib/utils/clipboard";
import {
  createTimedStatusResetController,
  type TimedStatusResetController,
} from "@/lib/utils/timedStatus";
import { withResolvedObjectUrl } from "@/lib/utils/objectUrlLifecycle";
import { logDevError } from "@/lib/utils/devLogger";
import { buildKnowledgeVectorItems } from "@/lib/utils/knowledgeVectors";
import { createKnowledgeChunkingRevision } from "@/lib/knowledge/entities";
import {
  filterKnowledgeFiles,
  getKnowledgeFileStatusFilter,
  runKnowledgeFileBatch,
  type KnowledgeFileBatchResult,
  type KnowledgeFileStatusFilter,
} from "@/lib/knowledge/fileProductivity";
import { Button } from "@/components/ui/primitives";

const formatBytes = (bytes: number, decimals = 2) => {
  if (!+bytes) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

// Expanded Icon Set
const COLLECTION_ICONS = [
  { name: "Folder", icon: Folder },
  { name: "Atom", icon: Atom },
  { name: "BookText", icon: BookText },
  { name: "Microscope", icon: Microscope },
  { name: "Cat", icon: Cat },
  { name: "ChartLine", icon: ChartLine },
  { name: "ChessKnight", icon: ChessKnight },
  { name: "CodeXml", icon: CodeXml },
  { name: "Coffee", icon: Coffee },
  { name: "GraduationCap", icon: GraduationCap },
  { name: "MessagesSquare", icon: MessagesSquare },
  { name: "Archive", icon: Archive },
];

const COLLECTION_COLORS = [
  { name: "blue", class: "bg-blue-500", text: "text-blue-500" },
  { name: "purple", class: "bg-purple-500", text: "text-purple-500" },
  { name: "green", class: "bg-green-500", text: "text-green-500" },
  { name: "orange", class: "bg-orange-500", text: "text-orange-500" },
  { name: "red", class: "bg-red-500", text: "text-red-500" },
  { name: "pink", class: "bg-pink-500", text: "text-pink-500" },
  { name: "cyan", class: "bg-cyan-500", text: "text-cyan-500" },
  { name: "gray", class: "bg-gray-500", text: "text-gray-500" },
];

type CopyStatus = "idle" | "copied" | "error";
type KnowledgeBatchAction = "retry" | "reindex" | "download" | "delete";

type CollectionModalData = {
  name: string;
  description: string;
  icon: string;
  color: string;
  chunking: KnowledgeChunkingConfig;
};

type ChunkPreview = { total: number; chunks: string[] };

// --- Modal Content Component (Reused for New/Edit) ---
const CollectionModalContent = ({
  title,
  initialData,
  onSubmit,
  onDelete,
  onPreview,
  onClose,
}: {
  title: string;
  initialData?: Partial<Collection>;
  onSubmit: (data: CollectionModalData) => void;
  onDelete?: () => void | Promise<void>;
  onPreview?: (chunking: KnowledgeChunkingConfig) => Promise<ChunkPreview>;
  onClose: () => void;
}) => {
  const t = useTranslations("Knowledge");
  const [name, setName] = useState(initialData?.name || "");
  const [desc, setDesc] = useState(initialData?.description || "");
  const [selectedIcon, setSelectedIcon] = useState(
    initialData?.icon || "Folder",
  );
  const [selectedColor, setSelectedColor] = useState(
    initialData?.color || "blue",
  );
  const defaultChunkSize = useSettingsStore((state) => state.rag.chunkSize);
  const [chunking, setChunking] = useState<KnowledgeChunkingConfig>(
    initialData?.chunking || {
      strategy: "auto",
      chunkSize: defaultChunkSize || 512,
      overlapPercent: 10,
    },
  );
  const [chunkPreview, setChunkPreview] = useState<ChunkPreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deleteConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const modalId = useId();
  const titleId = `${modalId}-title`;
  const nameInputId = `${modalId}-name`;
  const descriptionInputId = `${modalId}-description`;
  const colorGroupId = `${modalId}-color`;
  const iconGroupId = `${modalId}-icon`;

  const canDelete = onDelete && initialData && initialData.files?.length === 0;
  const trimmedName = name.trim();

  const clearDeleteConfirmation = () => {
    if (deleteConfirmTimerRef.current) {
      clearTimeout(deleteConfirmTimerRef.current);
      deleteConfirmTimerRef.current = null;
    }
    setIsDeleteConfirming(false);
  };

  const handleClose = () => {
    clearDeleteConfirmation();
    onClose();
  };

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    nameInputRef.current?.focus({ preventScroll: true });

    return () => {
      if (deleteConfirmTimerRef.current) {
        clearTimeout(deleteConfirmTimerRef.current);
        deleteConfirmTimerRef.current = null;
      }
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus({ preventScroll: true });
      }
      previousFocusRef.current = null;
    };
  }, []);

  const handleModalKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      handleClose();
      return;
    }

    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusableElements = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getClientRects().length > 0);

    if (focusableElements.length === 0) {
      event.preventDefault();
      dialog.focus({ preventScroll: true });
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus({ preventScroll: true });
    }
  };

  const handleSubmit = () => {
    if (!trimmedName) {
      nameInputRef.current?.focus({ preventScroll: true });
      return;
    }

    onSubmit({
      name: trimmedName,
      description: desc.trim(),
      icon: selectedIcon,
      color: selectedColor,
      chunking,
    });
  };

  const handlePreview = async () => {
    if (!onPreview || isPreviewing) return;
    setIsPreviewing(true);
    setPreviewError("");
    try {
      setChunkPreview(await onPreview(chunking));
    } catch (error) {
      logDevError("Failed to preview knowledge chunks", error);
      setPreviewError(t("chunking.previewError"));
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleDeleteClick = () => {
    if (!canDelete || !onDelete) return;

    if (!isDeleteConfirming) {
      setIsDeleteConfirming(true);
      if (deleteConfirmTimerRef.current) {
        clearTimeout(deleteConfirmTimerRef.current);
      }
      deleteConfirmTimerRef.current = setTimeout(() => {
        deleteConfirmTimerRef.current = null;
        setIsDeleteConfirming(false);
      }, 5000);
      return;
    }

    clearDeleteConfirmation();
    setDeleteError("");
    void Promise.resolve(onDelete()).catch((error) => {
      logDevError("Failed to delete collection", error);
      setDeleteError(t("deleteCollectionError"));
    });
  };

  return (
    <div
      className="fixed inset-0 z-9999 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleModalKeyDown}
        className="bg-white dark:bg-card w-full max-w-lg rounded-2xl shadow-2xl border border-gray-200 dark:border-border flex flex-col overflow-hidden max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-border">
          <h2
            id={titleId}
            className="text-lg font-bold text-gray-800 dark:text-foreground"
          >
            {title}
          </h2>
          <Button
            variant="bare"
            type="button"
            aria-label={t("closeEditor")}
            onClick={handleClose}
            className="rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:hover:bg-muted"
          >
            <X size={20} aria-hidden="true" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
          {/* Name & Desc */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor={nameInputId}
                className="text-xs font-semibold text-gray-500 dark:text-muted-foreground"
              >
                {t("name")}
              </label>
              <input
                ref={nameInputRef}
                id={nameInputId}
                name="knowledge-collection-name"
                type="text"
                autoComplete="off"
                className="w-full px-3 py-2 bg-gray-50 dark:bg-muted border border-gray-200 dark:border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm font-medium text-gray-800 dark:text-foreground transition-[border-color,box-shadow,background-color]"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
                maxLength={KNOWLEDGE_LIMITS.maxCollectionNameChars}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor={descriptionInputId}
                className="text-xs font-semibold text-gray-500 dark:text-muted-foreground"
              >
                {t("description")}
              </label>
              <textarea
                id={descriptionInputId}
                name="knowledge-collection-description"
                autoComplete="off"
                className="w-full px-3 py-2 bg-gray-50 dark:bg-muted border border-gray-200 dark:border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm resize-none h-20 text-gray-700 dark:text-foreground/85 transition-[border-color,box-shadow,background-color]"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder={t("descriptionPlaceholder")}
                maxLength={KNOWLEDGE_LIMITS.maxCollectionDescriptionChars}
              />
            </div>
          </div>

          <section className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-border dark:bg-muted/40">
            <div>
              <h3 className="text-xs font-semibold text-gray-700 dark:text-foreground">
                {t("chunking.title")}
              </h3>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-muted-foreground">
                {t("chunking.description")}
              </p>
            </div>
            <label className="block space-y-1.5 text-xs font-semibold text-gray-500 dark:text-muted-foreground">
              <span>{t("chunking.strategy")}</span>
              <select
                value={chunking.strategy}
                onChange={(event) =>
                  setChunking((current) => ({
                    ...current,
                    strategy: event.target
                      .value as KnowledgeChunkingConfig["strategy"],
                  }))
                }
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 outline-none transition-[border-color,box-shadow] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-border dark:bg-card dark:text-foreground"
              >
                <option value="auto">{t("chunking.auto")}</option>
                <option value="recursive">{t("chunking.recursive")}</option>
                <option value="markdown">{t("chunking.markdown")}</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5 text-xs font-semibold text-gray-500 dark:text-muted-foreground">
                <span>{t("chunking.chunkSize")}</span>
                <input
                  type="number"
                  min={128}
                  max={4096}
                  step={64}
                  value={chunking.chunkSize}
                  onChange={(event) =>
                    setChunking((current) => ({
                      ...current,
                      chunkSize: Number(event.target.value),
                    }))
                  }
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm tabular-nums text-gray-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-border dark:bg-card dark:text-foreground"
                />
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-gray-500 dark:text-muted-foreground">
                <span>{t("chunking.overlap")}</span>
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={chunking.overlapPercent}
                  onChange={(event) =>
                    setChunking((current) => ({
                      ...current,
                      overlapPercent: Number(event.target.value),
                    }))
                  }
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm tabular-nums text-gray-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-border dark:bg-card dark:text-foreground"
                />
              </label>
            </div>
            {initialData?.files?.length ? (
              <Button
                variant="bare"
                type="button"
                onClick={() => void handlePreview()}
                disabled={isPreviewing}
                className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:opacity-50 dark:border-blue-900/60 dark:bg-card dark:text-blue-300 dark:hover:bg-blue-950/30"
              >
                <RefreshCw
                  size={13}
                  aria-hidden="true"
                  className={isPreviewing ? "animate-spin" : ""}
                />
                {t("chunking.preview")}
              </Button>
            ) : (
              <p className="text-[11px] text-gray-500 dark:text-muted-foreground">
                {t("chunking.previewEmpty")}
              </p>
            )}
            {previewError ? (
              <p
                role="alert"
                className="text-[11px] text-red-600 dark:text-red-300"
              >
                {previewError}
              </p>
            ) : null}
            {chunkPreview ? (
              <div className="space-y-2 rounded-lg border border-blue-100 bg-white p-3 dark:border-blue-900/40 dark:bg-card">
                <div className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                  {t("chunking.previewCount", { count: chunkPreview.total })}
                </div>
                {chunkPreview.chunks.map((chunk, index) => (
                  <p
                    key={index}
                    className="line-clamp-3 rounded-md bg-gray-50 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-gray-600 dark:bg-muted dark:text-foreground/75"
                  >
                    {chunk}
                  </p>
                ))}
              </div>
            ) : null}
            {initialData?.files?.length ? (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                {t("chunking.reindexNotice")}
              </p>
            ) : null}
          </section>

          {/* Visuals */}
          <div className="space-y-4">
            <div className="space-y-2">
              <div
                id={colorGroupId}
                className="text-xs font-semibold text-gray-500 dark:text-muted-foreground"
              >
                {t("themeColor")}
              </div>
              <div
                role="group"
                aria-labelledby={colorGroupId}
                className="flex flex-wrap gap-3"
              >
                {COLLECTION_COLORS.map((c) => (
                  <Button
                    variant="bare"
                    type="button"
                    key={c.name}
                    aria-label={t("useThemeColorAria", { color: c.name })}
                    aria-pressed={selectedColor === c.name}
                    onClick={() => setSelectedColor(c.name)}
                    className={`w-8 h-8 rounded-full ${c.class} flex items-center justify-center transition-[opacity,transform,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-background ${selectedColor === c.name ? "scale-110 shadow-md" : "opacity-40 hover:opacity-100 hover:scale-105"}`}
                  >
                    {selectedColor === c.name && (
                      <Check
                        size={14}
                        className="text-white"
                        strokeWidth={3}
                        aria-hidden="true"
                      />
                    )}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div
                id={iconGroupId}
                className="text-xs font-semibold text-gray-500 dark:text-muted-foreground"
              >
                {t("icon")}
              </div>
              <div
                role="group"
                aria-labelledby={iconGroupId}
                className="flex flex-wrap gap-2"
              >
                {COLLECTION_ICONS.map((IconData) => (
                  <Button
                    variant="bare"
                    type="button"
                    key={IconData.name}
                    aria-label={t("useIconAria", { icon: IconData.name })}
                    aria-pressed={selectedIcon === IconData.name}
                    onClick={() => setSelectedIcon(IconData.name)}
                    className={`w-10 h-10 p-2 rounded-xl flex items-center justify-center transition-[color,background-color,border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${selectedIcon === IconData.name ? "bg-blue-50 dark:bg-blue-900/20 text-blue-500 border border-blue-200 dark:border-blue-800" : "text-gray-400 hover:text-gray-600 dark:hover:text-foreground/85 hover:bg-gray-100 dark:hover:bg-muted border border-transparent"}`}
                  >
                    <IconData.icon size={20} aria-hidden="true" />
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-100 dark:border-border bg-gray-50/50 dark:bg-card/50 flex justify-between gap-3">
          {/* Delete Button */}
          <div>
            {onDelete && (
              <Tooltip
                content={
                  canDelete ? t("deleteCollection") : t("cannotDeleteWithFiles")
                }
                position="right"
              >
                <Button
                  variant="bare"
                  type="button"
                  aria-label={
                    isDeleteConfirming
                      ? t("confirmDeleteCollectionAria", {
                          name: initialData?.name || "",
                        })
                      : t("deleteCollectionAria", {
                          name: initialData?.name || "",
                        })
                  }
                  onClick={handleDeleteClick}
                  disabled={!canDelete}
                  className={`px-4 py-2 text-sm rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 ${
                    isDeleteConfirming
                      ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200"
                      : "text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  }`}
                >
                  {isDeleteConfirming ? (
                    <Check size={16} aria-hidden="true" />
                  ) : (
                    <Trash2 size={16} aria-hidden="true" />
                  )}
                  {isDeleteConfirming ? t("confirmDelete") : t("delete")}
                </Button>
              </Tooltip>
            )}
            {deleteError && (
              <div
                role="alert"
                className="mt-2 max-w-52 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
              >
                {deleteError}
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <Button
              variant="bare"
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm text-gray-600 dark:text-muted-foreground hover:bg-gray-100 dark:hover:bg-muted rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
            >
              {t("cancel")}
            </Button>
            <Button
              variant="bare"
              type="button"
              onClick={handleSubmit}
              disabled={!trimmedName}
              className="px-6 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-500/20 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-background"
            >
              <Save size={16} aria-hidden="true" /> {t("save")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- New Collection Modal (Wrapper) ---
const NewCollectionModal = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslations("Knowledge");
  const { createCollection } = useKnowledgeStore();

  const handleSubmit = (data: CollectionModalData) => {
    createCollection(
      data.name,
      data.description,
      data.icon,
      data.color,
      data.chunking,
    );
    onClose();
  };

  return createPortal(
    <CollectionModalContent
      title={t("newCollection")}
      onSubmit={handleSubmit}
      onClose={onClose}
    />,
    document.body,
  );
};

// --- Edit Collection Modal (Wrapper) ---
const EditCollectionModal = ({
  collection,
  onClose,
}: {
  collection: Collection;
  onClose: () => void;
}) => {
  const t = useTranslations("Knowledge");
  const { deleteCollection, updateCollection, updateCollectionChunking } =
    useKnowledgeStore();

  const handleSubmit = (data: CollectionModalData) => {
    const { chunking, ...metadata } = data;
    updateCollection(collection.id, metadata);
    updateCollectionChunking(collection.id, chunking);
    onClose();
  };

  const handlePreview = async (
    chunking: KnowledgeChunkingConfig,
  ): Promise<ChunkPreview> => {
    const file = collection.files.find((item) => item.contentPath || item.path);
    const contentPath = file?.contentPath || file?.path;
    if (!file || !contentPath) return { total: 0, chunks: [] };
    const content = await withResolvedObjectUrl({
      source: contentPath,
      resolveObjectUrl: resolveOPFSUrl,
      read: async (objectUrl) => (await fetch(objectUrl)).text(),
    });
    const items = buildKnowledgeVectorItems({
      collectionId: collection.id,
      fileName: file.name,
      ragFileId: file.ragId || file.id,
      textContent: content || "",
      chunking,
      chunkingRevision: createKnowledgeChunkingRevision(chunking),
    });
    return {
      total: items.length,
      chunks: items.slice(0, 3).map((item) => item.data),
    };
  };

  const handleDelete = async () => {
    if (collection.files.length > 0) return; // Guard
    await deleteCollection(collection.id);
    onClose();
  };

  return createPortal(
    <CollectionModalContent
      title={t("editCollection")}
      initialData={collection}
      onSubmit={handleSubmit}
      onDelete={handleDelete}
      onPreview={handlePreview}
      onClose={onClose}
    />,
    document.body,
  );
};

// --- Create Collection Card (Dashed) ---
const CreateCollectionCard = ({
  onClick,
  disabled = false,
}: {
  onClick: () => void;
  disabled?: boolean;
}) => {
  const t = useTranslations("Knowledge");
  return (
    <Button
      variant="bare"
      type="button"
      aria-label={t("createNewCollectionAria")}
      onClick={onClick}
      disabled={disabled}
      className="group flex flex-col items-center justify-center p-6 h-full min-h-45 rounded-3xl border-2 border-dashed border-gray-300 dark:border-border hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-[border-color,background-color,box-shadow] duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-background"
    >
      <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-muted group-hover:bg-blue-500 group-hover:text-white dark:group-hover:bg-blue-500 text-gray-400 dark:text-muted-foreground/70 flex items-center justify-center mb-4 transition-[background-color,color,transform,box-shadow] duration-300 shadow-sm group-hover:shadow-blue-500/30">
        <Plus size={28} aria-hidden="true" />
      </div>
      <h3 className="font-bold text-gray-700 dark:text-foreground mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
        {t("newCollection")}
      </h3>
      <p className="text-xs text-gray-400 text-center max-w-37.5">
        {t("createFolderHint")}
      </p>
    </Button>
  );
};

// --- Collection Card (Refined Layout) ---
const CollectionCard: React.FC<{
  collection: Collection;
  onClick: () => void;
  onEdit: (e: React.MouseEvent) => void;
  readOnly?: boolean;
}> = ({ collection, onClick, onEdit, readOnly = false }) => {
  const t = useTranslations("Knowledge");
  const IconObj =
    COLLECTION_ICONS.find((i) => i.name === collection.icon) ||
    COLLECTION_ICONS[0];
  const IconComponent = IconObj.icon;
  const colorObj =
    COLLECTION_COLORS.find((c) => c.name === collection.color) ||
    COLLECTION_COLORS[0];

  return (
    <div className="group relative bg-white dark:bg-muted/40 p-5 rounded-3xl border border-gray-200 dark:border-border hover:border-gray-300 dark:hover:border-border transition-[border-color,background-color,box-shadow] duration-300 flex flex-col h-full min-h-45 shadow-sm hover:shadow-xl dark:shadow-none overflow-hidden">
      <Button
        variant="bare"
        type="button"
        aria-label={t("openCollectionAria", { name: collection.name })}
        onClick={onClick}
        className="absolute inset-0 rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-background"
      >
        <span className="sr-only">
          {t("openCollectionAria", { name: collection.name })}
        </span>
      </Button>

      {/* Header: Icon + Title + Settings */}
      <div className="relative pointer-events-none mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3 overflow-hidden">
          <div
            className={`w-10 h-10 rounded-xl ${colorObj.class} flex items-center justify-center text-white shadow-md shadow-black/5 dark:shadow-black/20 shrink-0`}
          >
            <IconComponent size={20} aria-hidden="true" />
          </div>
          <h3 className="min-w-0 truncate text-base font-bold text-gray-800 transition-colors group-hover:text-blue-600 dark:text-foreground dark:group-hover:text-blue-400">
            {collection.name}
          </h3>
        </div>

        <div className="w-7 h-7 shrink-0" />
      </div>

      {/* Description */}
      <p className="relative pointer-events-none text-xs text-gray-500 dark:text-muted-foreground line-clamp-3 leading-relaxed mb-4 flex-1">
        {collection.description || t("noDescriptionProvided")}
      </p>

      {/* Footer Stats */}
      <div className="relative pointer-events-none mt-auto flex items-center justify-between gap-3 border-t border-gray-100 pt-3 text-xs font-medium text-gray-400 dark:border-border dark:text-muted-foreground/70">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileText size={14} aria-hidden="true" />
          <span className="truncate">
            {t("fileCount", { count: collection.files.length })}
          </span>
        </div>
        {/* Updated At Removed as per request */}
      </div>

      <Button
        variant="bare"
        type="button"
        aria-label={t("editCollectionAria", { name: collection.name })}
        onClick={onEdit}
        disabled={readOnly}
        className="absolute right-5 top-5 z-10 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-foreground hover:bg-gray-100 dark:hover:bg-accent rounded-lg transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <Settings size={16} aria-hidden="true" />
      </Button>
    </div>
  );
};

type StatusConfig = {
  labelKey:
    | "statusUploading"
    | "statusParsing"
    | "statusIndexing"
    | "statusIndexed"
    | "statusSaved"
    | "statusError"
    | "statusUnknown";
  color: string;
  textColor: string;
};

const getStatusConfig = (status: KnowledgeFileStatus): StatusConfig => {
  switch (status) {
    case "uploading":
      return {
        labelKey: "statusUploading",
        color: "bg-gray-400",
        textColor: "text-gray-500",
      };
    case "parsing":
      return {
        labelKey: "statusParsing",
        color: "bg-amber-400",
        textColor: "text-amber-500",
      };
    case "indexing":
      return {
        labelKey: "statusIndexing",
        color: "bg-blue-500",
        textColor: "text-blue-500",
      };
    case "indexed":
      return {
        labelKey: "statusIndexed",
        color: "bg-green-500",
        textColor: "text-green-500",
      };
    case "saved":
      return {
        labelKey: "statusSaved",
        color: "bg-green-500",
        textColor: "text-green-500",
      };
    case "error":
      return {
        labelKey: "statusError",
        color: "bg-red-500",
        textColor: "text-red-500",
      };
    default:
      return {
        labelKey: "statusUnknown",
        color: "bg-gray-300",
        textColor: "text-gray-400",
      };
  }
};

const getStorageDisplayStatus = (file: KnowledgeFile): KnowledgeFileStatus => {
  if (file.storageStatus) {
    return file.storageStatus === "saved" ? "saved" : file.storageStatus;
  }
  if (file.status === "uploading" || file.status === "parsing") {
    return file.status;
  }
  if (file.status === "error" && !(file.contentPath || file.path)) {
    return "error";
  }
  return "saved";
};

const getIndexDisplayStatus = (
  file: KnowledgeFile,
): KnowledgeFileStatus | null => {
  if (file.indexStatus === "not_indexed") return null;
  if (file.indexStatus) {
    return file.indexStatus === "error" ? "error" : file.indexStatus;
  }
  if (["indexing", "indexed"].includes(file.status) || file.ragId) {
    return file.status === "indexing" ? "indexing" : "indexed";
  }
  return null;
};

const getOriginalKnowledgeFilePath = (
  file: KnowledgeFile,
): string | undefined =>
  file.sourcePath ||
  (file.contentKind === "source_text"
    ? file.contentPath || file.path
    : undefined);

// --- File Row ---
const FileRow: React.FC<{
  file: KnowledgeFile;
  rowRef?: React.Ref<HTMLDivElement>;
  isHighlighted?: boolean;
  onDelete: () => void | Promise<void>;
  onClick: () => void;
  onReindex?: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  onReparse?: () => void | Promise<void>;
  onReplaceSource?: (file: File) => void | Promise<void>;
  onDownloadOriginal?: () => void | Promise<void>;
  isReindexing?: boolean;
  isBusy?: boolean;
  isSelected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  selectionDisabled?: boolean;
  readOnly?: boolean;
}> = ({
  file,
  rowRef,
  isHighlighted = false,
  onDelete,
  onClick,
  onReindex,
  onCancel,
  onRetry,
  onReparse,
  onReplaceSource,
  onDownloadOriginal,
  isReindexing = false,
  isBusy = false,
  isSelected = false,
  onSelectedChange,
  selectionDisabled = false,
  readOnly = false,
}) => {
  const t = useTranslations("Knowledge");
  const locale = useLocale();
  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false);
  const deleteConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const replacementInputRef = useRef<HTMLInputElement | null>(null);
  const storageStatus = getStorageDisplayStatus(file);
  const indexStatus = getIndexDisplayStatus(file);
  const storageStatusConfig = getStatusConfig(storageStatus);
  const indexStatusConfig = indexStatus ? getStatusConfig(indexStatus) : null;
  const FileIcon = useMemo(() => {
    if (file.type.startsWith("image/")) return ImageIcon;
    if (file.type.startsWith("audio/")) return Headphones;
    if (file.type.startsWith("video/")) return Film;
    if (file.type.startsWith("application/")) return FileCode;
    return FileText;
  }, [file.type]);

  const clearDeleteConfirmation = () => {
    if (deleteConfirmTimerRef.current) {
      clearTimeout(deleteConfirmTimerRef.current);
      deleteConfirmTimerRef.current = null;
    }
    setIsDeleteConfirming(false);
  };

  useEffect(() => {
    return () => {
      if (deleteConfirmTimerRef.current) {
        clearTimeout(deleteConfirmTimerRef.current);
        deleteConfirmTimerRef.current = null;
      }
    };
  }, []);

  const handleDeleteClick = () => {
    if (readOnly) return;
    if (!isDeleteConfirming) {
      setIsDeleteConfirming(true);
      if (deleteConfirmTimerRef.current) {
        clearTimeout(deleteConfirmTimerRef.current);
      }
      deleteConfirmTimerRef.current = setTimeout(() => {
        deleteConfirmTimerRef.current = null;
        setIsDeleteConfirming(false);
      }, 3500);
      return;
    }

    clearDeleteConfirmation();
    void onDelete();
  };

  return (
    <div
      ref={rowRef}
      data-knowledge-file-id={file.id}
      className={`group flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 transition-[background-color,border-color,box-shadow] ${
        isHighlighted
          ? "border-purple-400 bg-purple-50 ring-2 ring-purple-500/30 dark:border-purple-700 dark:bg-purple-950/30"
          : isSelected
            ? "border-blue-200 bg-blue-50/60 dark:border-blue-900/60 dark:bg-blue-950/20"
            : "border-transparent hover:border-gray-100 hover:bg-gray-50 dark:hover:border-border dark:hover:bg-muted/50"
      }`}
    >
      {onSelectedChange ? (
        <input
          type="checkbox"
          checked={isSelected}
          disabled={selectionDisabled}
          aria-label={t("selectFileAria", { name: file.name })}
          onChange={(event) => onSelectedChange(event.target.checked)}
          className="h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600 focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-muted"
        />
      ) : null}
      <Button
        variant="bare"
        type="button"
        onClick={onClick}
        aria-label={t("openFileAria", { name: file.name })}
        className="flex min-w-0 basis-64 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-background"
      >
        <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 flex items-center justify-center shrink-0 text-blue-500 dark:text-blue-400">
          <FileIcon size={18} aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="text-sm font-medium text-gray-700 dark:text-foreground truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
            {file.name}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-gray-400">
            <span className="max-w-24 truncate uppercase">
              {file.type.split("/").pop() || t("fileTypeFallback")}
            </span>
            <span className="shrink-0">•</span>
            <span className="shrink-0">{formatBytes(file.size)}</span>
            <span className="shrink-0">•</span>
            <span className="shrink-0">
              {new Intl.DateTimeFormat(locale).format(
                new Date(file.uploadedAt),
              )}
            </span>
          </div>
        </div>
      </Button>

      <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1.5 sm:gap-2">
        <div className="flex max-w-44 items-center gap-1.5 rounded-md border border-gray-100 bg-gray-50 px-2 py-1 dark:border-border dark:bg-muted">
          <span
            className={`w-2 h-2 rounded-full ${storageStatusConfig.color} ${["uploading", "parsing"].includes(storageStatus) ? "animate-pulse" : ""}`}
            aria-hidden="true"
          />
          <span
            className={`truncate text-[10px] font-medium ${storageStatusConfig.textColor}`}
          >
            {t(storageStatusConfig.labelKey)}
          </span>
          {storageStatus === "error" && (file.storageError || file.error) && (
            <Tooltip
              content={file.storageError || file.error || ""}
              position="left"
            >
              <AlertCircle
                size={12}
                className="text-red-500 ml-1"
                aria-hidden="true"
              />
            </Tooltip>
          )}
        </div>

        {indexStatusConfig && indexStatus && (
          <div className="flex max-w-44 items-center gap-1.5 rounded-md border border-gray-100 bg-gray-50 px-2 py-1 dark:border-border dark:bg-muted">
            <span
              className={`h-2 w-2 rounded-full ${indexStatusConfig.color} ${indexStatus === "indexing" ? "animate-pulse" : ""}`}
              aria-hidden="true"
            />
            <span
              className={`truncate text-[10px] font-medium ${indexStatusConfig.textColor}`}
            >
              {t(indexStatusConfig.labelKey)}
            </span>
            {indexStatus === "error" && (file.indexError || file.error) && (
              <Tooltip
                content={file.indexError || file.error || ""}
                position="left"
              >
                <AlertCircle
                  size={12}
                  className="ml-1 text-red-500"
                  aria-hidden="true"
                />
              </Tooltip>
            )}
            {indexStatus === "indexed" && file.ragChunkCount ? (
              <span className="shrink-0 text-[10px] text-gray-400">
                {t("chunkCount", { count: file.ragChunkCount })}
              </span>
            ) : null}
          </div>
        )}

        {file.sourceMissing && (
          <Tooltip content={t("originalMissing")} position="left">
            <AlertCircle
              size={16}
              className="shrink-0 text-amber-500"
              aria-hidden="true"
            />
          </Tooltip>
        )}

        {onDownloadOriginal && (
          <Tooltip content={t("downloadOriginal")} position="left">
            <Button
              variant="bare"
              type="button"
              aria-label={t("downloadOriginalAria", { name: file.name })}
              disabled={isBusy}
              onClick={(event) => {
                event.stopPropagation();
                void onDownloadOriginal();
              }}
              className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-blue-900/20"
            >
              <Download size={16} aria-hidden="true" />
            </Button>
          </Tooltip>
        )}

        {onReparse && (
          <Tooltip content={t("reparseFile")} position="left">
            <Button
              variant="bare"
              type="button"
              aria-label={t("reparseFileAria", { name: file.name })}
              disabled={isBusy || readOnly}
              onClick={(event) => {
                event.stopPropagation();
                void onReparse();
              }}
              className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-amber-50 hover:text-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:opacity-50 dark:hover:bg-amber-900/20"
            >
              <RotateCcw
                size={16}
                className={isBusy ? "animate-spin" : ""}
                aria-hidden="true"
              />
            </Button>
          </Tooltip>
        )}

        {onReplaceSource && (
          <>
            <input
              ref={replacementInputRef}
              type="file"
              disabled={readOnly}
              className="sr-only"
              tabIndex={-1}
              aria-label={t("selectOriginalAria", { name: file.name })}
              onChange={(event) => {
                const replacement = event.target.files?.[0];
                event.target.value = "";
                if (replacement) void onReplaceSource(replacement);
              }}
            />
            <Tooltip content={t("selectOriginal")} position="left">
              <Button
                variant="bare"
                type="button"
                aria-label={t("selectOriginalAria", { name: file.name })}
                disabled={isBusy || readOnly}
                onClick={(event) => {
                  event.stopPropagation();
                  replacementInputRef.current?.click();
                }}
                className="shrink-0 rounded-lg p-1.5 text-amber-500 transition-colors hover:bg-amber-50 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:opacity-50 dark:hover:bg-amber-900/20"
              >
                <FileUp size={16} aria-hidden="true" />
              </Button>
            </Tooltip>
          </>
        )}

        {onRetry && (
          <Tooltip content={t("retryFile")} position="left">
            <Button
              variant="bare"
              type="button"
              aria-label={t("retryFileAria", { name: file.name })}
              disabled={isBusy || readOnly}
              onClick={(event) => {
                event.stopPropagation();
                void onRetry();
              }}
              className="shrink-0 rounded-lg p-1.5 text-red-500 transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 disabled:opacity-50 dark:hover:bg-red-900/20"
            >
              <RotateCcw
                size={16}
                className={isBusy ? "animate-spin" : ""}
                aria-hidden="true"
              />
            </Button>
          </Tooltip>
        )}

        {onCancel && (
          <Tooltip content={t("cancelProcessing")} position="left">
            <Button
              variant="bare"
              type="button"
              aria-label={t("cancelProcessingAria", { name: file.name })}
              disabled={readOnly}
              onClick={(event) => {
                event.stopPropagation();
                void onCancel();
              }}
              className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 dark:hover:bg-red-900/20"
            >
              <Ban size={16} aria-hidden="true" />
            </Button>
          </Tooltip>
        )}

        {onReindex && (
          <Tooltip
            content={isReindexing ? t("reindexing") : t("reindexFile")}
            position="left"
          >
            <Button
              variant="bare"
              type="button"
              aria-label={t("reindexFileAria", { name: file.name })}
              aria-busy={isReindexing || undefined}
              disabled={isReindexing || readOnly}
              onClick={(e) => {
                e.stopPropagation();
                void onReindex();
              }}
              className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-blue-900/20 dark:hover:text-blue-300"
            >
              <RefreshCw
                size={16}
                className={isReindexing ? "animate-spin" : ""}
                aria-hidden="true"
              />
            </Button>
          </Tooltip>
        )}

        <Button
          variant="bare"
          type="button"
          aria-label={
            isDeleteConfirming
              ? t("confirmDeleteFileAria", { name: file.name })
              : t("deleteFileAria", { name: file.name })
          }
          onClick={(e) => {
            e.stopPropagation();
            handleDeleteClick();
          }}
          disabled={readOnly}
          className={`shrink-0 rounded-lg p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 ${
            isDeleteConfirming
              ? "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-200"
              : "text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
          }`}
        >
          {isDeleteConfirming ? (
            <Check size={16} aria-hidden="true" />
          ) : (
            <Trash2 size={16} aria-hidden="true" />
          )}
        </Button>
      </div>
    </div>
  );
};

interface KnowledgeBaseProps {
  onClose?: () => void;
  initialCollectionId?: string;
  initialFileId?: string;
  initialChunkIndex?: number;
  initialExcerpt?: string;
}

// --- Main Component ---
const KnowledgeBase: React.FC<KnowledgeBaseProps> = ({
  onClose,
  initialCollectionId,
  initialFileId,
  initialChunkIndex,
  initialExcerpt,
}) => {
  const t = useTranslations("Knowledge");
  const {
    _hasHydrated,
    collections,
    uploadFiles,
    deleteFile,
    updateFileContent,
    reindexFile,
    reindexCollection,
    cancelUpload,
    retryFile,
    reparseFile,
  } = useKnowledgeStore();
  const { rag } = useSettingsStore();

  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(
    null,
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [fileSearchTerm, setFileSearchTerm] = useState("");
  const [fileStatusFilter, setFileStatusFilter] =
    useState<KnowledgeFileStatusFilter>("all");
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [batchResults, setBatchResults] = useState<KnowledgeFileBatchResult[]>(
    [],
  );
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [isBatchDeleteConfirming, setIsBatchDeleteConfirming] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [editingCollection, setEditingCollection] = useState<Collection | null>(
    null,
  );
  const [isDragging, setIsDragging] = useState(false);
  const [uploadNotice, setUploadNotice] = useState("");
  const [reindexingFileId, setReindexingFileId] = useState<string | null>(null);
  const [isReindexingCollection, setIsReindexingCollection] = useState(false);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [highlightedFileId, setHighlightedFileId] = useState<string | null>(
    null,
  );

  // File Viewing State
  const [viewingFile, setViewingFile] = useState<{
    id: string;
    collectionId: string;
    name: string;
    originalContent: string;
  } | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isLoadingFile] = useState(false);
  // Keep for potential future use
  void isLoadingFile;
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const isCopied = copyStatus === "copied";
  const [saveError, setSaveError] = useState("");
  const [isOnline, setIsOnline] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileContentInputRef = useRef<HTMLTextAreaElement>(null);
  const highlightedFileRef = useRef<HTMLDivElement | null>(null);
  const selectVisibleFilesRef = useRef<HTMLInputElement | null>(null);
  const batchDeleteConfirmRef = useRef<HTMLButtonElement | null>(null);
  const locatedTargetRef = useRef("");
  const openedTargetRef = useRef("");
  const fileViewerDialogRef = useRef<HTMLDivElement | null>(null);
  const fileViewerCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const fileViewerPreviousFocusRef = useRef<HTMLElement | null>(null);
  const copyStatusResetRef =
    useRef<TimedStatusResetController<CopyStatus> | null>(null);
  const knowledgeId = useId();
  const fileViewerTitleId = `${knowledgeId}-file-viewer-title`;
  const fileContentInputId = `${knowledgeId}-file-content`;
  const collectionSearchInputId = `${knowledgeId}-collection-search`;
  const fileSearchInputId = `${knowledgeId}-file-search`;
  const fileStatusFilterId = `${knowledgeId}-file-status-filter`;
  const uploadInputId = `${knowledgeId}-upload-input`;
  const uploadTitleId = `${knowledgeId}-upload-title`;
  const uploadDescriptionId = `${knowledgeId}-upload-description`;
  const uploadLimitsId = `${knowledgeId}-upload-limits`;
  const uploadNoticeId = `${knowledgeId}-upload-notice`;

  const activeCollection = collections.find((c) => c.id === activeCollectionId);
  const viewingFileId = viewingFile?.id;
  const filteredFiles = useMemo(
    () =>
      filterKnowledgeFiles(
        activeCollection?.files || [],
        fileSearchTerm,
        fileStatusFilter,
      ),
    [activeCollection?.files, fileSearchTerm, fileStatusFilter],
  );
  const selectedFiles = useMemo(
    () =>
      (activeCollection?.files || []).filter((file) =>
        selectedFileIds.has(file.id),
      ),
    [activeCollection?.files, selectedFileIds],
  );
  const allVisibleFilesSelected =
    filteredFiles.length > 0 &&
    filteredFiles.every((file) => selectedFileIds.has(file.id));
  const someVisibleFilesSelected =
    filteredFiles.some((file) => selectedFileIds.has(file.id)) &&
    !allVisibleFilesSelected;
  const canRetrySelected = selectedFiles.some(
    (file) => getKnowledgeFileStatusFilter(file) === "error",
  );
  const canReindexSelected =
    rag.enabled &&
    selectedFiles.some((file) => Boolean(file.contentPath || file.path));
  const canDownloadSelected = selectedFiles.some((file) =>
    Boolean(getOriginalKnowledgeFilePath(file)),
  );

  useEffect(() => {
    setFileSearchTerm("");
    setFileStatusFilter("all");
    setSelectedFileIds(new Set());
    setBatchResults([]);
    setIsBatchDeleteConfirming(false);
  }, [activeCollectionId]);

  useEffect(() => {
    const fileIds = new Set(
      activeCollection?.files.map((file) => file.id) || [],
    );
    setSelectedFileIds((current) => {
      const next = new Set(
        [...current].filter((fileId) => fileIds.has(fileId)),
      );
      return next.size === current.size ? current : next;
    });
  }, [activeCollection?.files]);

  useEffect(() => {
    if (selectVisibleFilesRef.current) {
      selectVisibleFilesRef.current.indeterminate = someVisibleFilesSelected;
    }
  }, [someVisibleFilesSelected]);

  useEffect(() => {
    setIsBatchDeleteConfirming(false);
  }, [selectedFileIds]);

  useEffect(() => {
    if (!isBatchDeleteConfirming) return;
    batchDeleteConfirmRef.current?.focus({ preventScroll: true });
  }, [isBatchDeleteConfirming]);

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);
    updateOnlineStatus();
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  useEffect(() => {
    if (isOnline) return;
    setShowNewModal(false);
    setEditingCollection(null);
    setIsDragging(false);
  }, [isOnline]);

  useEffect(() => {
    if (!initialCollectionId && !initialFileId) {
      locatedTargetRef.current = "";
      return;
    }
    if (!_hasHydrated) return;
    const requestedCollection = collections.find(
      (collection) => collection.id === initialCollectionId,
    );
    const targetCollection =
      (requestedCollection &&
      (!initialFileId ||
        requestedCollection.files.some((file) => file.id === initialFileId))
        ? requestedCollection
        : undefined) ||
      collections.find((collection) =>
        collection.files.some((file) => file.id === initialFileId),
      );
    if (!targetCollection) return;
    const targetFile = initialFileId
      ? targetCollection.files.find((file) => file.id === initialFileId)
      : undefined;
    const targetKey = `${targetCollection.id}:${targetFile?.id || ""}:${initialChunkIndex ?? ""}:${initialExcerpt || ""}`;
    if (locatedTargetRef.current === targetKey) return;
    locatedTargetRef.current = targetKey;
    setActiveCollectionId(targetCollection.id);
    setHighlightedFileId(targetFile?.id || null);
  }, [
    _hasHydrated,
    collections,
    initialChunkIndex,
    initialCollectionId,
    initialExcerpt,
    initialFileId,
  ]);

  useEffect(() => {
    if (!highlightedFileId || activeCollectionId === null) return;
    const frame = requestAnimationFrame(() => {
      highlightedFileRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    const timer = window.setTimeout(() => setHighlightedFileId(null), 3_500);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [activeCollectionId, highlightedFileId]);

  const setCopyFeedback = (status: Exclude<CopyStatus, "idle">) => {
    const controller =
      copyStatusResetRef.current ||
      createTimedStatusResetController<CopyStatus>({
        setStatus: setCopyStatus,
        resetValue: "idle",
      });
    copyStatusResetRef.current = controller;
    controller.set(status);
  };

  useEffect(() => {
    return () => copyStatusResetRef.current?.dispose();
  }, []);

  useEffect(() => {
    if (!viewingFileId) return;

    fileViewerPreviousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    fileViewerCloseButtonRef.current?.focus({ preventScroll: true });

    return () => {
      if (fileViewerPreviousFocusRef.current?.isConnected) {
        fileViewerPreviousFocusRef.current.focus({ preventScroll: true });
      }
      fileViewerPreviousFocusRef.current = null;
    };
  }, [viewingFileId]);

  const handleFileViewerKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setViewingFile(null);
      return;
    }

    if (event.key !== "Tab") return;

    const dialog = fileViewerDialogRef.current;
    if (!dialog) return;

    const focusableElements = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null);

    if (focusableElements.length === 0) {
      event.preventDefault();
      dialog.focus({ preventScroll: true });
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus({ preventScroll: true });
    }
  };

  const filteredCollections = collections.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.description.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleFileUpload = async (files: FileList | null) => {
    if (!isOnline || !files || !activeCollectionId) return;
    const fileArray = Array.from(files);
    const selection = selectKnowledgeFilesForUpload(
      activeCollection?.files.length || 0,
      fileArray,
    );
    setUploadNotice(getKnowledgeFileSelectionMessage(selection));

    if (selection.accepted.length > 0) {
      await uploadFiles(activeCollectionId, selection.accepted);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (!isOnline) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFileUpload(e.dataTransfer.files);
    }
  };

  const handleFileClick = useCallback(
    async (file: KnowledgeFile) => {
      try {
        let content = t("previewNotAvailable");
        const contentPath = file.contentPath || file.path;

        if (contentPath && isOPFSUrl(contentPath)) {
          const result = await withResolvedObjectUrl({
            source: contentPath,
            resolveObjectUrl: resolveOPFSUrl,
            read: async (blobUrl) => {
              const response = await fetch(blobUrl);
              if (response.ok) {
                return {
                  status: "loaded" as const,
                  content: await response.text(),
                };
              }
              return { status: "failed" as const };
            },
          });

          if (result?.status === "loaded") {
            content = result.content;
          } else if (result?.status === "failed") {
            content = t("loadFailed");
          } else {
            content = t("fileNotFound");
          }
        } else if (
          file.type.startsWith("text/") ||
          file.name.endsWith(".md") ||
          file.name.endsWith(".txt") ||
          file.name.endsWith(".json")
        ) {
          // Fallback message if path is missing but it's a text type (e.g. legacy or pure RAG upload without local save)
          content = t("previewNotAvailableLocal");
        }

        setViewingFile({
          id: file.id,
          collectionId: activeCollectionId!,
          name: file.name,
          originalContent: content,
        });
        setEditContent(content);
        setSaveError("");
      } catch (e) {
        logDevError("Failed to read file", e);
        const errText = t("errorReadingFile");
        setViewingFile({
          id: file.id,
          collectionId: activeCollectionId!,
          name: file.name,
          originalContent: errText,
        });
        setEditContent(errText);
        setSaveError("");
      }
    },
    [activeCollectionId, t],
  );

  useEffect(() => {
    if (!initialFileId || !activeCollection) return;
    const targetFile = activeCollection.files.find(
      (file) => file.id === initialFileId,
    );
    if (!targetFile) return;
    const targetKey = `${activeCollection.id}:${targetFile.id}:${initialChunkIndex ?? ""}:${initialExcerpt || ""}`;
    if (openedTargetRef.current === targetKey) return;
    openedTargetRef.current = targetKey;
    void handleFileClick(targetFile);
  }, [
    activeCollection,
    handleFileClick,
    initialChunkIndex,
    initialExcerpt,
    initialFileId,
  ]);

  useEffect(() => {
    const input = fileContentInputRef.current;
    if (!input || !viewingFile || !initialExcerpt) return;
    const normalizedExcerpt = initialExcerpt.trim().slice(0, 240);
    if (!normalizedExcerpt) return;
    const start = editContent.indexOf(normalizedExcerpt);
    if (start < 0) return;
    const end = start + normalizedExcerpt.length;
    const line = editContent.slice(0, start).split("\n").length - 1;
    requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      input.setSelectionRange(start, end);
      const lineHeight = Number.parseFloat(getComputedStyle(input).lineHeight);
      input.scrollTop = Math.max(0, line * (lineHeight || 20) - 80);
    });
  }, [editContent, initialExcerpt, viewingFile]);

  const handleDeleteFile = async (collectionId: string, fileId: string) => {
    if (!isOnline) return;
    try {
      await deleteFile(collectionId, fileId);
      setUploadNotice("");
    } catch (error) {
      logDevError("Failed to delete knowledge file", error);
      setUploadNotice(t("deleteFileFailed"));
    }
  };

  const handleSaveFile = async () => {
    if (!isOnline || !viewingFile) return;
    try {
      setSaveError("");
      await updateFileContent(
        viewingFile.collectionId,
        viewingFile.id,
        editContent,
      );
      setViewingFile((prev) =>
        prev ? { ...prev, originalContent: editContent } : null,
      );
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : t("saveChangesFailed"),
      );
    }
  };

  const handleReindexFile = async (
    collectionId: string,
    file: KnowledgeFile,
  ) => {
    if (!isOnline || reindexingFileId) return;

    setReindexingFileId(file.id);
    setUploadNotice("");
    try {
      await reindexFile(collectionId, file.id);
      setUploadNotice(t("reindexSuccess", { name: file.name }));
    } catch (error) {
      logDevError("Failed to rebuild knowledge file index", error);
      setUploadNotice(
        error instanceof Error ? error.message : t("reindexFailed"),
      );
    } finally {
      setReindexingFileId(null);
    }
  };

  const handleKnowledgeFileAction = async (
    file: KnowledgeFile,
    action: () => Promise<void>,
    successMessage?: string,
  ) => {
    if (!isOnline || busyFileId) return;
    setBusyFileId(file.id);
    setUploadNotice("");
    try {
      await action();
      if (successMessage) setUploadNotice(successMessage);
    } catch (error) {
      logDevError(`Knowledge file action failed: ${file.name}`, error);
      setUploadNotice(
        error instanceof Error ? error.message : t("fileActionFailed"),
      );
    } finally {
      setBusyFileId(null);
    }
  };

  const handleReparseFile = async (
    collectionId: string,
    file: KnowledgeFile,
    replacementSource?: File,
  ) => {
    if (!isOnline) return;
    if (
      file.contentEditedAt &&
      !window.confirm(t("confirmReparseEdited", { name: file.name }))
    ) {
      return;
    }
    await handleKnowledgeFileAction(
      file,
      () => reparseFile(collectionId, file.id, replacementSource),
      t("reparseSuccess", { name: file.name }),
    );
  };

  const downloadOriginalKnowledgeFile = async (file: KnowledgeFile) => {
    const sourcePath = getOriginalKnowledgeFilePath(file);
    if (!sourcePath) {
      throw new Error(t("batchDownloadUnavailable"));
    }

    const downloaded = await withResolvedObjectUrl({
      source: sourcePath,
      resolveObjectUrl: resolveOPFSUrl,
      read: async (objectUrl) => {
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = file.name;
        anchor.click();
        return true;
      },
    });
    if (!downloaded) {
      throw new Error(t("downloadOriginalFailed"));
    }
  };

  const handleDownloadOriginal = async (file: KnowledgeFile) => {
    try {
      await downloadOriginalKnowledgeFile(file);
    } catch (error) {
      logDevError("Failed to download original knowledge file", error);
      setUploadNotice(t("downloadOriginalFailed"));
    }
  };

  const handleFileSelection = (fileId: string, selected: boolean) => {
    setSelectedFileIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(fileId);
      } else {
        next.delete(fileId);
      }
      return next;
    });
  };

  const handleSelectVisibleFiles = (selected: boolean) => {
    setSelectedFileIds((current) => {
      const next = new Set(current);
      for (const file of filteredFiles) {
        if (selected) {
          next.add(file.id);
        } else {
          next.delete(file.id);
        }
      }
      return next;
    });
  };

  const handleBatchAction = async (action: KnowledgeBatchAction) => {
    if (!activeCollection || selectedFiles.length === 0 || isBatchRunning) {
      return;
    }
    if (!isOnline && action !== "download") return;

    const collectionId = activeCollection.id;
    const files = [...selectedFiles];
    setIsBatchRunning(true);
    setIsBatchDeleteConfirming(false);
    setUploadNotice("");
    setBatchResults([]);

    try {
      const results = await runKnowledgeFileBatch(
        files,
        async (file) => {
          switch (action) {
            case "retry":
              if (getKnowledgeFileStatusFilter(file) !== "error") {
                throw new Error(t("batchRetryUnavailable"));
              }
              await retryFile(collectionId, file.id);
              return;
            case "reindex":
              if (!(file.contentPath || file.path)) {
                throw new Error(t("batchReindexUnavailable"));
              }
              await reindexFile(collectionId, file.id);
              return;
            case "download":
              await downloadOriginalKnowledgeFile(file);
              return;
            case "delete":
              await deleteFile(collectionId, file.id);
          }
        },
        setBatchResults,
      );

      setBatchResults(results);
      if (action === "delete") {
        const deletedIds = new Set(
          results
            .filter((result) => result.status === "succeeded")
            .map((result) => result.fileId),
        );
        setSelectedFileIds((current) => {
          const next = new Set(current);
          deletedIds.forEach((fileId) => next.delete(fileId));
          return next;
        });
      }
    } finally {
      setIsBatchRunning(false);
    }
  };

  const handleReindexCollection = async () => {
    if (!isOnline || !activeCollection || isReindexingCollection) return;
    setIsReindexingCollection(true);
    setUploadNotice("");
    try {
      await reindexCollection(activeCollection.id);
      setUploadNotice(t("chunking.reindexComplete"));
    } catch (error) {
      logDevError("Failed to re-index knowledge collection", error);
      setUploadNotice(t("chunking.reindexFailed"));
    } finally {
      setIsReindexingCollection(false);
    }
  };

  const handleCopyContent = async () => {
    const copied = await copyTextToClipboard(editContent);
    setCopyFeedback(copied ? "copied" : "error");
  };

  // Derived State
  const isDirty = viewingFile && editContent !== viewingFile.originalContent;

  // Show loading state while hydrating
  if (!_hasHydrated) {
    return (
      <div className="flex flex-col h-full w-full relative overflow-hidden animate-in fade-in duration-300 bg-gray-50/50 dark:bg-background">
        <div className="flex h-full items-center justify-center">
          <div
            role="status"
            aria-live="polite"
            className="text-sm text-gray-500 dark:text-muted-foreground"
          >
            {t("loadingKnowledgeBase")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full relative overflow-hidden animate-in fade-in duration-300 bg-gray-50/50 dark:bg-background">
      {showNewModal && (
        <NewCollectionModal onClose={() => setShowNewModal(false)} />
      )}
      {editingCollection && (
        <EditCollectionModal
          collection={editingCollection}
          onClose={() => setEditingCollection(null)}
        />
      )}

      {/* File Viewer Modal */}
      {viewingFile &&
        createPortal(
          <div
            ref={fileViewerDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={fileViewerTitleId}
            tabIndex={-1}
            onKeyDown={handleFileViewerKeyDown}
            className="fixed inset-0 z-9999 overflow-y-auto bg-white animate-in fade-in duration-300 dark:bg-background"
          >
            <div className="max-w-5xl mx-auto p-4 min-h-screen relative flex flex-col">
              <div className="mb-4 pb-2 border-b border-gray-100 dark:border-border flex items-center justify-between shrink-0">
                <h2
                  id={fileViewerTitleId}
                  className="flex items-center gap-2 overflow-hidden text-base font-semibold text-gray-700 dark:text-foreground"
                >
                  <FileText
                    size={20}
                    className="shrink-0 text-blue-500"
                    aria-hidden="true"
                  />
                  <span className="truncate">{viewingFile.name}</span>
                  {isDirty && isOnline && (
                    <span className="text-xs text-gray-400 font-normal ml-1 shrink-0">
                      ({t("edited")})
                    </span>
                  )}
                </h2>
                <div className="flex items-center gap-2">
                  {isDirty && (
                    <Button
                      variant="bare"
                      type="button"
                      aria-label={t("saveChangesAria", {
                        name: viewingFile.name,
                      })}
                      onClick={handleSaveFile}
                      className="flex items-center gap-1.5 rounded-lg bg-blue-50/50 px-3 py-1.5 text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:bg-blue-900/10 dark:text-blue-400 dark:hover:bg-blue-900/20 dark:hover:text-blue-300"
                    >
                      <Save size={16} aria-hidden="true" />
                      <span className="text-xs font-medium">{t("save")}</span>
                    </Button>
                  )}

                  <Button
                    variant="bare"
                    type="button"
                    aria-label={
                      isCopied
                        ? t("copiedContentAria", { name: viewingFile.name })
                        : copyStatus === "error"
                          ? t("copyFailedAria", { name: viewingFile.name })
                          : t("copyContentAria", { name: viewingFile.name })
                    }
                    onClick={handleCopyContent}
                    className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
                  >
                    {isCopied ? (
                      <Check
                        size={18}
                        className="text-green-500"
                        aria-hidden="true"
                      />
                    ) : copyStatus === "error" ? (
                      <X
                        size={18}
                        className="text-red-500"
                        aria-hidden="true"
                      />
                    ) : (
                      <Copy size={18} aria-hidden="true" />
                    )}
                    <span className="sr-only" aria-live="polite">
                      {isCopied
                        ? t("copied")
                        : copyStatus === "error"
                          ? t("copyFailed")
                          : t("copyContent")}
                    </span>
                  </Button>
                  <Button
                    variant="bare"
                    ref={fileViewerCloseButtonRef}
                    type="button"
                    aria-label={t("closeFileViewer")}
                    onClick={() => setViewingFile(null)}
                    className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
                  >
                    <X size={20} aria-hidden="true" />
                  </Button>
                </div>
              </div>

              <div className="flex-1 grid overflow-hidden custom-scrollbar bg-gray-50 dark:bg-card rounded-lg border border-gray-200 dark:border-border">
                <label htmlFor={fileContentInputId} className="sr-only">
                  {t("fileContentLabel")}
                </label>
                <textarea
                  ref={fileContentInputRef}
                  id={fileContentInputId}
                  name="knowledge-file-content"
                  className="h-full w-full resize-none rounded-lg border-none bg-transparent p-4 font-mono text-sm leading-relaxed text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:text-foreground custom-scrollbar"
                  value={editContent}
                  readOnly={!isOnline}
                  onChange={(e) => setEditContent(e.target.value)}
                  spellCheck={false}
                />
              </div>
              {saveError && (
                <div
                  role="alert"
                  className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
                >
                  <AlertCircle
                    size={14}
                    className="mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{saveError}</span>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}

      {/* Header */}
      <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-gray-200/50 bg-white/40 px-6 py-4 backdrop-blur-md dark:border-border dark:bg-card/40">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-tr from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/20"
            aria-hidden="true"
          >
            <LibraryBig size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="flex min-w-0 items-center gap-2 text-lg font-bold text-gray-800 dark:text-foreground">
              {activeCollection ? (
                <>
                  <Button
                    variant="bare"
                    type="button"
                    aria-label={t("backToCollectionsAria")}
                    className="shrink-0 rounded opacity-50 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    onClick={() => setActiveCollectionId(null)}
                  >
                    {t("title")}
                  </Button>
                  <ChevronRight
                    size={16}
                    className="shrink-0 text-gray-400"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 truncate">
                    {activeCollection.name}
                  </span>
                </>
              ) : (
                <span className="truncate">{t("title")}</span>
              )}
            </h1>
            <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-muted-foreground">
              {activeCollection
                ? activeCollection.description || t("manageDocsSubtitle")
                : t("manageCollectionsSubtitle")}
            </p>
          </div>
        </div>
        {onClose && (
          <Button
            variant="bare"
            type="button"
            aria-label={t("closeKnowledgeBase")}
            onClick={onClose}
            className="shrink-0 rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-200/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60 dark:text-muted-foreground dark:hover:bg-accent/50"
          >
            <X size={20} aria-hidden="true" />
          </Button>
        )}
      </div>

      {!isOnline ? (
        <div
          role="status"
          className="mx-4 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
        >
          {t("offlineReadOnly")}
        </div>
      ) : null}

      {/* Search Bar & Filter - Only on Index View */}
      {!activeCollection && (
        <div className="mx-auto flex w-full max-w-7xl shrink-0 gap-3 px-6 pb-6 pt-6">
          <div className="group relative min-w-0 flex-1">
            <div className="absolute inset-0 bg-purple-500/20 dark:bg-purple-500/10 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="relative flex items-center rounded-2xl border border-gray-200 bg-white/60 px-4 py-3 shadow-sm backdrop-blur-xl transition-[border-color,box-shadow] focus-within:border-purple-500/50 focus-within:ring-2 focus-within:ring-purple-500/30 dark:border-border dark:bg-muted/60">
              <label htmlFor={collectionSearchInputId} className="sr-only">
                {t("searchCollectionsLabel")}
              </label>
              <Search
                size={20}
                className="mr-3 text-gray-400"
                aria-hidden="true"
              />
              <input
                id={collectionSearchInputId}
                type="text"
                name="knowledge-collection-search"
                autoComplete="off"
                spellCheck={false}
                placeholder={t("searchCollectionsPlaceholder")}
                className="min-w-0 flex-1 border-none bg-transparent text-base text-gray-800 outline-none placeholder-gray-400 dark:text-foreground"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div
        className={`flex-1 overflow-y-auto px-4 ${activeCollection ? "py-6" : "pb-10"} custom-scrollbar`}
      >
        <div className="max-w-7xl mx-auto flex flex-col min-h-full">
          {!activeCollection ? (
            <>
              {/* Grid View */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500 content-start">
                {/* Special "Create New" Card */}
                <CreateCollectionCard
                  onClick={() => setShowNewModal(true)}
                  disabled={!isOnline}
                />

                {/* Collection Cards */}
                {filteredCollections.map((c) => (
                  <CollectionCard
                    key={c.id}
                    collection={c}
                    onClick={() => setActiveCollectionId(c.id)}
                    readOnly={!isOnline}
                    onEdit={(e) => {
                      e.stopPropagation();
                      setEditingCollection(c);
                    }}
                  />
                ))}
              </div>

              {filteredCollections.length === 0 && searchTerm && (
                <div className="text-center py-20 text-gray-400">
                  <p>{t("noCollectionsMatch", { term: searchTerm })}</p>
                </div>
              )}
            </>
          ) : (
            <div className="animate-in fade-in slide-in-from-right-8 duration-300">
              {/* Collection Detail View */}
              <div className="flex flex-col gap-6">
                {activeCollection.files.some(
                  (file) =>
                    (file.contentPath || file.path) &&
                    (file.indexStatus || file.status) !== "indexed",
                ) ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3 dark:border-blue-900/60 dark:bg-blue-950/20">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                        {t("chunking.pendingTitle")}
                      </div>
                      <p className="mt-0.5 text-xs text-blue-700/80 dark:text-blue-300/80">
                        {t("chunking.pendingDescription")}
                      </p>
                    </div>
                    <Button
                      variant="bare"
                      type="button"
                      onClick={() => void handleReindexCollection()}
                      disabled={
                        !isOnline || !rag.enabled || isReindexingCollection
                      }
                      className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw
                        size={14}
                        aria-hidden="true"
                        className={isReindexingCollection ? "animate-spin" : ""}
                      />
                      {t("chunking.reindexAll")}
                    </Button>
                  </div>
                ) : null}
                {/* Upload Zone */}
                <div
                  role="region"
                  aria-labelledby={uploadTitleId}
                  aria-describedby={`${uploadDescriptionId} ${uploadLimitsId}${uploadNotice ? ` ${uploadNoticeId}` : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`
                                        border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center text-center transition-[border-color,background-color,transform] duration-300 group relative overflow-hidden
                                        ${
                                          isDragging
                                            ? "border-purple-500 bg-purple-50 dark:bg-purple-900/10 scale-[1.01]"
                                            : "border-gray-300 dark:border-border hover:border-purple-400 dark:hover:border-purple-600 bg-white/50 dark:bg-muted/20"
                                        }
                                    `}
                >
                  <input
                    id={uploadInputId}
                    type="file"
                    name="knowledge-files"
                    multiple
                    ref={fileInputRef}
                    disabled={!isOnline}
                    className="sr-only"
                    tabIndex={-1}
                    aria-label={t("knowledgeFilesAria")}
                    aria-describedby={`${uploadDescriptionId} ${uploadLimitsId}`}
                    onChange={(e) => void handleFileUpload(e.target.files)}
                  />
                  <Button
                    variant="bare"
                    type="button"
                    disabled={!isOnline}
                    onClick={() => fileInputRef.current?.click()}
                    aria-describedby={`${uploadDescriptionId} ${uploadLimitsId}`}
                    className="group/upload flex max-w-full flex-col items-center rounded-xl px-4 py-3 text-center transition-[background-color,box-shadow] hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:hover:bg-muted/50 dark:focus-visible:ring-offset-background"
                  >
                    <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-gray-100 bg-white text-purple-500 shadow-sm transition-[transform,box-shadow] duration-300 group-hover/upload:scale-110 group-hover/upload:shadow-md dark:border-border dark:bg-muted">
                      <UploadCloud size={32} aria-hidden="true" />
                    </span>
                    <span
                      id={uploadTitleId}
                      className="mb-1 text-base font-bold text-gray-800 dark:text-foreground"
                    >
                      {t("chooseFiles")}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-muted-foreground">
                      {t("chooseFilesHint")}
                    </span>
                  </Button>
                  <p
                    id={uploadDescriptionId}
                    className="mt-3 max-w-sm text-xs leading-relaxed text-gray-500 dark:text-muted-foreground"
                  >
                    {rag.enabled
                      ? t("uploadSupportedRag")
                      : t("uploadSupportedPlain")}
                  </p>
                  <p
                    id={uploadLimitsId}
                    className="mt-2 text-[11px] text-gray-400 dark:text-muted-foreground/70"
                  >
                    {t("uploadLimits", {
                      max: KNOWLEDGE_LIMITS.maxFilesPerCollection,
                      size: formatLimitBytes(KNOWLEDGE_LIMITS.maxFileBytes),
                    })}
                  </p>
                </div>

                {uploadNotice && (
                  <div
                    id={uploadNoticeId}
                    role="status"
                    aria-live="polite"
                    className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                  >
                    <AlertCircle
                      size={14}
                      className="mt-0.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="leading-relaxed">{uploadNotice}</span>
                  </div>
                )}

                {/* File List */}
                <div className="bg-white dark:bg-card/50 border border-gray-200 dark:border-border rounded-xl overflow-hidden">
                  <div
                    aria-busy={isBatchRunning || undefined}
                    className="border-b border-gray-100 bg-gray-50/80 p-4 backdrop-blur-sm dark:border-border dark:bg-muted/80"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="min-w-0 truncate text-sm font-bold text-gray-700 dark:text-foreground">
                        {t("documentsHeading", {
                          count: activeCollection.files.length,
                        })}
                      </h3>
                      {(fileSearchTerm || fileStatusFilter !== "all") && (
                        <span className="text-xs text-gray-500 dark:text-muted-foreground">
                          {t("filteredDocumentsCount", {
                            count: filteredFiles.length,
                          })}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
                      <div className="relative min-w-0">
                        <label htmlFor={fileSearchInputId} className="sr-only">
                          {t("searchFilesLabel")}
                        </label>
                        <Search
                          size={15}
                          aria-hidden="true"
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                        />
                        <input
                          id={fileSearchInputId}
                          type="search"
                          name="knowledge-file-search"
                          autoComplete="off"
                          spellCheck={false}
                          value={fileSearchTerm}
                          onChange={(event) =>
                            setFileSearchTerm(event.target.value)
                          }
                          placeholder={t("searchFilesPlaceholder")}
                          className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-800 outline-none transition-[border-color,box-shadow] placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-border dark:bg-background dark:text-foreground"
                        />
                      </div>
                      <div>
                        <label htmlFor={fileStatusFilterId} className="sr-only">
                          {t("fileStatusFilterLabel")}
                        </label>
                        <select
                          id={fileStatusFilterId}
                          value={fileStatusFilter}
                          onChange={(event) =>
                            setFileStatusFilter(
                              event.target.value as KnowledgeFileStatusFilter,
                            )
                          }
                          className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none transition-[border-color,box-shadow] focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-border dark:bg-background dark:text-foreground"
                        >
                          <option value="all">{t("fileStatusAll")}</option>
                          <option value="ready">{t("fileStatusReady")}</option>
                          <option value="processing">
                            {t("fileStatusProcessing")}
                          </option>
                          <option value="error">{t("fileStatusError")}</option>
                        </select>
                      </div>
                    </div>

                    {activeCollection.files.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-200/70 pt-3 dark:border-border">
                        <label className="mr-auto inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-lg px-2 text-xs font-medium text-gray-600 hover:bg-white focus-within:ring-2 focus-within:ring-blue-500/50 dark:text-muted-foreground dark:hover:bg-background">
                          <input
                            ref={selectVisibleFilesRef}
                            type="checkbox"
                            checked={allVisibleFilesSelected}
                            disabled={
                              filteredFiles.length === 0 || isBatchRunning
                            }
                            onChange={(event) =>
                              handleSelectVisibleFiles(event.target.checked)
                            }
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-muted"
                          />
                          <span>
                            {t("selectVisibleFiles", {
                              count: filteredFiles.length,
                            })}
                          </span>
                        </label>

                        {selectedFiles.length > 0 && (
                          <>
                            <span
                              role="status"
                              className="w-full text-xs font-medium text-blue-700 dark:text-blue-300 sm:w-auto"
                            >
                              {t("selectedFilesCount", {
                                count: selectedFiles.length,
                              })}
                            </span>
                            {isBatchRunning && (
                              <span
                                role="status"
                                aria-live="polite"
                                className="text-xs text-gray-500 dark:text-muted-foreground"
                              >
                                {t("batchRunning")}
                              </span>
                            )}
                            <Button
                              variant="bare"
                              type="button"
                              disabled={isBatchRunning}
                              onClick={() => setSelectedFileIds(new Set())}
                              className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-gray-500 transition-colors hover:bg-white hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-muted-foreground dark:hover:bg-background dark:hover:text-foreground"
                            >
                              <X size={13} aria-hidden="true" />
                              {t("clearSelection")}
                            </Button>
                            <Button
                              variant="bare"
                              type="button"
                              disabled={
                                !isOnline || isBatchRunning || !canRetrySelected
                              }
                              onClick={() => void handleBatchAction("retry")}
                              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 transition-colors hover:border-blue-200 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-background dark:text-foreground"
                            >
                              <RotateCcw size={14} aria-hidden="true" />
                              {t("batchRetry")}
                            </Button>
                            <Button
                              variant="bare"
                              type="button"
                              disabled={
                                !isOnline ||
                                isBatchRunning ||
                                !canReindexSelected
                              }
                              onClick={() => void handleBatchAction("reindex")}
                              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 transition-colors hover:border-blue-200 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-background dark:text-foreground"
                            >
                              <RefreshCw size={14} aria-hidden="true" />
                              {t("batchReindex")}
                            </Button>
                            <Button
                              variant="bare"
                              type="button"
                              disabled={isBatchRunning || !canDownloadSelected}
                              onClick={() => void handleBatchAction("download")}
                              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 transition-colors hover:border-blue-200 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-background dark:text-foreground"
                            >
                              <Download size={14} aria-hidden="true" />
                              {t("batchDownload")}
                            </Button>
                            <Button
                              variant="bare"
                              type="button"
                              disabled={!isOnline || isBatchRunning}
                              onClick={() => setIsBatchDeleteConfirming(true)}
                              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/60 dark:bg-background dark:text-red-300 dark:hover:bg-red-950/30"
                            >
                              <Trash2 size={14} aria-hidden="true" />
                              {t("batchDelete")}
                            </Button>
                          </>
                        )}
                      </div>
                    )}

                    {isBatchDeleteConfirming && (
                      <div
                        role="alert"
                        className="mt-3 flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100 sm:flex-row sm:items-center"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">
                            {t("confirmBatchDelete", {
                              count: selectedFiles.length,
                            })}
                          </p>
                          <p className="mt-0.5 text-xs text-red-700 dark:text-red-200/80">
                            {t("confirmBatchDeleteDescription")}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            variant="bare"
                            type="button"
                            onClick={() => setIsBatchDeleteConfirming(false)}
                            className="min-h-8 rounded-lg px-3 text-xs font-medium text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 dark:text-red-200 dark:hover:bg-red-900/40"
                          >
                            {t("cancel")}
                          </Button>
                          <Button
                            variant="bare"
                            ref={batchDeleteConfirmRef}
                            type="button"
                            onClick={() => void handleBatchAction("delete")}
                            className="min-h-8 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-red-50 dark:focus-visible:ring-offset-red-950"
                          >
                            {t("confirmBatchDeleteAction")}
                          </Button>
                        </div>
                      </div>
                    )}

                    {batchResults.length > 0 && (
                      <div
                        role="status"
                        aria-live="polite"
                        className="mt-3 rounded-lg border border-gray-200 bg-white p-3 text-xs dark:border-border dark:bg-background"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-gray-700 dark:text-foreground">
                            {t("batchResultSummary", {
                              success: batchResults.filter(
                                (result) => result.status === "succeeded",
                              ).length,
                              failed: batchResults.filter(
                                (result) => result.status === "failed",
                              ).length,
                            })}
                          </p>
                          <Button
                            variant="bare"
                            type="button"
                            aria-label={t("dismissBatchResults")}
                            onClick={() => setBatchResults([])}
                            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 dark:hover:bg-muted dark:hover:text-foreground"
                          >
                            <X size={14} aria-hidden="true" />
                          </Button>
                        </div>
                        <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto custom-scrollbar">
                          {batchResults.map((result) => (
                            <li
                              key={result.fileId}
                              className="flex items-start gap-2 rounded-md px-2 py-1.5 text-gray-600 dark:text-muted-foreground"
                            >
                              {result.status === "succeeded" ? (
                                <Check
                                  size={14}
                                  aria-hidden="true"
                                  className="mt-0.5 shrink-0 text-green-600 dark:text-green-400"
                                />
                              ) : (
                                <AlertCircle
                                  size={14}
                                  aria-hidden="true"
                                  className="mt-0.5 shrink-0 text-red-600 dark:text-red-400"
                                />
                              )}
                              <span className="min-w-0">
                                <span className="font-medium text-gray-700 dark:text-foreground">
                                  {result.fileName}
                                </span>
                                <span className="ml-2">
                                  {result.status === "succeeded"
                                    ? t("batchSucceeded")
                                    : result.error || t("fileActionFailed")}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  <div className="p-1">
                    {activeCollection.files.length > 0 ? (
                      filteredFiles.length > 0 ? (
                        <div className="space-y-1">
                          {filteredFiles.map((file) => (
                            <FileRow
                              key={file.id}
                              file={file}
                              rowRef={
                                highlightedFileId === file.id
                                  ? highlightedFileRef
                                  : undefined
                              }
                              isHighlighted={highlightedFileId === file.id}
                              onClick={() => handleFileClick(file)}
                              onDelete={() =>
                                handleDeleteFile(activeCollection.id, file.id)
                              }
                              onReindex={
                                file.contentPath || file.path
                                  ? () =>
                                      handleReindexFile(
                                        activeCollection.id,
                                        file,
                                      )
                                  : undefined
                              }
                              onCancel={
                                file.storageStatus === "uploading" ||
                                file.storageStatus === "parsing" ||
                                file.status === "uploading" ||
                                file.status === "parsing"
                                  ? () =>
                                      handleKnowledgeFileAction(file, () =>
                                        cancelUpload(
                                          activeCollection.id,
                                          file.id,
                                        ),
                                      )
                                  : undefined
                              }
                              onRetry={
                                file.storageStatus === "error" ||
                                file.indexStatus === "error" ||
                                file.status === "error"
                                  ? () =>
                                      handleKnowledgeFileAction(
                                        file,
                                        () =>
                                          retryFile(
                                            activeCollection.id,
                                            file.id,
                                          ),
                                        t("retrySuccess", { name: file.name }),
                                      )
                                  : undefined
                              }
                              onReparse={
                                file.contentKind === "extracted_text" &&
                                file.sourcePath &&
                                !file.sourceMissing
                                  ? () =>
                                      handleReparseFile(
                                        activeCollection.id,
                                        file,
                                      )
                                  : undefined
                              }
                              onReplaceSource={
                                file.contentKind === "extracted_text" &&
                                (!file.sourcePath || file.sourceMissing)
                                  ? (replacement) =>
                                      handleReparseFile(
                                        activeCollection.id,
                                        file,
                                        replacement,
                                      )
                                  : undefined
                              }
                              onDownloadOriginal={
                                getOriginalKnowledgeFilePath(file)
                                  ? () => handleDownloadOriginal(file)
                                  : undefined
                              }
                              isReindexing={reindexingFileId === file.id}
                              isBusy={isBatchRunning || busyFileId === file.id}
                              isSelected={selectedFileIds.has(file.id)}
                              onSelectedChange={(selected) =>
                                handleFileSelection(file.id, selected)
                              }
                              selectionDisabled={isBatchRunning}
                              readOnly={!isOnline || isBatchRunning}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="flex h-36 flex-col items-center justify-center gap-2 px-4 text-center text-gray-400">
                          <Search size={22} aria-hidden="true" />
                          <p className="text-sm font-medium">
                            {t("noFilesMatch")}
                          </p>
                        </div>
                      )
                    ) : (
                      <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2">
                        <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-muted flex items-center justify-center">
                          <FileText size={24} className="opacity-50" />
                        </div>
                        <p className="text-sm font-medium">
                          {t("noDocuments")}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default KnowledgeBase;
