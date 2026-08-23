"use client";
import React, {
  useCallback,
  useState,
  useRef,
  useEffect,
  useMemo,
  useId,
} from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { toPng } from "html-to-image";
import type {
  Attachment,
  Message,
  MessageOutputBlock,
  ToolConfirmationDecision,
  WorkspaceFilePresentation,
} from "@/types";
import type { ModelInfo } from "@/services/api/chatService";
import MarkdownRenderer from "../content/MarkdownRenderer";
import Tooltip from "../ui/Tooltip";
import Artifact from "../content/Artifact";
import MessageOutputRenderer from "../content/MessageOutputRenderer";
import WorkspaceFileBlock from "../content/WorkspaceFileBlock";
import MessageAttachmentView from "./MessageAttachmentView";
import UserMessageEditor from "./UserMessageEditor";
import RAGBlock from "../knowledge/RAGBlock";
import AddToKnowledgeModal from "../knowledge/AddToKnowledgeModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Edit2,
  Copy,
  Trash2,
  Volume2,
  VolumeX,
  Bot,
  User,
  Check,
  Undo2,
  FileText,
  MoreHorizontal,
  Maximize2,
  Download,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  Info,
  Loader2,
  RefreshCw,
  Library,
  Sparkles,
  Signature,
  FileImage,
  Quote,
} from "lucide-react";
import { BubblesLoading } from "../ui/Icons";
import { useChatStore } from "@/store/core/chatStore";
import { useUIStore } from "@/store/core/uiStore";
import { useSettingsStore } from "@/store/core/settingsStore";
import { synthesizeSpeech } from "@/services/api/voiceService";
import type { DisposableAudioElement } from "@/lib/utils/disposableAudio";
import { sanitizeDownloadFilename } from "@/lib/utils/filename";
import {
  normalizeMarkdownGeneratedFile,
  type MarkdownGeneratedFile,
} from "@/lib/utils/markdownFiles";
import { copyTextToClipboard } from "@/lib/utils/clipboard";
import { signedApiFetch } from "@/lib/api/client";
import { getNextTypewriterFrame } from "@/lib/utils/typewriter";
import {
  createSpeechSynthesisPoller,
  type DisposablePoller,
} from "@/lib/utils/speechPolling";
import {
  createTimedStatusResetController,
  type TimedStatusResetController,
} from "@/lib/utils/timedStatus";
import { logDevError } from "@/lib/utils/devLogger";
import { buildMobileMessageMetaTooltip } from "@/lib/utils/messageMetaTooltip";
import { getMessageDisplayTokenCount } from "@/lib/utils/messageTokens";
import {
  decodeAttachmentText,
  isTextDocumentMimeType,
} from "@/lib/utils/documentAttachments";
import { hasUnsafeContinuationToolState } from "@/lib/chat/streamResilience";
import { hasMixedLongTextOutput } from "@/lib/chat/longText";
import { FORCED_PLUGIN_INVOCATION_ERROR_CODE } from "@/lib/chat/forcedInvocation";
import type { MessageBranchOption } from "@/lib/chat/messageTree";
import { Button } from "@/components/ui/primitives";

interface MessageItemProps {
  message: Message;
  actionsDisabled?: boolean;
  mutationsDisabled?: boolean;
  toolActionsDisabled?: boolean;
  branchInfo?: {
    index: number;
    count: number;
  };
  branchOptions?: MessageBranchOption[];
  onEdit: (id: string, newContent: string) => void;
  onDelete: (id: string) => void;
  availableModels?: ModelInfo[];
  onRegenerate?: (model?: string) => void;
  onContinue?: () => void;
  onStopGeneration?: () => void;
  onReply?: () => void;
  onNavigateToMessage?: (messageId: string) => void;
  onRetract?: () => void;
  canEditUserMessage?: boolean;
  onSubmitUserEdit?: (id: string, newContent: string) => void | Promise<void>;
  onVersionChange?: (id: string, direction: "prev" | "next") => void;
  onVersionSelect?: (targetId: string) => void;
  isLast: boolean;
  isTyping?: boolean;
  onToolConfirmationDecision?: (
    toolCallId: string,
    decision: ToolConfirmationDecision,
  ) => void;
  onRevokeToolSessionApproval?: (
    toolCall: NonNullable<Message["toolCalls"]>[number],
  ) => void;
}

type CopyStatus = "idle" | "copied" | "error";
type MessageDownloadFormat = "markdown" | "pdf" | "image";

interface ReadableAttachmentDocument {
  name: string;
  mimeType: string;
  content: string;
  downloadName: string;
  renderAsMarkdown: boolean;
}

interface PdfPrintJob {
  id: string;
  title: string;
  message: Message;
  searchSources: NonNullable<Message["searchSources"]>;
  ragSources: NonNullable<Message["ragSources"]>;
}

interface ImageExportJob {
  id: string;
  title: string;
  message: Message;
  searchSources: NonNullable<Message["searchSources"]>;
  ragSources: NonNullable<Message["ragSources"]>;
  width: number;
}

const logMessageItemError = logDevError;

const actionButtonFocusClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-background";

const markdownFileNamePattern = /\.(?:md|markdown)$/i;
const MESSAGE_IMAGE_PROXY_PATH = "/api/media/image-proxy";
const DEFAULT_MESSAGE_IMAGE_EXPORT_WIDTH = 820;
const MESSAGE_IMAGE_EXPORT_PADDING_PX = 24;
const MESSAGE_EXPORT_EXCLUDED_SELECTORS = [
  ".markdown-codeblock-header",
  ".markdown-diagram-header",
  ".markdown-codeblock-fade",
  ".markdown-console",
  ".markdown-preview-dialog",
  ".markdown-icon-button",
];

const getAttachmentDownloadName = (attachment: Attachment) => {
  const baseName = attachment.fileName || "attachment";
  if (
    attachment.mimeType === "text/markdown" &&
    !markdownFileNamePattern.test(baseName)
  ) {
    return `${baseName}.md`;
  }
  return baseName;
};

const shouldRenderAttachmentAsMarkdown = (attachment: Attachment) =>
  attachment.mimeType === "text/markdown" ||
  markdownFileNamePattern.test(attachment.fileName || "");

const getMessageImageExportWidth = (element: HTMLElement | null) => {
  const measuredWidth = element?.getBoundingClientRect().width || 0;
  const contentWidth = Math.max(
    1,
    Math.ceil(measuredWidth || DEFAULT_MESSAGE_IMAGE_EXPORT_WIDTH),
  );
  return contentWidth + MESSAGE_IMAGE_EXPORT_PADDING_PX * 2;
};

const shouldIncludeMessageExportNode = (node: HTMLElement) =>
  !MESSAGE_EXPORT_EXCLUDED_SELECTORS.some((selector) =>
    node.matches?.(selector),
  );

const isTransparentColor = (color: string) =>
  !color ||
  color === "transparent" ||
  color === "rgba(0, 0, 0, 0)" ||
  color === "rgb(0 0 0 / 0)";

const getImageExportBackgroundColor = (element: HTMLElement) => {
  const elementBackground = window.getComputedStyle(element).backgroundColor;
  if (!isTransparentColor(elementBackground)) return elementBackground;

  const bodyBackground = window.getComputedStyle(document.body).backgroundColor;
  if (!isTransparentColor(bodyBackground)) return bodyBackground;

  return document.documentElement.classList.contains("dark")
    ? "#09090b"
    : "#ffffff";
};

const getMessageExportImageSource = (src: string) => {
  if (!src) return null;

  try {
    const url = new URL(src, window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.origin === window.location.origin) return null;

    return url.href;
  } catch {
    return null;
  }
};

const waitForImageElement = (image: HTMLImageElement, timeoutMs = 5000) => {
  if (image.complete) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let settled = false;
    const handleDone = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      image.removeEventListener("load", handleDone);
      image.removeEventListener("error", handleDone);
    };
    const timer = window.setTimeout(() => {
      handleDone();
    }, timeoutMs);

    image.addEventListener("load", handleDone);
    image.addEventListener("error", handleDone);
  });
};

const waitForMessageExportImages = async (root: HTMLElement) => {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(images.map((image) => waitForImageElement(image)));
};

