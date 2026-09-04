"use client";
import React, { useState, useRef, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Save,
  FolderCog,
  Trash2,
  FileText,
  Link,
  UploadCloud,
  LibraryBig,
  Globe,
  Lightbulb,
  Cable,
  Check,
  Loader2,
  Sparkles,
  ScrollText,
  AlertTriangle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Workspace, Attachment } from "@/types";
import { useKnowledgeStore } from "@/store/core/knowledgeStore";
import { useChatStore } from "@/store/core/chatStore";
import { useSettingsStore, getTaskModel } from "@/store/core/settingsStore";
import { v7 as uuidv7 } from "uuid";
import { SimpleSwitch } from "@/components/ui/controls";
import { optimizeSystemPrompt } from "@/services/artifactService";
import { streamGenerateContent } from "@/services/api/chatService";
import { deleteFromOPFS, saveToOPFS } from "@/utils/opfs";
import SafeImage from "@/components/ui/SafeImage";
import { createStreamingReplacement } from "@/lib/utils/streamingText";
import {
  getWorkspaceFileSelectionMessage,
  selectWorkspaceFilesForUpload,
} from "@/lib/utils/workspaceFiles";
import { ATTACHMENT_LIMITS, CHAT_ENTITY_LIMITS } from "@/config/limits";
import { normalizePluginIdRefs } from "@/lib/plugin/config";
import { normalizeSkillIdRefs } from "@/lib/skills";
import { localizePluginMeta } from "@/lib/plugin/localizedMeta";
import { logDevError } from "@/lib/utils/devLogger";
import {
  compressImageFile,
  getImageCompressionConfig,
} from "@/lib/utils/imageCompression";
import { Button } from "@/components/ui/primitives";
import ResearchTemplatePicker from "@/components/research/ResearchTemplatePicker";
import type { ResearchTemplateSelection } from "@/lib/research/templates";

interface WorkspaceSettingsModalProps {
  onClose: () => void;
  workspace?: Workspace;
}

const WORKSPACE_COLORS = [
  { name: "blue", class: "bg-blue-500", text: "text-blue-500" },
  { name: "purple", class: "bg-purple-500", text: "text-purple-500" },
  { name: "green", class: "bg-green-500", text: "text-green-500" },
  { name: "orange", class: "bg-orange-500", text: "text-orange-500" },
  { name: "red", class: "bg-red-500", text: "text-red-500" },
  { name: "pink", class: "bg-pink-500", text: "text-pink-500" },
  { name: "cyan", class: "bg-cyan-500", text: "text-cyan-500" },
  { name: "gray", class: "bg-gray-500", text: "text-gray-500" },
];

type PendingWorkspaceAction = "save" | "delete" | "close" | null;

async function cleanupWorkspaceUploadUrls(urls: Iterable<string | undefined>) {
  const uniqueUrls = Array.from(
    new Set(Array.from(urls).filter((url): url is string => !!url)),
  );
  const cleanedUrls = new Set<string>();

  const results = await Promise.allSettled(
    uniqueUrls.map((url) => deleteFromOPFS(url)),
  );

  results.forEach((result, index) => {
    const url = uniqueUrls[index];
    if (result.status === "fulfilled") {
      cleanedUrls.add(url);
      return;
    }

    logDevError("Failed to clean up workspace upload", url, result.reason);
  });

  return cleanedUrls;
}