const proxyMessageExportImages = async (
  root: HTMLElement,
  signal: AbortSignal,
) => {
  const objectUrls: string[] = [];
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));

  try {
    for (const image of images) {
      const src =
        image.currentSrc || image.src || image.getAttribute("src") || "";
      const imageSource = getMessageExportImageSource(src);
      if (!imageSource) continue;

      const response = await signedApiFetch(MESSAGE_IMAGE_PROXY_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: imageSource }),
        signal,
      });
      if (!response.ok) {
        throw new Error(`Image proxy request failed: ${response.status}`);
      }

      const objectUrl = URL.createObjectURL(await response.blob());
      objectUrls.push(objectUrl);
      image.srcset = "";
      image.src = objectUrl;
    }
  } catch (error) {
    objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    throw error;
  }

  return {
    cleanup: () => {
      objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    },
  };
};

const MessageItem: React.FC<MessageItemProps> = ({
  message,
  actionsDisabled = false,
  mutationsDisabled = false,
  toolActionsDisabled = false,
  branchInfo,
  branchOptions = [],
  onEdit,
  onDelete,
  availableModels = [],
  onRegenerate,
  onContinue,
  onStopGeneration,
  onReply,
  onNavigateToMessage,
  onRetract,
  canEditUserMessage = false,
  onSubmitUserEdit,
  onVersionChange,
  onVersionSelect,
  isLast,
  isTyping = false,
  onToolConfirmationDecision,
  onRevokeToolSessionApproval,
}) => {
  const mutationActionsDisabled = actionsDisabled || mutationsDisabled;
  const confirmationActionsDisabled = actionsDisabled || toolActionsDisabled;
  const t = useTranslations("Message");
  const locale = useLocale();
  const durationFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "unit",
        unit: "second",
        unitDisplay: "short",
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    [locale],
  );
  const [isEditing, setIsEditing] = useState(false);
  const isFlatModelEditUnsupported =
    message.role === "model" && hasMixedLongTextOutput(message.outputBlocks);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const [readerCopyStatus, setReaderCopyStatus] = useState<CopyStatus>("idle");
  const isCopied = copyStatus === "copied";
  const copyTooltip =
    copyStatus === "copied"
      ? t("copied")
      : copyStatus === "error"
        ? t("copyFailed")
        : t("copy");

  // More Menu State
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false);
  const [showAddToKnowledgeModal, setShowAddToKnowledgeModal] = useState(false);
  const [pdfPrintJob, setPdfPrintJob] = useState<PdfPrintJob | null>(null);
  const [imageExportJob, setImageExportJob] = useState<ImageExportJob | null>(
    null,
  );
  const [downloadingFormat, setDownloadingFormat] =
    useState<MessageDownloadFormat | null>(null);
  const [imageExportError, setImageExportError] = useState<string | null>(null);

  // Immersive / Reading Mode State
  const [readingMode, setReadingMode] = useState<
    "none" | "message" | "file" | "attachment" | "long_text" | "workspace_file"
  >("none");
  const [fileToRead, setFileToRead] = useState<MarkdownGeneratedFile | null>(
    null,
  );
  const [attachmentToRead, setAttachmentToRead] =
    useState<ReadableAttachmentDocument | null>(null);
  const [workspaceFileToRead, setWorkspaceFileToRead] =
    useState<WorkspaceFilePresentation | null>(null);

  // Typewriter effect state
  const [displayedContent, setDisplayedContent] = useState(
    isTyping ? "" : message.content,
  );
  const displayedContentRef = useRef(displayedContent);

  // TTS State
  const [isPlaying, setIsPlaying] = useState(false);
  const [isTTSLoading, setIsTTSLoading] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const currentAudioRef = useRef<DisposableAudioElement | null>(null);
  const speechPollerRef = useRef<DisposablePoller | null>(null);
  const copyStatusResetRef =
    useRef<TimedStatusResetController<CopyStatus> | null>(null);
  const readerCopyStatusResetRef =
    useRef<TimedStatusResetController<CopyStatus> | null>(null);
  const deleteConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const readingDialogRef = useRef<HTMLDivElement>(null);
  const imageExportRootRef = useRef<HTMLDivElement>(null);
  const visibleMessageContentRef = useRef<HTMLDivElement>(null);
  const downloadLockRef = useRef<MessageDownloadFormat | null>(null);
  const downloadResetTimerRef = useRef<number | null>(null);
  const readingRestoreFocusRef = useRef<HTMLElement | null>(null);
  const readingDialogTitleId = useId();
  const readingDialogDescriptionId = useId();
  const originalDocumentTitleRef = useRef<string | null>(null);

  // Get Store Data
  const { getCurrentSession, selectedModel, activeMessages, updateMessage } =
    useChatStore();
  const { openImagePreview } = useUIStore();
  const { voice } = useSettingsStore();

  const beginDownload = useCallback((format: MessageDownloadFormat) => {
    if (downloadLockRef.current) return false;
    downloadLockRef.current = format;
    setDownloadingFormat(format);
    return true;
  }, []);

  const finishDownload = useCallback((format: MessageDownloadFormat) => {
    if (downloadLockRef.current !== format) return;
    downloadLockRef.current = null;
    setDownloadingFormat(null);
  }, []);

  const isDownloading = downloadingFormat !== null;

  const stopCurrentAudio = () => {
    currentAudioRef.current?.dispose();
    currentAudioRef.current = null;
    speechPollerRef.current?.dispose();
    speechPollerRef.current = null;
  };

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

  const setReaderCopyFeedback = (status: Exclude<CopyStatus, "idle">) => {
    const controller =
      readerCopyStatusResetRef.current ||
      createTimedStatusResetController<CopyStatus>({
        setStatus: setReaderCopyStatus,
        resetValue: "idle",
      });
    readerCopyStatusResetRef.current = controller;
    controller.set(status);
  };

  const closeReadingMode = useCallback(() => {
    setReadingMode("none");
    setFileToRead(null);
    setAttachmentToRead(null);
    setWorkspaceFileToRead(null);
    setReaderCopyStatus("idle");
  }, []);

  const clearDeleteConfirmTimer = () => {
    if (deleteConfirmTimerRef.current) {
      clearTimeout(deleteConfirmTimerRef.current);
      deleteConfirmTimerRef.current = null;
    }
  };

  const resetDeleteConfirmation = () => {
    clearDeleteConfirmTimer();
    setIsDeleteConfirming(false);
  };

  const handleDeleteClick = () => {
    if (mutationActionsDisabled) return;
    if (isDeleteConfirming) {
      resetDeleteConfirmation();
      setShowMoreMenu(false);
      onDelete(message.id);
      return;
    }

    setIsDeleteConfirming(true);
    clearDeleteConfirmTimer();
    deleteConfirmTimerRef.current = setTimeout(() => {
      deleteConfirmTimerRef.current = null;
      setIsDeleteConfirming(false);
    }, 3500);
  };

  // Handle ESC key to exit immersive mode or close the mobile overflow menu
  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (readingMode !== "none") {
        closeReadingMode();
        return;
      }

      if (showMoreMenu) {
        setShowMoreMenu(false);
        if (deleteConfirmTimerRef.current) {
          clearTimeout(deleteConfirmTimerRef.current);
          deleteConfirmTimerRef.current = null;
        }
        setIsDeleteConfirming(false);
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [closeReadingMode, readingMode, showMoreMenu]);

  useEffect(() => {
    if (readingMode === "none") return;

    if (!readingRestoreFocusRef.current) {
      readingRestoreFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => {
      readingDialogRef.current?.focus({ preventScroll: true });
    });

    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousBodyOverflow;
      if (readingRestoreFocusRef.current?.isConnected) {
        readingRestoreFocusRef.current.focus({ preventScroll: true });
      }
      readingRestoreFocusRef.current = null;
    };
  }, [readingMode]);

  // Cleanup Audio on unmount
  useEffect(() => {
    return () => {
      copyStatusResetRef.current?.dispose();
      readerCopyStatusResetRef.current?.dispose();
      clearDeleteConfirmTimer();
      if (downloadResetTimerRef.current !== null) {
        window.clearTimeout(downloadResetTimerRef.current);
        downloadResetTimerRef.current = null;
      }
      downloadLockRef.current = null;
      stopCurrentAudio();
      // Also stop browser synthesis if running
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    if (deleteConfirmTimerRef.current) {
      clearTimeout(deleteConfirmTimerRef.current);
      deleteConfirmTimerRef.current = null;
    }
    setIsDeleteConfirming(false);
  }, [message.id]);

  useEffect(() => {
    if (!pdfPrintJob) return;

    const originalTitle =
      originalDocumentTitleRef.current === null
        ? document.title
        : originalDocumentTitleRef.current;
    originalDocumentTitleRef.current = originalTitle;
    document.title = pdfPrintJob.title;

    let firstFrame: number | null = null;
    let secondFrame: number | null = null;
    let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
    let cleanedUp = false;

    const restoreDocumentTitle = () => {
      document.title = originalTitle;
      originalDocumentTitleRef.current = null;
    };

    const cleanupPrintJob = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (cleanupTimer) {
        clearTimeout(cleanupTimer);
        cleanupTimer = null;
      }
      restoreDocumentTitle();
      finishDownload("pdf");
      setPdfPrintJob((current) =>
        current?.id === pdfPrintJob.id ? null : current,
      );
    };

    window.addEventListener("afterprint", cleanupPrintJob, { once: true });

    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        window.print();
        cleanupTimer = setTimeout(cleanupPrintJob, 30000);
      });
    });

    return () => {
      if (firstFrame !== null) cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) cancelAnimationFrame(secondFrame);
      window.removeEventListener("afterprint", cleanupPrintJob);
      if (cleanupTimer) clearTimeout(cleanupTimer);
      if (!cleanedUp) {
        cleanedUp = true;
        restoreDocumentTitle();
        finishDownload("pdf");
      }
    };
  }, [finishDownload, pdfPrintJob]);

  useEffect(() => {
    if (!imageExportJob) return;

    let firstFrame: number | null = null;
    let secondFrame: number | null = null;
    let cancelled = false;
    const proxyController = new AbortController();
    let cleanupProxiedImages = () => {};

    const downloadImageDataUrl = (dataUrl: string) => {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = imageExportJob.title;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };

    const cleanupImageExportJob = () => {
      finishDownload("image");
      setImageExportJob((current) =>
        current?.id === imageExportJob.id ? null : current,
      );
    };

    const exportRootToPng = async (root: HTMLElement) => {
      const backgroundColor = getImageExportBackgroundColor(root);
      return toPng(root, {
        cacheBust: false,
        backgroundColor,
        width: imageExportJob.width,
        canvasWidth: imageExportJob.width,
        style: {
          width: `${imageExportJob.width}px`,
        },
        filter: (node) => shouldIncludeMessageExportNode(node as HTMLElement),
      });
    };

    const runExport = async () => {
      const root = imageExportRootRef.current;
      if (!root) {
        cleanupImageExportJob();
        return;
      }

      try {
        const proxyResult = await proxyMessageExportImages(
          root,
          proxyController.signal,
        );
        cleanupProxiedImages = proxyResult.cleanup;
        await waitForMessageExportImages(root);
        const dataUrl = await exportRootToPng(root);
        if (!cancelled) downloadImageDataUrl(dataUrl);
      } catch (error) {
        if (!cancelled) {
          logMessageItemError("Failed to export message image", error);
          setImageExportError(t("downloadImageFailed"));
        }
      } finally {
        cleanupProxiedImages();
        if (!cancelled) cleanupImageExportJob();
      }
    };

    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        void runExport();
      });
    });

    return () => {
      cancelled = true;
      proxyController.abort();
      finishDownload("image");
      if (firstFrame !== null) cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) cancelAnimationFrame(secondFrame);
    };
  }, [finishDownload, imageExportJob, t]);

  // Typewriter Effect Logic using requestAnimationFrame
  useEffect(() => {
    const updateDisplayedContent = (value: string) => {
      displayedContentRef.current = value;
      setDisplayedContent(value);
    };

    if (!isTyping) {
      updateDisplayedContent(message.content);
      return;
    }

    // Immediate reset if content is cleared (e.g. regeneration start)
    if (message.content.length === 0) {
      updateDisplayedContent("");
      return;
    }

    let animationFrameId: number | null = null;
    let cancelled = false;

    const animate = () => {
      const nextFrame = getNextTypewriterFrame(
        displayedContentRef.current,
        message.content,
      );
      updateDisplayedContent(nextFrame.content);

      if (!cancelled && !nextFrame.done) {
        animationFrameId = requestAnimationFrame(animate);
      }
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      cancelled = true;
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
    };
  }, [isTyping, message.content]);

  const handleCopy = async () => {
    const copied = await copyTextToClipboard(message.content);
    setCopyFeedback(copied ? "copied" : "error");
  };

  const handleEditClick = () => {
    if (mutationActionsDisabled || isFlatModelEditUnsupported) {
      return;
    }
    setIsEditing(true);
  };

  const getMessageDownloadBaseName = () => {
    const msgIndex = activeMessages.findIndex((m) => m.id === message.id);
    let filename = `message_${message.id.slice(0, 8)}`;

    if (msgIndex > 0) {
      const prevMsg = activeMessages[msgIndex - 1];
      if (prevMsg.role === "user") {
        // Get first 10 words
        const words = prevMsg.content.split(/\s+/);
        const truncated = words.slice(0, 10).join(" ");
        // Clean up filename
        filename =
          truncated.replace(/[^\w\s\u4e00-\u9fa5-]/gi, "").trim() || filename;
        if (words.length > 10) {
          filename += "…";
        }
      }
    }

    return filename;
  };

  const getMessageDownloadName = (extension: "md" | "pdf" | "png") =>
    sanitizeDownloadFilename(
      `${getMessageDownloadBaseName()}.${extension}`,
      `message.${extension}`,
    );

  const handleDownloadMarkdown = () => {
    if (!beginDownload("markdown")) return;

    try {
      const blob = new Blob([message.content], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = getMessageDownloadName("md");
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setShowMoreMenu(false);
      if (downloadResetTimerRef.current !== null) {
        window.clearTimeout(downloadResetTimerRef.current);
      }
      downloadResetTimerRef.current = window.setTimeout(() => {
        downloadResetTimerRef.current = null;
        finishDownload("markdown");
      }, 250);
    }
  };

  const handleDownloadPdf = () => {
    if (!beginDownload("pdf")) return;
    setPdfPrintJob({
      id: `${message.id}-${Date.now()}`,
      title: getMessageDownloadName("pdf"),
      message,
      searchSources: message.searchSources || [],
      ragSources: message.ragSources || [],
    });
    setShowMoreMenu(false);
  };

  const handleDownloadImage = () => {
    if (!beginDownload("image")) return;
    setImageExportError(null);
    setImageExportJob({
      id: `${message.id}-${Date.now()}`,
      title: getMessageDownloadName("png"),
      message,
      searchSources: message.searchSources || [],
      ragSources: message.ragSources || [],
      width: getMessageImageExportWidth(visibleMessageContentRef.current),
    });
    setShowMoreMenu(false);
  };

  const handleAddToKnowledge = () => {
    if (mutationActionsDisabled) return;
    setShowAddToKnowledgeModal(true);
    setShowMoreMenu(false);
  };

  const handleImmersiveReading = () => {
    setReadingMode("message");
    setShowMoreMenu(false);
  };

  const handleFileClick = useCallback((file: MarkdownGeneratedFile) => {
    setFileToRead(normalizeMarkdownGeneratedFile(file));
    setAttachmentToRead(null);
    setWorkspaceFileToRead(null);
    setReaderCopyStatus("idle");
    setReadingMode("file");
  }, []);

  const handleDocumentAttachmentClick = (attachment: Attachment) => {
    if (!attachment.data || !isTextDocumentMimeType(attachment.mimeType))
      return;

    try {
      setAttachmentToRead({
        name: attachment.fileName,
        mimeType: attachment.mimeType,
        content: decodeAttachmentText(attachment),
        downloadName: getAttachmentDownloadName(attachment),
        renderAsMarkdown: shouldRenderAttachmentAsMarkdown(attachment),
      });
      setFileToRead(null);
      setWorkspaceFileToRead(null);
      setReaderCopyStatus("idle");
      setReadingMode("attachment");
    } catch (error) {
      logMessageItemError("Failed to decode document attachment", error);
    }
  };

  const handleLongTextOpen = useCallback(
    (block: Extract<MessageOutputBlock, { type: "text" }>) => {
      if (block.presentation?.kind !== "long_text" || !block.content) return;
      setAttachmentToRead({
        name: block.presentation.title,
        mimeType: block.presentation.document.mimeType,
        content: block.content,
        downloadName: block.presentation.document.fileName,
        renderAsMarkdown: block.presentation.format === "markdown",
      });
      setFileToRead(null);
      setWorkspaceFileToRead(null);
      setReaderCopyStatus("idle");
      setReadingMode("long_text");
    },
    [],
  );

  const handleWorkspaceFileOpen = useCallback(
    (file: WorkspaceFilePresentation) => {
      setWorkspaceFileToRead(file);
      setFileToRead(null);
      setAttachmentToRead(null);
      setReaderCopyStatus("idle");
      setReadingMode("workspace_file");
    },
    [],
  );

  const getActiveReadingFile = (): ReadableAttachmentDocument | null => {
    if (readingMode === "file" && fileToRead) {
      return {
        name: fileToRead.name,
        mimeType: "text/plain",
        content: fileToRead.content,
        downloadName: fileToRead.name,
        renderAsMarkdown: false,
      };
    }
    if (
      (readingMode === "attachment" || readingMode === "long_text") &&
      attachmentToRead
    ) {
      return attachmentToRead;
    }
    return null;
  };

  const handleDownloadFile = () => {
    const readingFile = getActiveReadingFile();
    if (!readingFile) return;
    const blob = new Blob([readingFile.content], {
      type: readingFile.mimeType || "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = sanitizeDownloadFilename(
      readingFile.downloadName,
      "attachment.txt",
    );
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyReadingFile = async () => {
    const readingFile = getActiveReadingFile();
    if (!readingFile) return;
    const copied = await copyTextToClipboard(readingFile.content);
    setReaderCopyFeedback(copied ? "copied" : "error");
  };

  const handleToggleReadAloud = async () => {
    if (isPlaying) {
      // Stop
      stopCurrentAudio();
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setIsPlaying(false);
    } else {
      // Start
      setIsTTSLoading(true);
      setTtsError(null);
      try {
        const audio = await synthesizeSpeech(message.content, voice);

        if (audio) {
          // API Based (Audio Element)
          currentAudioRef.current = audio;
          audio.onended = () => {
            setIsPlaying(false);
            currentAudioRef.current = null;
          };
          await audio.play();
          setIsPlaying(true);
        } else {
          // Browser Based (Fire and forget, but we can detect start)
          speechPollerRef.current?.dispose();
          setIsPlaying(true);
          speechPollerRef.current = createSpeechSynthesisPoller({
            isSpeaking: () => window.speechSynthesis.speaking,
            onIdle: () => {
              speechPollerRef.current = null;
              setIsPlaying(false);
            },
          });
        }
      } catch (e) {
        logMessageItemError("TTS Failed", e);
        setTtsError(
          t("failedToSynthesize", {
            error: e instanceof Error ? e.message : String(e),
          }),
        );
        setIsPlaying(false);
      } finally {
        setIsTTSLoading(false);
      }
    }
  };

  const tokenCount = useMemo(() => {
    return getMessageDisplayTokenCount(message);
  }, [message]);

  const isModelResponseLoading =
    isLast && isTyping && message.role === "model" && !message.generationError;

  // Detect error messages for styling (starts with Error:)
  const isErrorMessage =
    message.role === "model" && message.content.startsWith("Error:");
  const generationError = message.generationError;
  const isInterrupted =
    message.generation?.status === "interrupted" &&
    Boolean(
      message.content || message.reasoning || message.outputBlocks?.length,
    );
  const continuationBlocked =
    hasUnsafeContinuationToolState(message.toolCalls) ||
    generationError?.code === FORCED_PLUGIN_INVOCATION_ERROR_CODE;

  // Branch navigation checks
  const hasMultipleBranches = !!branchInfo && branchInfo.count > 1;
  const currentBranchIndex = branchInfo?.index ?? 0;
  const branchCount = branchInfo?.count ?? 1;
  const canEditCurrentUserMessage =
    !mutationActionsDisabled &&
    message.role === "user" &&
    canEditUserMessage &&
    !!onSubmitUserEdit;

  // --- Display Info Calculation ---
  const displayTimestamp = message.timestamp;
  const displayTiming = message.timing;
  // Reasoning Thinking State & Icon Logic
  // Also check if tools are running
  const isThinking =
    isTyping &&
    message.role === "model" &&
    message.content.length === 0 &&
    !message.searchSources &&
    (!message.toolCalls ||
      message.toolCalls.some(
        (tc) =>
          tc.status === "pending" ||
          tc.status === "running" ||
          (tc.status === undefined && tc.result === undefined),
      ));

  // Formatting helpers
  const getDisplayTime = () => {
    const ts =
      message.role === "model" && displayTiming?.endTime
        ? displayTiming.endTime
        : displayTimestamp;
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(ts));
  };

  const getDurationString = () => {
    if (message.role === "model" && displayTiming?.duration) {
      return durationFormatter.format(displayTiming.duration / 1000);
    }
    return null;
  };

  const durationString = getDurationString();
  const timeString = getDisplayTime();
  const tokenText =
    tokenCount > 0 ? t("tokenCount", { count: tokenCount }) : "";
  const mobileMetaRows = buildMobileMessageMetaTooltip({
    durationString,
    tokenText,
    labels: {
      duration: t("duration"),
      tokens: t("tokens"),
    },
  });

  // Search Data from Message
  const sources = useMemo(
    () => message.searchSources || [],
    [message.searchSources],
  );

  // RAG Data
  const ragSources = useMemo(
    () => message.ragSources || [],
    [message.ragSources],
  );
  const ragError = message.ragError?.message;

  // Tool Data
  const skillInvocations = message.skillInvocations || [];

  const handleAttachmentClick = (index: number) => {
    if (!message.attachments) return;

    // Filter out non-image attachments for preview
    const imageAttachments = message.attachments.filter((att) =>
      att.mimeType.startsWith("image/"),
    );
    const clickedAttachment = message.attachments[index];

    if (!clickedAttachment.mimeType.startsWith("image/")) return;

    const previewImages = imageAttachments.map((att) => ({
      url:
        att.displayCache?.opfsUrl ||
        att.url ||
        (att.data ? `data:${att.mimeType};base64,${att.data}` : ""),
      alt: att.fileName,
      description: att.fileName,
    }));

    // Find the new index in the filtered array
    const newIndex = imageAttachments.findIndex(
      (att) => att.id === clickedAttachment.id,
    );

    openImagePreview(previewImages, newIndex);
  };

  const persistCachedMessageAttachments = useCallback(
    (cachedAttachment: Attachment) => {
      const sessionId = getCurrentSession()?.id;
      if (!sessionId || !message.attachments?.length) return;

      let changed = false;
      const attachments = message.attachments.map((attachment) => {
        if (attachment.id !== cachedAttachment.id) return attachment;
        changed = true;
        return cachedAttachment;
      });
      if (!changed) return;

      updateMessage(sessionId, message.id, { attachments });
    },
    [getCurrentSession, message.attachments, message.id, updateMessage],
  );

  const persistCachedOutputImage = useCallback(
    (cachedImage: Attachment) => {
      const sessionId = getCurrentSession()?.id;
      if (!sessionId || !message.outputBlocks?.length) return;

      let changed = false;
      const outputBlocks = message.outputBlocks.map((block) => {
        if (block.type !== "image" || block.image.id !== cachedImage.id) {
          return block;
        }
        changed = true;
        return { ...block, image: cachedImage };
      });
      if (!changed) return;

      updateMessage(sessionId, message.id, { outputBlocks });
    },
    [getCurrentSession, message.id, message.outputBlocks, updateMessage],
  );

  const handleReadingDialogKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeReadingMode();
      return;
    }

    if (event.key !== "Tab") return;

    const dialog = readingDialogRef.current;
    if (!dialog) return;

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getClientRects().length > 0);

    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus({ preventScroll: true });
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  };

  const readingFile = getActiveReadingFile();
  const currentWorkspaceFile = message.outputBlocks?.find(
    (block): block is Extract<MessageOutputBlock, { type: "workspace_file" }> =>
      block.type === "workspace_file" &&
      block.file.path === workspaceFileToRead?.path,
  )?.file;
  const activeWorkspaceFile =
    readingMode === "workspace_file" && workspaceFileToRead
      ? (currentWorkspaceFile ?? workspaceFileToRead)
      : null;
  const isReadingFileSurface = Boolean(readingFile || activeWorkspaceFile);
  const readerCopied = readerCopyStatus === "copied";
  const readerCopyTooltip =
    readerCopyStatus === "copied"
      ? t("copied")
      : readerCopyStatus === "error"
        ? t("copyFailed")
        : t("copy");
  const readingTitle =
    readingMode === "file" && fileToRead
      ? t("readingFile", { name: fileToRead.name })
      : readingMode === "attachment" && attachmentToRead
        ? t("readingAttachment", { name: attachmentToRead.name })
        : readingMode === "long_text" && attachmentToRead
          ? t("longTextDocumentAria", { title: attachmentToRead.name })
          : activeWorkspaceFile
            ? t("workspaceFileAria", {
                title:
                  activeWorkspaceFile.title || activeWorkspaceFile.fileName,
              })
            : t("readingMessage");

  return (
    <>
      {pdfPrintJob &&
        createPortal(
          <div
            className="message-pdf-print-root"
            aria-hidden="true"
            data-print-job-id={pdfPrintJob.id}
          >
            <MessageOutputRenderer
              message={pdfPrintJob.message}
              displayedContent={pdfPrintJob.message.content}
              searchSources={pdfPrintJob.searchSources}
              ragSources={pdfPrintJob.ragSources}
              forcedTheme="light"
              forceExpandCodeBlocks
              forceExpandLongTextBlocks
            />
          </div>,
          document.body,
        )}
      {imageExportJob &&
        createPortal(
          <div
            className="message-image-export-root"
            aria-hidden="true"
            data-image-export-job-id={imageExportJob.id}
          >
            <div
              ref={imageExportRootRef}
              className="message-image-export-canvas"
              style={{ width: imageExportJob.width }}
            >
              <div className="message-export-content-root">
                <MessageOutputRenderer
                  message={imageExportJob.message}
                  displayedContent={imageExportJob.message.content}
                  searchSources={imageExportJob.searchSources}
                  ragSources={imageExportJob.ragSources}
                  forceExpandCodeBlocks
                  forceExpandLongTextBlocks
                  hideReasoning
                  hideToolCalls
                />
              </div>
            </div>
          </div>,
          document.body,
        )}

      {showAddToKnowledgeModal && (
        <AddToKnowledgeModal
          onClose={() => setShowAddToKnowledgeModal(false)}
          defaultTitle={`${getCurrentSession()?.title || t("readingMessage")}.md`}
          defaultContent={message.content}
        />
      )}

      {/* Immersive / Reading Modal */}
      {readingMode !== "none" &&
        createPortal(
          <div
            ref={readingDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={readingDialogTitleId}
            aria-describedby={readingDialogDescriptionId}
            tabIndex={-1}
            onKeyDown={handleReadingDialogKeyDown}
            className="fixed inset-0 z-999 bg-white dark:bg-background overflow-y-auto overscroll-contain motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-400/40"
          >
            <h2 id={readingDialogTitleId} className="sr-only">
              {readingTitle}
            </h2>
            <p id={readingDialogDescriptionId} className="sr-only">
              {t("pressEscapeToClose")}
            </p>
            <div className="max-w-5xl mx-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] md:pt-8 min-h-screen relative flex flex-col">
              {readingFile && (
                <div className="markdown-preview-header mb-4 flex shrink-0 items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2 text-gray-700 dark:text-foreground font-semibold">
                    <FileText
                      size={20}
                      className="text-blue-500 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="truncate">{readingFile.name}</span>
                    <span className="markdown-file-type-badge max-w-40 truncate rounded px-1.5 py-0.5 font-mono text-[10px] font-normal">
                      {readingFile.mimeType}
                    </span>
                    {fileToRead?.truncated && readingMode === "file" ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-200">
                        {t("truncated")}
                      </span>
                    ) : null}
                    {(fileToRead?.incomplete && readingMode === "file") ||
                    (readingMode === "long_text" && isInterrupted) ? (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-muted dark:text-foreground/85">
                        {t("incomplete")}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Tooltip content={readerCopyTooltip} position="bottom">
                      <Button
                        variant="bare"
                        type="button"
                        aria-label={t("copyFileAria", {
                          name: readingFile.name,
                        })}
                        onClick={handleCopyReadingFile}
                        className={`p-1.5 text-gray-500 hover:text-gray-700 dark:text-muted-foreground dark:hover:text-foreground hover:bg-gray-100 dark:hover:bg-muted rounded-lg transition-colors ${actionButtonFocusClass} ${
                          readerCopyStatus === "error"
                            ? "text-red-500 dark:text-red-400"
                            : ""
                        }`}
                      >
                        {readerCopied ? (
                          <Check size={18} aria-hidden="true" />
                        ) : (
                          <Copy size={18} aria-hidden="true" />
                        )}
                      </Button>
                    </Tooltip>
                    <Button
                      variant="bare"
                      type="button"
                      aria-label={t("downloadFileAria", {
                        name: readingFile.name,
                      })}
                      onClick={handleDownloadFile}
                      className={`p-1.5 text-gray-500 hover:text-gray-700 dark:text-muted-foreground dark:hover:text-foreground hover:bg-gray-100 dark:hover:bg-muted rounded-lg transition-colors ${actionButtonFocusClass}`}
                    >
                      <Download size={18} aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-auto custom-scrollbar">
                {activeWorkspaceFile ? (
                  <div className="mx-auto w-full max-w-4xl px-1 py-2">
                    <WorkspaceFileBlock
                      file={activeWorkspaceFile}
                      forceExpanded
                    />
                  </div>
                ) : readingFile ? (
                  readingFile.renderAsMarkdown ? (
                    <div className="mx-auto max-w-4xl px-1 py-2">
                      <MarkdownRenderer content={readingFile.content} />
                    </div>
                  ) : (
                    <div className="markdown-codeblock overflow-hidden rounded-lg">
                      <pre className="markdown-codeblock-content whitespace-pre-wrap wrap-break-word p-4 font-mono text-sm leading-relaxed">
                        {readingFile.content}
                      </pre>
                    </div>
                  )
                ) : (
                  <MessageOutputRenderer
                    message={message}
                    displayedContent={message.content}
                    searchSources={readingMode === "message" ? sources : []}
                    ragSources={readingMode === "message" ? ragSources : []}
                    onFileClick={handleFileClick}
                    onToolConfirmationDecision={
                      confirmationActionsDisabled
                        ? undefined
                        : onToolConfirmationDecision
                    }
                    onRevokeToolSessionApproval={
                      confirmationActionsDisabled
                        ? undefined
                        : onRevokeToolSessionApproval
                    }
                    forceExpandLongTextBlocks
                  />
                )}
              </div>

              <div className="sticky bottom-[max(1rem,env(safe-area-inset-bottom))] mt-4 left-0 right-0 flex justify-center pointer-events-none shrink-0">
                <Button
                  variant="bare"
                  type="button"
                  onClick={closeReadingMode}
                  className={`pointer-events-auto flex items-center gap-2 px-5 py-2.5 bg-red-500/80 hover:bg-red-600/80 backdrop-blur-md text-white rounded-full shadow-lg transition-[background-color,box-shadow,color] font-medium text-sm ${actionButtonFocusClass}`}
                >
                  {isReadingFileSurface ? (
                    <X size={18} aria-hidden="true" />
                  ) : (
                    <Minimize2 size={18} aria-hidden="true" />
                  )}
                  {isReadingFileSurface ? t("closeFile") : t("exitReading")}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <div className="message-item group relative flex flex-col md:flex-row gap-2 md:gap-3 rounded-md transition-[background-color,border-color] duration-200 border border-transparent px-3 py-3 bg-gray-50/0 hover:bg-gray-50/80 dark:hover:bg-muted/40">
        {/* Avatar & Header Section */}
        <div className="flex items-center w-full md:w-auto justify-between md:justify-start gap-2 md:block md:shrink-0 md:mt-0.5 select-none">
          <div className="flex items-center gap-2">
            {message.role === "model" ? (
              <Tooltip content={message.model || t("model")} position="right">
                <div className="w-6 h-6 md:w-8 md:h-8 rounded-lg md:rounded-xl bg-red-300 shadow-sm border border-white dark:border-border flex items-center justify-center text-white">
                  <Bot size={14} className="md:hidden" aria-hidden="true" />
                  <Bot
                    size={18}
                    className="hidden md:block"
                    aria-hidden="true"
                  />
                </div>
              </Tooltip>
            ) : (
              <div className="w-6 h-6 md:w-8 md:h-8 rounded-lg md:rounded-xl bg-green-300 shadow-sm border border-white dark:border-border flex items-center justify-center text-white">
                <User size={14} className="md:hidden" aria-hidden="true" />
                <User
                  size={18}
                  className="hidden md:block"
                  aria-hidden="true"
                />
              </div>
            )}
            <span className="text-sm font-medium text-gray-700 dark:text-foreground md:hidden">
              {message.role === "model"
                ? message.model || t("model")
                : t("user")}
            </span>
          </div>

          <Tooltip content={t("sentTime")} position="left">
            <span className="text-[10px] text-gray-400 dark:text-muted-foreground/70 font-normal md:hidden">
              {timeString}
            </span>
          </Tooltip>
        </div>

        {/* Content Area */}
        <div
          ref={visibleMessageContentRef}
          className="flex-1 min-w-0 pl-1 md:pl-0"
        >
          {message.replyTo ? (
            <Button
              variant="bare"
              type="button"
              onClick={() => onNavigateToMessage?.(message.replyTo!.messageId)}
              className={`mb-2 flex max-w-full items-start gap-2 rounded-md border border-border/70 bg-muted/30 px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground ${actionButtonFocusClass}`}
              aria-label={t("openReplySource")}
            >
              <Quote size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span className="line-clamp-2 wrap-break-word">
                {message.replyTo.excerpt || t("replySourceUnavailable")}
              </span>
            </Button>
          ) : null}

          {/* Attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-3 mb-2">
              {message.attachments.map((att, idx) => (
                <MessageAttachmentView
                  key={att.id}
                  attachment={att}
                  onImageClick={() => handleAttachmentClick(idx)}
                  onDocumentClick={handleDocumentAttachmentClick}
                  onAttachmentCached={persistCachedMessageAttachments}
                />
              ))}
            </div>
          )}

          {isEditing ? (
            message.role === "user" ? (
              <UserMessageEditor
                initialContent={message.content}
                onCancel={() => setIsEditing(false)}
                onSubmit={async (newContent) => {
                  await onSubmitUserEdit?.(message.id, newContent);
                  setIsEditing(false);
                }}
              />
            ) : (
              <Artifact
                initialContent={message.content}
                initialTimestamp={message.timestamp}
                onSave={(newContent) => {
                  onEdit(message.id, newContent);
                  setIsEditing(false);
                }}
                onCancel={() => setIsEditing(false)}
                systemInstruction={getCurrentSession()?.systemInstruction}
                model={selectedModel}
              />
            )
          ) : (
            <>
              {/* RAG Block Component */}
              <RAGBlock sources={ragSources} error={ragError} />

              {skillInvocations.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {skillInvocations.map((skill) => (
                    <Tooltip
                      key={`${skill.id}-${skill.mode}`}
                      content={
                        skill.description ||
                        t("skillAppliedTooltip", {
                          title: skill.title,
                          mode:
                            skill.mode === "manual"
                              ? t("skillModeManual")
                              : t("skillModeAuto"),
                        })
                      }
                      position="top"
                      portal
                    >
                      <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200">
                        <Sparkles size={11} aria-hidden="true" />
                        <span className="truncate">{skill.title}</span>
                      </span>
                    </Tooltip>
                  ))}
                </div>
              )}

              {generationError ? (
                <div
                  role="alert"
                  aria-live="polite"
                  className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100"
                >
                  <div className="font-semibold">{t("generationFailed")}</div>
                  <div className="mt-1 wrap-break-word">
                    {generationError.message}
                  </div>
                  {generationError.recoverable ? (
                    <div className="mt-1 text-xs opacity-80">
                      {t("generationRecoverable")}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {isInterrupted ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
                >
                  <div className="min-w-0">
                    <div className="font-semibold">
                      {t("generationInterrupted")}
                    </div>
                    <div className="mt-0.5 text-xs opacity-80">
                      {continuationBlocked
                        ? t("continuationBlockedByTools")
                        : t("partialOutputPreserved")}
                    </div>
                  </div>
                  {!continuationBlocked && onContinue ? (
                    <Button
                      variant="bare"
                      type="button"
                      onClick={onContinue}
                      disabled={mutationActionsDisabled}
                      className={`rounded-md border border-amber-300 bg-white/70 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950 dark:hover:bg-amber-900 ${actionButtonFocusClass}`}
                    >
                      {t("continueGeneration")}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <MessageOutputRenderer
                message={message}
                displayedContent={displayedContent}
                isTyping={isTyping}
                isThinking={isThinking}
                isErrorMessage={isErrorMessage}
                searchSources={sources}
                ragSources={ragSources}
                onFileClick={handleFileClick}
                onImageCached={persistCachedOutputImage}
                onLongTextOpen={handleLongTextOpen}
                onWorkspaceFileOpen={handleWorkspaceFileOpen}
                onStopAgentRun={isTyping ? onStopGeneration : undefined}
                onToolConfirmationDecision={
                  confirmationActionsDisabled
                    ? undefined
                    : onToolConfirmationDecision
                }
                onRevokeToolSessionApproval={
                  confirmationActionsDisabled
                    ? undefined
                    : onRevokeToolSessionApproval
                }
              />

              {isModelResponseLoading ? (
                <div
                  className="mt-2 h-8 w-14 text-red-300 dark:text-red-400"
                  role="status"
                  aria-label={t("generatingResponse")}
                >
                  <BubblesLoading
                    className="h-full w-full"
                    aria-hidden="true"
                  />
                </div>
              ) : null}
            </>
          )}

          {ttsError ? (
            <div
              role="status"
              aria-live="polite"
              className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
            >
              {ttsError}
            </div>
          ) : null}
          {imageExportError ? (
            <div
              role="alert"
              aria-live="polite"
              className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100"
            >
              {imageExportError}
            </div>
          ) : null}

          {/* Footer / Toolbar */}
          {!isEditing && !isTyping && (
            <div className="flex items-center justify-between mt-1 h-6 opacity-100 md:opacity-40 md:group-hover:opacity-100 transition-opacity duration-200">
              <div className="flex items-center text-xs text-gray-400 dark:text-muted-foreground/70 select-none [&>span:not(:last-child)]:after:content-['·'] [&>span:not(:last-child)]:after:mx-1 [&>span:not(:last-child)]:after:text-gray-300 dark:[&>span:not(:last-child)]:after:text-border">
                <span className="hidden md:inline hover:text-gray-600 dark:hover:text-foreground/85 transition-colors cursor-default">
                  <Tooltip
                    className="inline-flex"
                    content={t("generationTime")}
                    position="top"
                  >
                    {timeString}
                  </Tooltip>
                </span>
                {durationString && (
                  <span className="hidden md:inline hover:text-gray-600 dark:hover:text-foreground/85 transition-colors cursor-default">
                    <Tooltip
                      className="inline-flex"
                      content={t("duration")}
                      position="top"
                    >
                      {durationString}
                    </Tooltip>
                  </span>
                )}
                {tokenCount > 0 && (
                  <span className="hidden md:inline hover:text-gray-600 dark:hover:text-foreground/85 transition-colors cursor-default">
                    <Tooltip
                      className="inline-flex"
                      content={t("tokens")}
                      position="top"
                    >
                      {t("tokenCount", { count: tokenCount })}
                    </Tooltip>
                  </span>
                )}
                {mobileMetaRows.length > 0 && (
                  <span className="inline-flex md:hidden">
                    <Tooltip
                      className="inline-flex"
                      trigger="click"
                      content={
                        <span className="flex flex-col gap-0.5 text-left">
                          {mobileMetaRows.map((row) => (
                            <span key={row}>{row}</span>
                          ))}
                        </span>
                      }
                      position="right"
                    >
                      <Button
                        variant="bare"
                        type="button"
                        aria-label={mobileMetaRows.join(", ")}
                        className={`rounded-lg p-1 text-gray-400 transition-[background-color,color] hover:bg-gray-100 hover:text-gray-600 dark:text-muted-foreground/70 dark:hover:bg-muted dark:hover:text-foreground/85 ${actionButtonFocusClass}`}
                      >
                        <Info size={13} aria-hidden="true" />
                      </Button>
                    </Tooltip>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1 text-gray-400 dark:text-muted-foreground/70 relative">
                {hasMultipleBranches && onVersionChange && (
                  <>
                    <div className="flex items-center gap-0.5">
                      <ActionButton
                        icon={<ChevronLeft size={13} />}
                        tooltip={t("previousVersion")}
                        onClick={() => onVersionChange(message.id, "prev")}
                        disabled={
                          mutationActionsDisabled || currentBranchIndex === 0
                        }
                        className={
                          currentBranchIndex === 0
                            ? "opacity-30 cursor-not-allowed"
                            : ""
                        }
                      />
                      {onVersionSelect ? (
                        <DropdownMenu>
                          <Tooltip
                            content={t("openBranchNavigator")}
                            position="top"
                          >
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="bare"
                                type="button"
                                aria-label={t("openBranchNavigator")}
                                className="inline-flex rounded px-1 py-0.5 font-mono text-[9px] text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 dark:hover:bg-accent dark:hover:text-foreground"
                              >
                                {currentBranchIndex + 1}/{branchCount}
                              </Button>
                            </DropdownMenuTrigger>
                          </Tooltip>
                          <DropdownMenuContent
                            side="top"
                            align="center"
                            className="max-h-72 w-80 overflow-y-auto"
                          >
                            <DropdownMenuLabel>
                              {t("branchNavigatorTitle")}
                            </DropdownMenuLabel>
                            {branchOptions.map((option, optionIndex) => (
                              <DropdownMenuItem
                                key={option.id}
                                onSelect={() => onVersionSelect(option.id)}
                                className="items-start gap-2 py-2"
                              >
                                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                                  {option.active ? (
                                    <Check size={13} aria-hidden="true" />
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground">
                                      {optionIndex + 1}
                                    </span>
                                  )}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                                    <span>
                                      {option.message.role === "user"
                                        ? t("branchRoleUser")
                                        : option.message.model ||
                                          t("branchRoleAssistant")}
                                    </span>
                                    <span>
                                      {new Intl.DateTimeFormat(locale, {
                                        month: "short",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      }).format(
                                        new Date(option.message.timestamp),
                                      )}
                                    </span>
                                  </span>
                                  <span className="mt-0.5 block truncate text-xs text-foreground">
                                    {option.message.content.trim() ||
                                      t("branchEmptyContent")}
                                  </span>
                                </span>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span className="px-0.5 font-mono text-[9px] text-gray-400">
                          {currentBranchIndex + 1}/{branchCount}
                        </span>
                      )}
                      <ActionButton
                        icon={<ChevronRight size={13} />}
                        tooltip={t("nextVersion")}
                        onClick={() => onVersionChange(message.id, "next")}
                        disabled={
                          mutationActionsDisabled ||
                          currentBranchIndex === branchCount - 1
                        }
                        className={
                          currentBranchIndex === branchCount - 1
                            ? "opacity-30 cursor-not-allowed"
                            : ""
                        }
                      />
                    </div>
                    <div className="hidden md:block w-px h-3 bg-gray-200 dark:bg-accent mx-1.5" />
                  </>
                )}

                {message.role === "user" && (
                  <>
                    {onRetract && (
                      <ActionButton
                        icon={<Undo2 size={13} />}
                        tooltip={t("retract")}
                        onClick={onRetract}
                        disabled={mutationActionsDisabled}
                      />
                    )}
                    {canEditCurrentUserMessage && (
                      <ActionButton
                        icon={<Edit2 size={13} />}
                        tooltip={t("edit")}
                        onClick={handleEditClick}
                      />
                    )}
                    <ActionButton
                      icon={isCopied ? <Check size={13} /> : <Copy size={13} />}
                      tooltip={copyTooltip}
                      onClick={handleCopy}
                      className={
                        copyStatus === "error"
                          ? "text-red-500 dark:text-red-400"
                          : ""
                      }
                    />
                    <ActionButton
                      icon={
                        isTTSLoading ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : isPlaying ? (
                          <VolumeX size={13} />
                        ) : (
                          <Volume2 size={13} />
                        )
                      }
                      tooltip={isPlaying ? t("stop") : t("readAloud")}
                      onClick={handleToggleReadAloud}
                      ariaPressed={isPlaying}
                      ariaBusy={isTTSLoading}
                      className={
                        isPlaying ? "text-blue-500 dark:text-blue-400" : ""
                      }
                    />
                  </>
                )}

                {onReply ? (
                  <ActionButton
                    icon={<Quote size={13} />}
                    tooltip={t("reply")}
                    onClick={onReply}
                    disabled={mutationActionsDisabled}
                  />
                ) : null}

                {message.role === "model" && (
                  <>
                    <div className="flex items-center">
                      <ActionButton
                        icon={<RefreshCw size={13} />}
                        tooltip={t("regenerate")}
                        onClick={() => onRegenerate?.()}
                        disabled={mutationActionsDisabled || !onRegenerate}
                      />
                      {onRegenerate && availableModels.length > 0 ? (
                        <DropdownMenu>
                          <Tooltip
                            content={t("regenerateWithModel")}
                            position="top"
                          >
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="bare"
                                type="button"
                                aria-label={t("regenerateWithModel")}
                                disabled={mutationActionsDisabled}
                                className={`-ml-1 rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-muted dark:hover:text-foreground ${actionButtonFocusClass}`}
                              >
                                <ChevronDown size={11} aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                          </Tooltip>
                          <DropdownMenuContent
                            side="top"
                            align="end"
                            className="max-h-64 w-60 overflow-y-auto custom-scrollbar"
                          >
                            <DropdownMenuLabel>
                              {t("regenerateWithModel")}
                            </DropdownMenuLabel>
                            {availableModels.map((model) => (
                              <DropdownMenuItem
                                key={model.name}
                                onSelect={() => onRegenerate(model.name)}
                              >
                                <span className="truncate">
                                  {model.displayName}
                                </span>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                    <ActionButton
                      icon={<Edit2 size={13} />}
                      tooltip={t("edit")}
                      onClick={handleEditClick}
                      disabled={
                        mutationActionsDisabled || isFlatModelEditUnsupported
                      }
                      containerClass="hidden! md:flex!"
                    />
                    <ActionButton
                      icon={isCopied ? <Check size={13} /> : <Copy size={13} />}
                      tooltip={copyTooltip}
                      onClick={handleCopy}
                      className={
                        copyStatus === "error"
                          ? "text-red-500 dark:text-red-400"
                          : ""
                      }
                    />
                    <ActionButton
                      icon={
                        isTTSLoading ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : isPlaying ? (
                          <VolumeX size={13} />
                        ) : (
                          <Volume2 size={13} />
                        )
                      }
                      tooltip={isPlaying ? t("stop") : t("readAloud")}
                      onClick={handleToggleReadAloud}
                      ariaPressed={isPlaying}
                      ariaBusy={isTTSLoading}
                      className={
                        isPlaying ? "text-blue-500 dark:text-blue-400" : ""
                      }
                    />
                  </>
                )}

                {message.role === "model" && (
                  <>
                    <ActionButton
                      icon={<Maximize2 size={13} />}
                      tooltip={t("reading")}
                      onClick={handleImmersiveReading}
                    />
                    <ActionButton
                      icon={<Library size={13} />}
                      tooltip={t("addToKnowledge")}
                      onClick={handleAddToKnowledge}
                      containerClass="hidden! md:flex!"
                    />
                    <div className="hidden! md:flex!">
                      <DropdownMenu>
                        <Tooltip
                          content={
                            isDownloading
                              ? t("downloadInProgress")
                              : t("download")
                          }
                          position="top"
                        >
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="bare"
                              type="button"
                              aria-label={
                                isDownloading
                                  ? t("downloadInProgress")
                                  : t("downloadFormat")
                              }
                              aria-busy={isDownloading}
                              disabled={isDownloading}
                              className={`p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-muted hover:text-gray-700 dark:hover:text-foreground/85 transition-[background-color,border-color,color,opacity] relative group/btn border border-transparent hover:border-white/50 dark:hover:border-border flex items-center justify-center ${actionButtonFocusClass}`}
                            >
                              {isDownloading ? (
                                <Loader2
                                  size={13}
                                  className="animate-spin"
                                  aria-hidden="true"
                                />
                              ) : (
                                <Download size={13} aria-hidden="true" />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                        </Tooltip>
                        <DropdownMenuContent side="top" align="end">
                          <DropdownMenuItem
                            disabled={isDownloading}
                            onSelect={handleDownloadMarkdown}
                          >
                            <FileText
                              size={14}
                              className="text-gray-500 dark:text-muted-foreground"
                              aria-hidden="true"
                            />
                            <span>{t("downloadMarkdown")}</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={isDownloading}
                            onSelect={handleDownloadPdf}
                          >
                            <Signature
                              size={14}
                              className="text-gray-500 dark:text-muted-foreground"
                              aria-hidden="true"
                            />
                            <span>{t("downloadPdf")}</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={isDownloading}
                            onSelect={handleDownloadImage}
                          >
                            <FileImage
                              size={14}
                              className="text-gray-500 dark:text-muted-foreground"
                              aria-hidden="true"
                            />
                            <span>{t("downloadImage")}</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </>
                )}

                <ActionButton
                  icon={
                    isDeleteConfirming ? (
                      <Check size={13} />
                    ) : (
                      <Trash2 size={13} />
                    )
                  }
                  tooltip={
                    isDeleteConfirming ? t("confirmDelete") : t("delete")
                  }
                  onClick={handleDeleteClick}
                  disabled={mutationActionsDisabled}
                  containerClass={
                    message.role === "user" ? "flex" : "hidden! md:flex!"
                  }
                  className={
                    isDeleteConfirming
                      ? "text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/30"
                      : "hover:text-red-600 dark:hover:text-red-400"
                  }
                />

                {message.role === "model" && (
                  <div className="relative md:hidden">
                    <DropdownMenu
                      open={showMoreMenu}
                      onOpenChange={(open) => {
                        if (!open) resetDeleteConfirmation();
                        setShowMoreMenu(open);
                      }}
                    >
                      <Tooltip
                        content={
                          isDownloading ? t("downloadInProgress") : t("more")
                        }
                        position="top"
                      >
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="bare"
                            type="button"
                            aria-label={t("more")}
                            aria-busy={isDownloading}
                            disabled={isDownloading}
                            className={`p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-muted hover:text-gray-700 dark:hover:text-foreground/85 transition-[background-color,border-color,color,opacity] relative group/btn border border-transparent hover:border-white/50 dark:hover:border-border flex items-center justify-center ${actionButtonFocusClass} ${
                              showMoreMenu
                                ? "bg-gray-100 dark:bg-muted text-gray-700 dark:text-foreground/85"
                                : ""
                            }`}
                          >
                            {isDownloading ? (
                              <Loader2
                                size={13}
                                className="animate-spin"
                                aria-hidden="true"
                              />
                            ) : (
                              <MoreHorizontal size={13} aria-hidden="true" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                      </Tooltip>

                      <DropdownMenuContent
                        side="top"
                        align="end"
                        className="w-48"
                      >
                        <DropdownMenuItem
                          disabled={
                            mutationActionsDisabled ||
                            isFlatModelEditUnsupported
                          }
                          onSelect={() => {
                            handleEditClick();
                            setShowMoreMenu(false);
                          }}
                        >
                          <Edit2
                            size={14}
                            className="text-gray-500 dark:text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span>{t("edit")}</span>
                        </DropdownMenuItem>

                        <DropdownMenuItem
                          disabled={mutationActionsDisabled}
                          onSelect={handleAddToKnowledge}
                        >
                          <Library
                            size={14}
                            className="text-gray-500 dark:text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span>{t("addToKnowledge")}</span>
                        </DropdownMenuItem>

                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger disabled={isDownloading}>
                            {isDownloading ? (
                              <Loader2
                                size={14}
                                className="animate-spin text-gray-500 dark:text-muted-foreground"
                                aria-hidden="true"
                              />
                            ) : (
                              <Download
                                size={14}
                                className="text-gray-500 dark:text-muted-foreground"
                                aria-hidden="true"
                              />
                            )}
                            <span>
                              {isDownloading
                                ? t("downloadInProgress")
                                : t("download")}
                            </span>
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuItem
                              disabled={isDownloading}
                              onSelect={handleDownloadMarkdown}
                            >
                              <FileText
                                size={14}
                                className="text-gray-500 dark:text-muted-foreground"
                                aria-hidden="true"
                              />
                              <span>{t("downloadMarkdown")}</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={isDownloading}
                              onSelect={handleDownloadPdf}
                            >
                              <Signature
                                size={14}
                                className="text-gray-500 dark:text-muted-foreground"
                                aria-hidden="true"
                              />
                              <span>{t("downloadPdf")}</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={isDownloading}
                              onSelect={handleDownloadImage}
                            >
                              <FileImage
                                size={14}
                                className="text-gray-500 dark:text-muted-foreground"
                                aria-hidden="true"
                              />
                              <span>{t("downloadImage")}</span>
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>

                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={mutationActionsDisabled}
                          onSelect={(event) => {
                            event.preventDefault();
                            handleDeleteClick();
                          }}
                          className={
                            isDeleteConfirming
                              ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200"
                              : undefined
                          }
                        >
                          {isDeleteConfirming ? (
                            <Check size={14} aria-hidden="true" />
                          ) : (
                            <Trash2
                              size={14}
                              className="group-hover:text-red-600 dark:group-hover:text-red-400"
                              aria-hidden="true"
                            />
                          )}
                          <span>
                            {isDeleteConfirming
                              ? t("confirmDelete")
                              : t("delete")}
                          </span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

interface ActionButtonProps {
  icon: React.ReactNode;
  tooltip: string;
  onClick?: () => void;
  className?: string;
  containerClass?: string;
  disabled?: boolean;
  ariaPressed?: boolean;
  ariaBusy?: boolean;
  ariaExpanded?: boolean;
  ariaControls?: string;
}

const ActionButton = ({
  icon,
  tooltip,
  onClick,
  className = "",
  containerClass = "",
  disabled = false,
  ariaPressed,
  ariaBusy,
  ariaExpanded,
  ariaControls,
}: ActionButtonProps) => {
  const renderedIcon = React.isValidElement(icon)
    ? React.cloneElement(icon as React.ReactElement<Record<string, unknown>>, {
        "aria-hidden": true,
        focusable: "false",
      })
    : icon;

  return (
    <Tooltip content={tooltip} position="top" className={containerClass}>
      <Button
        variant="bare"
        type="button"
        aria-label={tooltip}
        aria-pressed={ariaPressed}
        aria-busy={ariaBusy}
        aria-expanded={ariaExpanded}
        aria-controls={ariaControls}
        onClick={onClick}
        disabled={disabled || !onClick}
        className={`p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-muted hover:text-gray-700 dark:hover:text-foreground/85 transition-[background-color,border-color,color,opacity] relative group/btn border border-transparent hover:border-white/50 dark:hover:border-border flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-40 ${actionButtonFocusClass} ${className}`}
      >
        {renderedIcon}
      </Button>
    </Tooltip>
  );
};

export default MessageItem;