const WorkspaceSettingsModal: React.FC<WorkspaceSettingsModalProps> = ({
  onClose,
  workspace,
}) => {
  const t = useTranslations("Workspace");
  const tConfig = useTranslations("Config");
  const tResearchTemplates = useTranslations("ResearchTemplates");
  const { createWorkspace, updateWorkspace, deleteWorkspace } = useChatStore();
  const { collections } = useKnowledgeStore();
  const { installedPlugins, installedSkills, system } = useSettingsStore();

  const [workspaceId] = useState(workspace?.id || uuidv7());
  const [name, setName] = useState(workspace?.name || "");
  const [systemPrompt, setSystemPrompt] = useState(
    workspace?.systemPrompt || "",
  );
  const [selectedKBIds, setSelectedKBIds] = useState<Set<string>>(
    new Set(workspace?.knowledgeCollectionIds || []),
  );
  const [files, setFiles] = useState<Attachment[]>(workspace?.files || []);
  const [selectedColor, setSelectedColor] = useState(
    workspace?.color || "blue",
  );
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [optimizeError, setOptimizeError] = useState("");
  const [fileUploadError, setFileUploadError] = useState("");
  const [pendingAction, setPendingAction] =
    useState<PendingWorkspaceAction>(null);
  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false);
  const isMountedRef = useRef(true);
  const optimizeRunRef = useRef(0);
  const fileUploadRunRef = useRef(0);
  const uploadedFileUrlsRef = useRef<Set<string>>(new Set());
  const deleteConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // New Presets
  const [enableSearch, setEnableSearch] = useState(
    workspace?.enableSearch || false,
  );
  const [enableReasoning, setEnableReasoning] = useState(
    workspace?.enableReasoning || false,
  );
  const [activePlugins, setActivePlugins] = useState<string[]>(
    normalizePluginIdRefs(
      workspace?.activePlugins,
      installedPlugins.map((plugin) => plugin.id),
    ),
  );
  const [activeSkills, setActiveSkills] = useState<string[]>(
    normalizeSkillIdRefs(workspace?.activeSkills, installedSkills),
  );
  const [researchTemplate, setResearchTemplate] =
    useState<ResearchTemplateSelection>(workspace?.researchTemplate);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const modalId = useId();
  const titleId = `${modalId}-title`;
  const nameInputId = `${modalId}-name`;
  const colorGroupId = `${modalId}-color`;
  const systemPromptInputId = `${modalId}-system-prompt`;
  const presetGroupId = `${modalId}-preset-parameters`;
  const pluginGroupId = `${modalId}-plugins`;
  const skillGroupId = `${modalId}-skills`;
  const knowledgeGroupId = `${modalId}-knowledge`;
  const fileGroupId = `${modalId}-files`;
  const fileInputId = `${modalId}-file-input`;
  const fileUploadStatusId = `${modalId}-file-upload-status`;
  const optimizeErrorId = `${modalId}-optimize-error`;
  const isActionPending = pendingAction !== null;
  const trimmedName = name.trim();

  const researchTemplateText = (key: string, fallback: string) => {
    try {
      return tResearchTemplates.has(key)
        ? tResearchTemplates(key as never)
        : fallback;
    } catch {
      return fallback;
    }
  };

  const clearDeleteConfirmation = () => {
    if (deleteConfirmTimerRef.current) {
      clearTimeout(deleteConfirmTimerRef.current);
      deleteConfirmTimerRef.current = null;
    }
    setIsDeleteConfirming(false);
  };

  const cleanupPendingUploadUrls = async (
    urls: Iterable<string | undefined> = uploadedFileUrlsRef.current,
  ) => {
    const cleanedUrls = await cleanupWorkspaceUploadUrls(urls);
    cleanedUrls.forEach((url) => uploadedFileUrlsRef.current.delete(url));
  };

  const releaseCommittedUploadUrls = (committedFiles: Attachment[]) => {
    const committedUrls = new Set(
      committedFiles
        .map((file) => file.url)
        .filter((url): url is string => !!url),
    );

    committedUrls.forEach((url) => uploadedFileUrlsRef.current.delete(url));
  };

  useEffect(() => {
    isMountedRef.current = true;
    const uploadedFileUrls = uploadedFileUrlsRef.current;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    nameInputRef.current?.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      isMountedRef.current = false;
      optimizeRunRef.current += 1;
      fileUploadRunRef.current += 1;
      if (deleteConfirmTimerRef.current) {
        clearTimeout(deleteConfirmTimerRef.current);
        deleteConfirmTimerRef.current = null;
      }
      const pendingUploadUrls = Array.from(uploadedFileUrls);
      uploadedFileUrls.clear();
      void cleanupWorkspaceUploadUrls(pendingUploadUrls);
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus({ preventScroll: true });
      }
      previousFocusRef.current = null;
    };
  }, []);

  useEffect(() => {
    optimizeRunRef.current += 1;
    setOptimizeError("");
    setIsOptimizing(false);
  }, [workspaceId]);

  const handleSubmit = async () => {
    if (!trimmedName || isActionPending || isUploadingFiles) {
      if (!trimmedName) {
        nameInputRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    clearDeleteConfirmation();
    setPendingAction("save");
    setFileUploadError("");

    const data = {
      id: workspaceId,
      name: trimmedName,
      systemPrompt,
      knowledgeCollectionIds: Array.from(selectedKBIds) as string[],
      files,
      color: selectedColor,
      enableSearch,
      enableReasoning,
      activePlugins: normalizePluginIdRefs(
        activePlugins,
        installedPlugins.map((plugin) => plugin.id),
      ),
      activeSkills: normalizeSkillIdRefs(activeSkills, installedSkills),
      ...(researchTemplate !== undefined ? { researchTemplate } : {}),
    };

    try {
      if (workspace) {
        await updateWorkspace(workspace.id, data);
      } else {
        createWorkspace(data);
      }

      releaseCommittedUploadUrls(files);
      await cleanupPendingUploadUrls();
      onClose();
    } catch (error) {
      logDevError("Failed to save workspace", error);
      if (isMountedRef.current) {
        setFileUploadError(t("saveFailed"));
        setPendingAction(null);
      }
    }
  };

  const handleFileUpload = async (fileList: FileList | null) => {
    if (!fileList || isActionPending) return;
    const runId = fileUploadRunRef.current + 1;
    fileUploadRunRef.current = runId;
    setIsUploadingFiles(true);
    setFileUploadError("");

    try {
      const selection = selectWorkspaceFilesForUpload(
        files.length,
        Array.from(fileList),
      );
      const newFiles: Attachment[] = [];
      let failedCount = 0;
      const cleanupNewFiles = async () => {
        await cleanupWorkspaceUploadUrls(newFiles.map((file) => file.url));
      };

      for (const file of selection.accepted) {
        try {
          const preparedFile = file.type.startsWith("image/")
            ? await compressImageFile(file, getImageCompressionConfig(system))
            : file;
          // Save to OPFS workspace folder
          const url = await saveToOPFS(
            preparedFile,
            `workspaces/${workspaceId}`,
          );
          if (!isMountedRef.current || fileUploadRunRef.current !== runId) {
            await cleanupWorkspaceUploadUrls([url]);
            await cleanupNewFiles();
            return;
          }

          newFiles.push({
            id: uuidv7(),
            fileName: preparedFile.name,
            mimeType: preparedFile.type || "application/octet-stream",
            url: url, // Store OPFS URL
            data: undefined, // No base64
          });
        } catch (e) {
          if (!isMountedRef.current || fileUploadRunRef.current !== runId) {
            await cleanupNewFiles();
            return;
          }
          logDevError("Failed to save workspace file to OPFS", e);
          failedCount += 1;
        }
      }

      if (!isMountedRef.current || fileUploadRunRef.current !== runId) {
        await cleanupNewFiles();
        return;
      }

      const selectionMessage = getWorkspaceFileSelectionMessage(selection);
      const failureMessage =
        failedCount > 0 ? t("saveFilesFailed", { count: failedCount }) : "";

      setFileUploadError(
        [selectionMessage, failureMessage].filter(Boolean).join(" "),
      );

      if (newFiles.length > 0) {
        newFiles.forEach((file) => {
          if (file.url) {
            uploadedFileUrlsRef.current.add(file.url);
          }
        });
        setFiles((prev) => [...prev, ...newFiles]);
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } finally {
      if (isMountedRef.current && fileUploadRunRef.current === runId) {
        setIsUploadingFiles(false);
      }
    }
  };

  const handleRemoveFile = (file: Attachment) => {
    setFiles((prev) => prev.filter((f) => f.id !== file.id));
    if (file.url && uploadedFileUrlsRef.current.has(file.url)) {
      void cleanupPendingUploadUrls([file.url]);
    }
  };

  const handleCloseRequest = async () => {
    if (isActionPending) return;
    clearDeleteConfirmation();
    setPendingAction("close");
    fileUploadRunRef.current += 1;
    setIsUploadingFiles(false);
    await cleanupPendingUploadUrls();
    onClose();
  };

  const handleDeleteWorkspace = async () => {
    if (!workspace || isActionPending) return;
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
    setPendingAction("delete");
    fileUploadRunRef.current += 1;
    setIsUploadingFiles(false);
    setFileUploadError("");

    try {
      await deleteWorkspace(workspace.id);
      await cleanupPendingUploadUrls();
      onClose();
    } catch (error) {
      logDevError("Failed to delete workspace", error);
      if (isMountedRef.current) {
        setFileUploadError(t("deleteFailed"));
        setPendingAction(null);
      }
    }
  };

  const handleModalKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      void handleCloseRequest();
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

  const toggleKB = (id: string) => {
    const newSet = new Set(selectedKBIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedKBIds(newSet);
  };

  const togglePlugin = (id: string) => {
    if (!installedPlugins.some((plugin) => plugin.id === id)) return;

    setActivePlugins((prev) =>
      normalizePluginIdRefs(
        prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
        installedPlugins.map((plugin) => plugin.id),
      ),
    );
  };

  const toggleSkill = (id: string) => {
    if (!installedSkills.some((skill) => skill.id === id)) return;

    setActiveSkills((prev) =>
      normalizeSkillIdRefs(
        prev.includes(id)
          ? prev.filter((skillId) => skillId !== id)
          : [...prev, id],
        installedSkills,
      ),
    );
  };

  const handleOptimize = async () => {
    if (!systemPrompt.trim() || isOptimizing) return;
    const runId = optimizeRunRef.current + 1;
    optimizeRunRef.current = runId;
    setIsOptimizing(true);
    setOptimizeError("");
    const originalSystemPrompt = systemPrompt;
    const replacement = createStreamingReplacement(originalSystemPrompt);
    const prompt = optimizeSystemPrompt(systemPrompt);
    const model = getTaskModel("promptOptimization");

    try {
      await streamGenerateContent(model, prompt, (chunk) => {
        if (!isMountedRef.current || optimizeRunRef.current !== runId) {
          return;
        }
        setSystemPrompt(replacement.append(chunk));
      });
      if (!isMountedRef.current || optimizeRunRef.current !== runId) {
        return;
      }
      const optimizedText = replacement.value();
      if (!optimizedText.trim()) {
        throw new Error("Prompt optimization returned empty content");
      }
      setSystemPrompt(optimizedText);
    } catch (e) {
      if (!isMountedRef.current || optimizeRunRef.current !== runId) {
        return;
      }
      logDevError("Optimization failed", e);
      setSystemPrompt(replacement.restore());
      setOptimizeError(t("optimizeFailed"));
    } finally {
      if (isMountedRef.current && optimizeRunRef.current === runId) {
        setIsOptimizing(false);
      }
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-9999 flex min-h-[100dvh] items-center justify-center overscroll-contain bg-black/50 p-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          void handleCloseRequest();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleModalKeyDown}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-border dark:bg-card sm:max-h-[90vh]"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-border">
          <h2
            id={titleId}
            className="text-lg font-bold text-gray-800 dark:text-foreground flex items-center gap-2"
          >
            <FolderCog size={20} className="text-blue-500" aria-hidden="true" />
            {workspace ? t("editWorkspace") : t("newWorkspace")}
          </h2>
          <Button
            variant="bare"
            type="button"
            aria-label={t("close")}
            onClick={() => void handleCloseRequest()}
            disabled={isActionPending}
            className="rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-muted"
          >
            <X size={20} aria-hidden="true" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          {/* Basic Info */}
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
                name="workspace-name"
                type="text"
                autoComplete="off"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={CHAT_ENTITY_LIMITS.maxWorkspaceNameChars}
                placeholder={t("namePlaceholder")}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-muted border border-gray-200 dark:border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm transition-[border-color,box-shadow,background-color]"
              />
            </div>

            <div className="space-y-2">
              <div
                id={colorGroupId}
                className="text-xs font-semibold text-gray-500 dark:text-muted-foreground"
              >
                {t("folderColor")}
              </div>
              <div
                role="group"
                aria-labelledby={colorGroupId}
                className="flex flex-wrap gap-3"
              >
                {WORKSPACE_COLORS.map((c) => (
                  <Button
                    variant="bare"
                    type="button"
                    key={c.name}
                    aria-label={t("useColorAria", { color: c.name })}
                    aria-pressed={selectedColor === c.name}
                    onClick={() => setSelectedColor(c.name)}
                    className={`w-6 h-6 rounded-full ${c.class} flex items-center justify-center transition-[opacity,transform,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-background ${selectedColor === c.name ? "scale-110 shadow-md ring-2 ring-offset-2 ring-gray-300 dark:ring-ring" : "opacity-40 hover:opacity-100 hover:scale-105"}`}
                  >
                    {selectedColor === c.name && (
                      <Check
                        size={12}
                        className="text-white"
                        strokeWidth={3}
                        aria-hidden="true"
                      />
                    )}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label
                  htmlFor={systemPromptInputId}
                  className="text-xs font-semibold text-gray-500 dark:text-muted-foreground"
                >
                  {t("systemInstruction")}
                </label>
                <Button
                  variant="bare"
                  type="button"
                  aria-label={t("optimizeAria")}
                  aria-busy={isOptimizing}
                  onClick={handleOptimize}
                  disabled={isOptimizing || isActionPending}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-blue-500 transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-blue-900/20"
                >
                  {isOptimizing ? (
                    <Loader2
                      size={12}
                      className="animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Sparkles size={12} aria-hidden="true" />
                  )}
                  {t("optimize")}
                </Button>
              </div>
              <textarea
                id={systemPromptInputId}
                name="workspace-system-instruction"
                autoComplete="off"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                maxLength={CHAT_ENTITY_LIMITS.maxWorkspaceSystemPromptChars}
                placeholder={t("systemPromptPlaceholder")}
                aria-describedby={optimizeError ? optimizeErrorId : undefined}
                className="w-full h-24 px-3 py-2 bg-gray-50 dark:bg-muted border border-gray-200 dark:border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm resize-none custom-scrollbar transition-[border-color,box-shadow,background-color]"
              />
              {optimizeError && (
                <div
                  id={optimizeErrorId}
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300"
                >
                  {optimizeError}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-gray-100 dark:border-border pt-4 space-y-4">
            {/* Preset Parameters */}
            <div className="space-y-3">
              <div
                id={presetGroupId}
                className="text-xs font-semibold text-gray-500 dark:text-muted-foreground mb-2 block"
              >
                {t("presetParameters")}
              </div>

              <div
                role="group"
                aria-labelledby={presetGroupId}
                className="flex flex-col gap-3 bg-gray-50 dark:bg-muted/50 p-3 rounded-xl border border-gray-200 dark:border-border"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-foreground/85">
                    <Globe size={16} aria-hidden="true" /> {t("enableSearch")}
                  </div>
                  <SimpleSwitch
                    ariaLabel={t("enableSearchAria")}
                    name="workspaceEnableSearch"
                    checked={enableSearch}
                    onChange={() => setEnableSearch(!enableSearch)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-foreground/85">
                    <Lightbulb size={16} aria-hidden="true" />{" "}
                    {t("enableReasoning")}
                  </div>
                  <SimpleSwitch
                    ariaLabel={t("enableReasoningAria")}
                    name="workspaceEnableReasoning"
                    checked={enableReasoning}
                    onChange={() => setEnableReasoning(!enableReasoning)}
                  />
                </div>
              </div>

              <ResearchTemplatePicker
                selection={researchTemplate}
                onChange={setResearchTemplate}
                disabled={isActionPending}
                labels={{
                  title: researchTemplateText("title", "Research template"),
                  description: researchTemplateText(
                    "workspaceDescription",
                    "Set the default Research deliverable shape for this workspace.",
                  ),
                  inherit: researchTemplateText(
                    "workspaceInherit",
                    "No workspace template",
                  ),
                  disabled: researchTemplateText(
                    "disabled",
                    "Disable inherited template",
                  ),
                  loading: researchTemplateText(
                    "loading",
                    "Loading templates...",
                  ),
                  unavailable: researchTemplateText(
                    "unavailable",
                    "Built-in templates remain available.",
                  ),
                  duplicate: researchTemplateText(
                    "duplicate",
                    "Duplicate template",
                  ),
                  remove: researchTemplateText("remove", "Delete template"),
                  builtIn: researchTemplateText("builtIn", "Built-in"),
                  custom: researchTemplateText("custom", "Custom"),
                  selectAria: researchTemplateText(
                    "workspaceSelectAria",
                    "Workspace research template",
                  ),
                  duplicateAria: researchTemplateText(
                    "duplicateAria",
                    "Duplicate workspace research template",
                  ),
                  removeAria: researchTemplateText(
                    "removeAria",
                    "Delete workspace research template",
                  ),
                  newTemplate: researchTemplateText(
                    "newTemplate",
                    "New template",
                  ),
                  editTemplate: researchTemplateText(
                    "editTemplate",
                    "Edit template",
                  ),
                  editAria: researchTemplateText(
                    "editAria",
                    "Edit selected research template",
                  ),
                  snapshot: researchTemplateText("snapshot", "Saved snapshot"),
                  preview: researchTemplateText("preview", "Template preview"),
                  deliverable: researchTemplateText(
                    "deliverable",
                    "Deliverable",
                  ),
                  sections: researchTemplateText(
                    "sections",
                    "Required sections",
                  ),
                  sources: researchTemplateText("sources", "Source priorities"),
                  strategy: researchTemplateText(
                    "strategy",
                    "Starting strategy",
                  ),
                  templateEditor: {
                    title: researchTemplateText(
                      "editor.title",
                      "Template details",
                    ),
                    name: researchTemplateText("editor.name", "Name"),
                    namePlaceholder: researchTemplateText(
                      "editor.namePlaceholder",
                      "e.g. Product evaluation",
                    ),
                    description: researchTemplateText(
                      "editor.description",
                      "Description",
                    ),
                    descriptionPlaceholder: researchTemplateText(
                      "editor.descriptionPlaceholder",
                      "What this template helps you deliver",
                    ),
                    deliverable: researchTemplateText(
                      "editor.deliverable",
                      "Deliverable type",
                    ),
                    sections: researchTemplateText(
                      "editor.sections",
                      "Required sections",
                    ),
                    sectionsHint: researchTemplateText(
                      "editor.sectionsHint",
                      "One section per line. Standard audit sections are added automatically.",
                    ),
                    sources: researchTemplateText(
                      "editor.sources",
                      "Source priorities",
                    ),
                    sourceType: researchTemplateText(
                      "editor.sourceType",
                      "Source type",
                    ),
                    priority: researchTemplateText(
                      "editor.priority",
                      "Priority",
                    ),
                    rationale: researchTemplateText(
                      "editor.rationale",
                      "Rationale",
                    ),
                    rationalePlaceholder: researchTemplateText(
                      "editor.rationalePlaceholder",
                      "Why this source is useful",
                    ),
                    addSource: researchTemplateText(
                      "editor.addSource",
                      "Add source priority",
                    ),
                    strategy: researchTemplateText(
                      "editor.strategy",
                      "Starting strategy",
                    ),
                    cancel: researchTemplateText("editor.cancel", "Cancel"),
                    save: researchTemplateText("editor.save", "Save template"),
                    required: researchTemplateText(
                      "editor.required",
                      "Complete the required fields before saving.",
                    ),
                    removeSourceAria: researchTemplateText(
                      "editor.removeSourceAria",
                      "Remove source priority",
                    ),
                  },
                  templateName: (template) =>
                    researchTemplateText(
                      `templates.${template.id}.name`,
                      template.name,
                    ),
                  templateDescription: (template) =>
                    researchTemplateText(
                      `templates.${template.id}.description`,
                      template.description,
                    ),
                }}
              />

              {/* Plugins */}
              <div className="space-y-2">
                <div
                  id={pluginGroupId}
                  className="text-xs font-semibold text-gray-500 dark:text-muted-foreground flex items-center gap-2"
                >
                  <Cable size={14} aria-hidden="true" /> {t("activePlugins")}
                </div>
                <div
                  role="group"
                  aria-labelledby={pluginGroupId}
                  className="flex flex-wrap gap-2"
                >
                  {installedPlugins.length > 0 ? (
                    installedPlugins.map((rawPlugin) => {
                      const plugin = localizePluginMeta(rawPlugin, tConfig);
                      return (
                        <Button
                          variant="bare"
                          type="button"
                          key={plugin.id}
                          aria-label={
                            activePlugins.includes(plugin.id)
                              ? t("disablePluginAria", { title: plugin.title })
                              : t("enablePluginAria", { title: plugin.title })
                          }
                          aria-pressed={activePlugins.includes(plugin.id)}
                          onClick={() => togglePlugin(plugin.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/60 ${
                            activePlugins.includes(plugin.id)
                              ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300"
                              : "bg-gray-50 dark:bg-muted border-gray-200 dark:border-border text-gray-600 dark:text-muted-foreground hover:border-gray-300 dark:hover:border-border"
                          }`}
                        >
                          <SafeImage
                            src={plugin.logoUrl}
                            className="w-3 h-3 object-contain"
                            alt=""
                            fallback={<Cable size={12} aria-hidden="true" />}
                          />
                          <span
                            className="min-w-0 truncate max-w-36"
                            title={plugin.title}
                          >
                            {plugin.title}
                          </span>
                          {activePlugins.includes(plugin.id) && (
                            <Check size={12} aria-hidden="true" />
                          )}
                        </Button>
                      );
                    })
                  ) : (
                    <div className="text-xs text-gray-400 italic">
                      {t("noPluginsInstalled")}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div
                  id={skillGroupId}
                  className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-muted-foreground"
                >
                  <ScrollText size={14} aria-hidden="true" />{" "}
                  {t("activeSkills")}
                </div>
                <div
                  role="group"
                  aria-labelledby={skillGroupId}
                  className="flex flex-wrap gap-2"
                >
                  {installedSkills.length > 0 ? (
                    installedSkills.map((skill) => (
                      <Button
                        variant="bare"
                        type="button"
                        key={skill.id}
                        aria-label={
                          activeSkills.includes(skill.id)
                            ? t("disableSkillAria", { title: skill.title })
                            : t("enableSkillAria", { title: skill.title })
                        }
                        aria-pressed={activeSkills.includes(skill.id)}
                        onClick={() => toggleSkill(skill.id)}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                          activeSkills.includes(skill.id)
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
                            : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 dark:border-border dark:bg-muted dark:text-muted-foreground dark:hover:border-border"
                        }`}
                      >
                        <ScrollText size={12} aria-hidden="true" />
                        <span className="max-w-36 truncate">{skill.title}</span>
                        {activeSkills.includes(skill.id) && (
                          <Check size={12} aria-hidden="true" />
                        )}
                      </Button>
                    ))
                  ) : (
                    <div className="text-xs italic text-gray-400">
                      {t("noSkillsInstalled")}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Knowledge Base */}
            <div>
              <div
                id={knowledgeGroupId}
                className="text-xs font-semibold text-gray-500 dark:text-muted-foreground mb-2 flex items-center gap-1"
              >
                <LibraryBig size={12} aria-hidden="true" />{" "}
                {t("linkedKnowledgeBases")}
              </div>
              <div
                role="group"
                aria-labelledby={knowledgeGroupId}
                className="flex flex-wrap gap-2"
              >
                {collections.length > 0 ? (
                  collections.map((col) => (
                    <Button
                      variant="bare"
                      type="button"
                      key={col.id}
                      aria-label={
                        selectedKBIds.has(col.id)
                          ? t("unlinkKnowledgeAria", { name: col.name })
                          : t("linkKnowledgeAria", { name: col.name })
                      }
                      aria-pressed={selectedKBIds.has(col.id)}
                      onClick={() => toggleKB(col.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60 ${
                        selectedKBIds.has(col.id)
                          ? "bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300"
                          : "bg-gray-50 dark:bg-muted border-gray-200 dark:border-border text-gray-600 dark:text-muted-foreground hover:border-gray-300 dark:hover:border-border"
                      }`}
                    >
                      <span
                        className="min-w-0 truncate max-w-36"
                        title={col.name}
                      >
                        {col.name}
                      </span>
                    </Button>
                  ))
                ) : (
                  <div className="text-xs text-gray-400 italic">
                    {t("noCollectionsAvailable")}
                  </div>
                )}
              </div>
            </div>

            {/* Files */}
            <div>
              <div
                id={fileGroupId}
                className="text-xs font-semibold text-gray-500 dark:text-muted-foreground mb-2 flex items-center gap-1"
              >
                <Link size={12} aria-hidden="true" /> {t("presetFiles")}
              </div>
              <div
                role="group"
                aria-labelledby={fileGroupId}
                className="space-y-2"
              >
                {files.map((file) => (
                  <div
                    key={file.id}
                    className={`flex items-center justify-between rounded-lg border p-2 text-xs ${
                      file.localFileMissing
                        ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200"
                        : "border-gray-200 bg-gray-50 dark:border-border dark:bg-muted"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2 truncate">
                      {file.localFileMissing ? (
                        <AlertTriangle
                          size={14}
                          className="shrink-0"
                          aria-hidden="true"
                        />
                      ) : (
                        <FileText
                          size={14}
                          className="shrink-0 text-blue-500"
                          aria-hidden="true"
                        />
                      )}
                      <span className="min-w-0 truncate">
                        {file.fileName}
                        {file.localFileMissing ? (
                          <span className="ml-2 font-medium">
                            {t("localFileMissing")}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <Button
                      variant="bare"
                      type="button"
                      aria-label={t("removePresetFileAria", {
                        fileName: file.fileName,
                      })}
                      onClick={() => handleRemoveFile(file)}
                      disabled={isActionPending}
                      className="rounded text-gray-400 transition-colors hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <X size={14} aria-hidden="true" />
                    </Button>
                  </div>
                ))}

                <Button
                  variant="bare"
                  type="button"
                  aria-label={t("uploadPresetFilesAria")}
                  aria-describedby={
                    fileUploadError ? fileUploadStatusId : undefined
                  }
                  aria-busy={isUploadingFiles}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={
                    files.length >= ATTACHMENT_LIMITS.maxCount ||
                    isActionPending ||
                    isUploadingFiles
                  }
                  className="w-full py-2 border-2 border-dashed border-gray-200 dark:border-border rounded-xl text-xs text-gray-500 hover:border-blue-400 hover:bg-blue-50/50 dark:hover:border-blue-700 dark:hover:bg-blue-900/10 transition-colors flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-gray-200 dark:disabled:hover:border-border"
                >
                  {isUploadingFiles ? (
                    <Loader2
                      size={14}
                      className="animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <UploadCloud size={14} aria-hidden="true" />
                  )}
                  {isUploadingFiles ? t("uploading") : t("uploadDefaultFile")}
                </Button>
                {fileUploadError && (
                  <div
                    id={fileUploadStatusId}
                    role="status"
                    aria-live="polite"
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300"
                  >
                    {fileUploadError}
                  </div>
                )}
                <input
                  id={fileInputId}
                  name="workspace-preset-files"
                  type="file"
                  ref={fileInputRef}
                  className="sr-only"
                  tabIndex={-1}
                  aria-label={t("presetFilesInputAria")}
                  aria-describedby={
                    fileUploadError ? fileUploadStatusId : undefined
                  }
                  multiple
                  onChange={(e) => void handleFileUpload(e.target.files)}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-gray-100 dark:border-border bg-gray-50/50 dark:bg-card/50 flex justify-between gap-3">
          <div>
            {workspace && (
              <Button
                variant="bare"
                type="button"
                aria-label={
                  isDeleteConfirming
                    ? t("confirmDeleteWorkspaceAria", { name: workspace.name })
                    : t("deleteWorkspaceAria", { name: workspace.name })
                }
                onClick={handleDeleteWorkspace}
                disabled={isActionPending}
                className={`px-4 py-2 text-sm rounded-xl transition-colors flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 disabled:opacity-50 disabled:cursor-not-allowed ${
                  isDeleteConfirming
                    ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200"
                    : "text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                }`}
              >
                {pendingAction === "delete" ? (
                  <Loader2
                    size={16}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                ) : isDeleteConfirming ? (
                  <Check size={16} aria-hidden="true" />
                ) : (
                  <Trash2 size={16} aria-hidden="true" />
                )}
                {isDeleteConfirming ? t("confirmDelete") : t("delete")}
              </Button>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              variant="bare"
              type="button"
              onClick={() => void handleCloseRequest()}
              disabled={isActionPending}
              className="px-4 py-2 text-sm text-gray-600 dark:text-muted-foreground hover:bg-gray-100 dark:hover:bg-muted rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("cancel")}
            </Button>
            <Button
              variant="bare"
              type="button"
              onClick={handleSubmit}
              disabled={!trimmedName || isActionPending || isUploadingFiles}
              className="px-6 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-500/20 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-background"
            >
              {pendingAction === "save" ? (
                <Loader2
                  size={16}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Save size={16} aria-hidden="true" />
              )}
              {t("saveWorkspace")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default WorkspaceSettingsModal;
