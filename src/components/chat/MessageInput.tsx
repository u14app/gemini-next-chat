"use client";
import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useId,
} from "react";
import { v7 as uuidv7 } from "uuid";
import {
  SendHorizontal,
  Paperclip,
  Mic,
  X,
  StopCircle,
  Loader2,
  Cpu,
  Globe,
  Lightbulb,
  Blocks,
  Link,
  ChevronDown,
  FileUp,
  ImageUp,
  Square,
  Library,
  PencilSparkles,
  Sparkles,
  Quote,
  Bot,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  Attachment,
  Message,
  MessageReplyReference,
  ReasoningMode,
  SessionMessageTree,
} from "@/types";
import { localizePluginMeta } from "@/lib/plugin/localizedMeta";
import type { ModelInfo } from "@/services/api/chatService";
import Tooltip from "../ui/Tooltip";
import RemoteFileModal from "../modals/RemoteFileModal";
import KnowledgeSelectionModal from "../knowledge/KnowledgeSelectionModal";
import SafeImage from "../ui/SafeImage";
import MessageInputAttachmentTray from "./MessageInputAttachmentTray";
import ComposerCommandMenu from "./ComposerCommandMenu";
import ComposerReferenceChips from "./ComposerReferenceChips";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChatStore } from "@/store/core/chatStore";
import { appDb } from "@/store/storage/storageConfig";
import {
  getActiveMessagePath,
  normalizeSessionMessageTree,
} from "@/lib/chat/messageTree";
import { getTaskModel, useSettingsStore } from "@/store/core/settingsStore";
import { useCoreSettingsStore } from "@/store/core/coreSettingsStore";
import { ATTACHMENT_LIMITS } from "@/config/limits";
import { parseModelString } from "@/lib/utils/model";
import { logDevError } from "@/lib/utils/devLogger";
import {
  extractChatAttachmentFilesFromClipboard,
  extractChatAttachmentFilesFromDrop,
} from "@/lib/utils/chatAttachmentFiles";
import {
  resolveEffectiveSearchCapability,
  getSearchProviderLabel,
  type SearchCompatibilityReason,
} from "@/lib/settings/searchRag";
import { hasPluginAuthValue } from "@/lib/security/localSecretResolvers";
import { isPluginAuthRequired } from "@/lib/plugin/config";
import { isKnowledgeAttachment } from "@/lib/utils/knowledgeAttachments";
import { encodeTextToBase64 } from "@/lib/utils/documentAttachments";
import { polishTextContent } from "@/services/artifactService";
import { normalizeSkillIdRefs } from "@/lib/skills";
import {
  formatRecordingTime as formatTime,
  shouldSubmitOnEnter,
  truncateMiddle,
} from "@/lib/utils/messageInputHelpers";
import {
  buildConversationFileName,
  buildConversationTranscript,
  CONVERSATION_REFERENCE_MAX_CHARS,
  detectComposerTrigger,
} from "@/lib/utils/composerCommands";
import { buildCompressionSource } from "@/lib/utils/contextCompression";
import {
  isReasoningEnabled,
  normalizeReasoningMode,
} from "@/lib/chat/reasoning";
import {
  clearComposerDraft,
  readComposerDraft,
  writeComposerDraft,
} from "@/lib/chat/composerDrafts";
import {
  useComposerAttachments,
  useComposerCapabilityState,
  useComposerCommandMenu,
  useComposerMenuState,
  useComposerRecording,
} from "@/features/chat";
import type { ComposerSkillParameterValues } from "@/components/skill/SkillParameterDialog";
import {
  ShortcutTooltipContent,
  useShortcutPresentation,
} from "@/components/shortcuts/ShortcutHint";
import { Button } from "@/components/ui/primitives";

type MessageInputVariant = "default" | "hero";

/** Skills and plugins pulled in with `/` and `@`, forced onto the next send. */
export interface ComposerForcedInvocations {
  skillIds: string[];
  pluginIds: string[];
}

interface MessageInputProps {
  onSend: (
    text: string,
    attachments: Attachment[],
    replyTo?: MessageReplyReference,
    skillParameters?: ComposerSkillParameterValues,
    forced?: ComposerForcedInvocations,
  ) => void;
  onPrepareSend?: (
    forced?: ComposerForcedInvocations,
  ) => Promise<ComposerSkillParameterValues | null>;
  onStop?: () => void;
  disabled: boolean;
  offline?: boolean;
  availableModels?: ModelInfo[];
  selectedModel?: string;
  onSelectModel?: (model: string) => void;
  isSearchEnabled?: boolean;
  onToggleSearch?: () => void;
  variant?: MessageInputVariant;
  replyTo?: MessageReplyReference;
  onCancelReply?: () => void;
  onNavigateReply?: (messageId: string) => void;
  onNewChat?: () => void;
  onCompressContext?: () => void | Promise<void>;
}

export interface MessageInputRef {
  setValue: (value: string) => void;
  focus: () => void;
  setAttachments: (attachments: Attachment[]) => void;
}

const logInputError = logDevError;

const iconButtonFocusClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-background";

const iconButtonBaseClass =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg";

const loadChatService = () => import("@/services/api/chatService");

const MessageInput = forwardRef<MessageInputRef, MessageInputProps>(
  (
    {
      onSend,
      onPrepareSend,
      onStop,
      disabled,
      offline = false,
      availableModels = [],
      selectedModel = "",
      onSelectModel,
      isSearchEnabled = false,
      onToggleSearch,
      variant = "default",
      replyTo,
      onCancelReply,
      onNavigateReply,
      onNewChat,
      onCompressContext,
    },
    ref,
  ) => {
    const [input, setInputState] = useState("");
    const inputValueRef = useRef("");
    const setInput = useCallback((next: React.SetStateAction<string>) => {
      setInputState((previous) => {
        const value =
          typeof next === "function"
            ? (next as (previous: string) => string)(previous)
            : next;
        inputValueRef.current = value;
        return value;
      });
    }, []);
    const {
      showAttachMenu,
      showSkillSelect,
      showPluginSelect,
      showReasoningSelect,
      showModelSelect,
      setShowAttachMenu,
      setShowSkillSelect,
      setShowPluginSelect,
      setShowReasoningSelect,
      setShowModelSelect,
    } = useComposerMenuState();
    const [showRemoteModal, setShowRemoteModal] = useState(false);
    const [showKBModal, setShowKBModal] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [isDragUploadActive, setIsDragUploadActive] = useState(false);
    const [isPolishingInput, setIsPolishingInput] = useState(false);
    const [isPreparingSend, setIsPreparingSend] = useState(false);
    const [forcedSkillIds, setForcedSkillIds] = useState<string[]>([]);
    const [forcedPluginIds, setForcedPluginIds] = useState<string[]>([]);

    const t = useTranslations("MessageInput");
    const tConfig = useTranslations("Config");
    const focusComposerShortcut = useShortcutPresentation("focusComposer");
    const stopGenerationShortcut = useShortcutPresentation("stopGeneration");
    const {
      chatConfig,
      setChatConfig,
      currentSessionId,
      sessions,
      updateSessionConfig,
    } = useChatStore();
    const {
      modelMetadata,
      customModelMetadata,
      installedPlugins,
      activePlugins,
      togglePluginActive,
      installedSkills,
      pluginConfigs,
      voice,
      search,
      rag,
      system,
      serverConfig,
    } = useSettingsStore();

    const { providers } = useCoreSettingsStore();

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const composerRootRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const textFallbackInputRef = useRef<HTMLInputElement>(null);
    const messageInputId = useId();
    const errorMessageId = useId();
    const commandListboxId = useId();
    const attachFileInputId = useId();
    const attachImageInputId = useId();
    const attachTextFallbackInputId = useId();
    const isHeroVariant = variant === "hero";
    const draftSessionRef = useRef<string | null>(null);

    useEffect(() => {
      const previousSessionId = draftSessionRef.current;
      if (previousSessionId && previousSessionId !== currentSessionId) {
        writeComposerDraft(previousSessionId, inputValueRef.current);
      }

      draftSessionRef.current = currentSessionId || null;
      const draft = currentSessionId ? readComposerDraft(currentSessionId) : "";
      inputValueRef.current = draft;
      setInputState(draft);
    }, [currentSessionId]);

    useEffect(() => {
      if (!currentSessionId || draftSessionRef.current !== currentSessionId) {
        return;
      }

      const timer = window.setTimeout(() => {
        writeComposerDraft(currentSessionId, input);
      }, 150);
      return () => window.clearTimeout(timer);
    }, [currentSessionId, input]);

    useEffect(
      () => () => {
        if (draftSessionRef.current) {
          writeComposerDraft(draftSessionRef.current, inputValueRef.current);
        }
      },
      [],
    );

    const isMountedRef = useRef(true);
    const fileSelectionRunRef = useRef(0);
    const fileSelectionAbortRef = useRef<AbortController | null>(null);
    const polishRunRef = useRef(0);
    const dragDepthRef = useRef(0);

    // Clear error after 3 seconds
    useEffect(() => {
      if (errorMsg) {
        const timer = setTimeout(() => setErrorMsg(null), 3000);
        return () => clearTimeout(timer);
      }
    }, [errorMsg]);

    const selectedModelProvider = useMemo(() => {
      if (!selectedModel) return providers.find((provider) => provider.enabled);
      const { providerId } = parseModelString(selectedModel);
      return providerId
        ? providers.find((provider) => provider.id === providerId)
        : providers.find((provider) => provider.enabled);
    }, [selectedModel, providers]);

    const searchCompatibility = useMemo(() => {
      const searchConfig =
        search.provider === "google"
          ? undefined
          : search.configs[search.provider];

      return resolveEffectiveSearchCapability({
        searchProvider: search.provider,
        searchConfig,
        modelProviderType: selectedModelProvider?.type,
        selectedModel,
      });
    }, [search, selectedModel, selectedModelProvider?.type]);

    const getSearchUnavailableMessage = (
      reason: SearchCompatibilityReason | undefined,
    ) => {
      switch (reason) {
        case "missing_model_provider":
          return t("searchUnavailableNoProvider");
        case "google_requires_gemini":
          return t("searchUnavailableGoogleGemini");
        case "model_builtin_search_unsupported":
          return t("searchUnavailableModelBuiltIn");
        case "missing_server_default":
          return t("searchUnavailableServerDefault");
        case "missing_search_api_key":
          return t("searchUnavailableApiKey", {
            provider: getSearchProviderLabel(searchCompatibility.provider),
          });
        case "missing_search_base_url":
          return t("searchUnavailableBaseUrl", {
            provider: getSearchProviderLabel(searchCompatibility.provider),
          });
        default:
          return t("searchUnavailableGeneric");
      }
    };

    const searchModeLabel =
      searchCompatibility.mode === "gemini-google"
        ? t("searchModeGeminiGoogle")
        : searchCompatibility.mode === "openai-web"
          ? t("searchModeOpenAIWeb")
          : t("searchModeExternal", {
              provider: getSearchProviderLabel(searchCompatibility.provider),
            });

    const searchTooltip = !searchCompatibility.enabled
      ? getSearchUnavailableMessage(searchCompatibility.reason)
      : isSearchEnabled
        ? t("disableSearchWithMode", { mode: searchModeLabel })
        : t("enableSearchWithMode", { mode: searchModeLabel });

    const handleSearchToggle = () => {
      if (!searchCompatibility.enabled) {
        setErrorMsg(getSearchUnavailableMessage(searchCompatibility.reason));
        return;
      }
      onToggleSearch?.();
    };

    const currentSession = useMemo(
      () => sessions.find((session) => session.id === currentSessionId),
      [currentSessionId, sessions],
    );
    const activeSkillIds = useMemo(
      () =>
        normalizeSkillIdRefs(
          currentSession?.config?.activeSkills,
          installedSkills,
        ),
      [currentSession?.config?.activeSkills, installedSkills],
    );
    const activeSkillSet = useMemo(
      () => new Set(activeSkillIds),
      [activeSkillIds],
    );
    const skillsForMenu = useMemo(
      () =>
        [...installedSkills].sort((a, b) =>
          a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
        ),
      [installedSkills],
    );
    const setSessionActiveSkillIds = useCallback(
      (skillIds: string[]) => {
        if (!currentSessionId) return;
        updateSessionConfig(currentSessionId, {
          activeSkills: normalizeSkillIdRefs(skillIds, installedSkills),
        });
      },
      [currentSessionId, installedSkills, updateSessionConfig],
    );
    const toggleSessionSkill = useCallback(
      (skillId: string) => {
        setSessionActiveSkillIds(
          activeSkillSet.has(skillId)
            ? activeSkillIds.filter((id) => id !== skillId)
            : [...activeSkillIds, skillId],
        );
      },
      [activeSkillIds, activeSkillSet, setSessionActiveSkillIds],
    );
    // Group models by provider name
    const groupedModels = useMemo(() => {
      const groups: Record<string, ModelInfo[]> = {};
      availableModels.forEach((model) => {
        const pName = model.providerName || "System";
        if (!groups[pName]) groups[pName] = [];
        groups[pName].push(model);
      });
      return groups;
    }, [availableModels]);

    const reasoningOptionLabels = useMemo<
      Record<ReasoningMode, { label: string; description: string }>
    >(
      () => ({
        off: {
          label: t("reasoningModeOff"),
          description: t("reasoningModeOffDescription"),
        },
        auto: {
          label: t("reasoningModeAuto"),
          description: t("reasoningModeAutoDescription"),
        },
        low: {
          label: t("reasoningModeLow"),
          description: t("reasoningModeLowDescription"),
        },
        medium: {
          label: t("reasoningModeMedium"),
          description: t("reasoningModeMediumDescription"),
        },
        high: {
          label: t("reasoningModeHigh"),
          description: t("reasoningModeHighDescription"),
        },
      }),
      [t],
    );
    const {
      modelCapabilities,
      agentModeEnabled,
      isReasoningSupported,
      currentReasoningMode,
      isReasoningEnabledForMode,
      reasoningOptions,
      currentReasoningOption,
    } = useComposerCapabilityState({
      selectedModel,
      modelMetadata,
      customModelMetadata,
      reasoningMode: chatConfig.reasoningMode,
      useReasoning: chatConfig.useReasoning,
      useAgentMode: chatConfig.useAgentMode ?? false,
      reasoningOptionLabels,
    });
    const maxAttachmentFileBytes =
      serverConfig?.limits?.attachments?.maxFileBytes ??
      ATTACHMENT_LIMITS.maxFileBytes;

    const {
      attachments,
      setAttachments,
      isParsingAttachments,
      setIsParsingAttachments,
      attachmentProcessingStage,
      setAttachmentProcessingStage,
      appendAttachments,
      processSelectedFiles,
      handleFileSelect,
      handleTextFallbackSelect,
      removeAttachment,
      handleKBSelect,
    } = useComposerAttachments({
      offline,
      system,
      rag,
      modelCapabilities,
      maxAttachmentFileBytes,
      t,
      isMountedRef,
      fileSelectionRunRef,
      fileSelectionAbortRef,
      setErrorMsg,
      setShowAttachMenu,
    });

    const {
      isRecording,
      isTranscribing,
      recordingSeconds,
      toggleRecording,
      teardownRecording,
    } = useComposerRecording({
      offline,
      voice,
      maxAttachmentFileBytes,
      t,
      isMountedRef,
      appendTranscript: (text) =>
        setInput((prev) => prev + (prev ? " " : "") + text),
      appendAttachments,
      setErrorMsg,
    });

    useEffect(() => {
      isMountedRef.current = true;

      return () => {
        isMountedRef.current = false;
        fileSelectionRunRef.current += 1;
        fileSelectionAbortRef.current?.abort();
        fileSelectionAbortRef.current = null;
        polishRunRef.current += 1;
        teardownRecording();
      };
    }, [teardownRecording]);
    const agentModeTooltip = !modelCapabilities.toolCall
      ? t("agentModeUnavailable")
      : agentModeEnabled
        ? t("disableAgentMode")
        : t("enableAgentMode");
    const agentSearchRequiresExternalProvider =
      agentModeEnabled &&
      isSearchEnabled &&
      searchCompatibility.mode !== "external";
    const searchToggleTooltip = agentSearchRequiresExternalProvider
      ? t("agentSearchRequiresExternalProvider")
      : searchTooltip;
    const searchToggleAriaLabel = agentSearchRequiresExternalProvider
      ? t("agentSearchRequiresExternalProvider")
      : !searchCompatibility.enabled
        ? getSearchUnavailableMessage(searchCompatibility.reason)
        : isSearchEnabled
          ? t("disableSearchAria")
          : t("enableSearchAria");

    const handleAgentModeToggle = () => {
      if (!modelCapabilities.toolCall) {
        setErrorMsg(t("agentModeUnavailable"));
        return;
      }

      const useAgentMode = !agentModeEnabled;
      setChatConfig({ useAgentMode });
      if (currentSessionId) {
        updateSessionConfig(currentSessionId, { useAgentMode });
      }
    };

    // Filter plugins to show only those ready for use
    const validPlugins = useMemo(() => {
      return installedPlugins
        .filter((p) => {
          // If auth is required, check if we have a config value
          if (isPluginAuthRequired(p)) {
            const hasConfig = hasPluginAuthValue(pluginConfigs[p.id]?.auth);
            return !!hasConfig;
          }
          return true;
        })
        .map((p) => localizePluginMeta(p, tConfig));
    }, [installedPlugins, pluginConfigs, tConfig]);
    const pluginSourceGroups = useMemo(() => {
      const groups: { plugins: typeof validPlugins; mcp: typeof validPlugins } =
        {
          plugins: [],
          mcp: [],
        };

      validPlugins.forEach((plugin) => {
        if (plugin.source === "mcp") {
          groups.mcp.push(plugin);
        } else {
          groups.plugins.push(plugin);
        }
      });

      return groups;
    }, [validPlugins]);

    const isInputBusy =
      disabled || isTranscribing || isParsingAttachments || isPreparingSend;

    const conversationsForMenu = useMemo(
      () =>
        sessions
          .filter((session) => session.id !== currentSessionId)
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
      [currentSessionId, sessions],
    );

    const forcedSkills = useMemo(
      () =>
        forcedSkillIds
          .map((id) => installedSkills.find((skill) => skill.id === id))
          .filter((skill): skill is (typeof installedSkills)[number] =>
            Boolean(skill),
          )
          .map((skill) => ({ id: skill.id, title: skill.title })),
      [forcedSkillIds, installedSkills],
    );
    const forcedPlugins = useMemo(
      () =>
        forcedPluginIds
          .map((id) => validPlugins.find((plugin) => plugin.id === id))
          .filter((plugin): plugin is (typeof validPlugins)[number] =>
            Boolean(plugin),
          )
          .map((plugin) => ({ id: plugin.id, title: plugin.title })),
      [forcedPluginIds, validPlugins],
    );

    const attachConversation = async (sessionId: string, title: string) => {
      setIsParsingAttachments(true);
      setAttachmentProcessingStage("conversation");
      try {
        const state = useChatStore.getState();
        const messages =
          state.currentSessionId === sessionId
            ? state.activeMessages
            : getActiveMessagePath(
                normalizeSessionMessageTree(
                  await appDb.getItem<Message[] | SessionMessageTree>(
                    `session_messages_${sessionId}`,
                  ),
                ),
              );

        if (messages.length === 0) {
          setErrorMsg(t("conversationEmpty", { title }));
          return;
        }

        const transcript = buildConversationTranscript(
          title,
          buildCompressionSource(messages).text,
        ).slice(0, CONVERSATION_REFERENCE_MAX_CHARS);

        if (!isMountedRef.current) return;
        // Reuses the shared budget checks and error toasts of manual uploads.
        appendAttachments([
          {
            id: uuidv7(),
            mimeType: "text/markdown",
            fileName: buildConversationFileName(title),
            data: encodeTextToBase64(transcript),
          },
        ]);
      } catch (error) {
        logInputError("Failed to attach referenced conversation", error);
        if (isMountedRef.current) {
          setErrorMsg(t("conversationAttachFailed", { title }));
        }
      } finally {
        if (isMountedRef.current) setIsParsingAttachments(false);
      }
    };

    const {
      commandMatch,
      setCommandMatch,
      highlightedCommandId,
      setHighlightedCommandId,
      commandSections,
      isCommandMenuOpen,
      getCommandOptionId,
      closeCommandMenu,
      handleSelectCommand,
      handleCommandMenuKeyDown,
    } = useComposerCommandMenu({
      t,
      modelCapabilities,
      ragEnabled: rag.enabled,
      isInputBusy,
      commandListboxId,
      skillsForMenu,
      pluginSourceGroups,
      conversationsForMenu,
      inputValueRef,
      textareaRef,
      setInput,
      setErrorMsg,
      actions: {
        attachFile: () =>
          (modelCapabilities.attachment ||
          modelCapabilities.audio ||
          modelCapabilities.video
            ? fileInputRef
            : textFallbackInputRef
          ).current?.click(),
        attachImage: () => imageInputRef.current?.click(),
        openKnowledgeBase: () => setShowKBModal(true),
        openRemoteFile: () => setShowRemoteModal(true),
        newChat: onNewChat,
        compressContext: onCompressContext,
        // Mirrors the 4-skill ceiling `resolveSkillsForMessage` enforces.
        forceSkill: (skillId) =>
          setForcedSkillIds((prev) =>
            prev.includes(skillId) || prev.length >= 4
              ? prev
              : [...prev, skillId],
          ),
        forcePlugin: (pluginId) =>
          setForcedPluginIds((prev) =>
            prev.includes(pluginId) ? prev : [...prev, pluginId],
          ),
        attachConversation: (sessionId, title) => {
          void attachConversation(sessionId, title);
        },
      },
    });

    useImperativeHandle(ref, () => ({
      setValue: (value: string) => {
        setInput(value);
        // The stale match indexes into the replaced text, so drop it.
        setCommandMatch(null);
        setHighlightedCommandId(null);
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height =
              textareaRef.current.scrollHeight + "px";
          }
        });
      },
      focus: () => {
        textareaRef.current?.focus();
      },
      setAttachments: (atts: Attachment[]) => {
        setAttachments(atts);
      },
    }));

    const handleComposerChange = (
      e: React.ChangeEvent<HTMLTextAreaElement>,
    ) => {
      const value = e.target.value;
      setInput(value);
      setCommandMatch(
        detectComposerTrigger(value, e.target.selectionStart ?? value.length),
      );
    };

    /**
     * Caret moves (click, arrow keys while the menu is closed) can leave the
     * trigger token behind, so re-derive the match from the new caret.
     */
    const handleComposerSelect = (
      e: React.SyntheticEvent<HTMLTextAreaElement>,
    ) => {
      const textarea = e.currentTarget;
      setCommandMatch(
        detectComposerTrigger(
          textarea.value,
          textarea.selectionStart ?? textarea.value.length,
        ),
      );
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (handleCommandMenuKeyDown(e)) return;

      const requiresExplicitSend = window.matchMedia(
        "(pointer: coarse), (max-width: 1023px)",
      ).matches;
      if (
        shouldSubmitOnEnter({
          key: e.key,
          shiftKey: e.shiftKey,
          isComposing: e.nativeEvent.isComposing,
          requiresExplicitSend,
        })
      ) {
        e.preventDefault();
        void handleSend();
      }
    };

    const handleSend = async () => {
      if (
        (!input.trim() && attachments.length === 0) ||
        disabled ||
        offline ||
        isParsingAttachments ||
        isPreparingSend ||
        !selectedModel
      ) {
        return;
      }

      setIsPreparingSend(true);
      setErrorMsg(null);
      try {
        // Forced refs are per-message: they never survive past this send.
        const forced: ComposerForcedInvocations = {
          skillIds: forcedSkills.map((skill) => skill.id),
          pluginIds: modelCapabilities.toolCall
            ? forcedPlugins.map((plugin) => plugin.id)
            : [],
        };
        const skillParameters = onPrepareSend
          ? await onPrepareSend(forced)
          : undefined;
        if (onPrepareSend && !skillParameters) return;
        onSend(
          input,
          attachments,
          replyTo,
          skillParameters || undefined,
          forced,
        );
        setInput("");
        if (currentSessionId) clearComposerDraft(currentSessionId);
        setAttachments([]);
        setForcedSkillIds([]);
        setForcedPluginIds([]);
        closeCommandMenu();
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
        }
      } catch (error) {
        logInputError("Failed to prepare message send:", error);
        setErrorMsg(error instanceof Error ? error.message : String(error));
      } finally {
        if (isMountedRef.current) setIsPreparingSend(false);
      }
    };

    const handlePolishInput = async () => {
      const originalText = input;
      if (
        !originalText.trim() ||
        disabled ||
        offline ||
        isTranscribing ||
        isParsingAttachments ||
        isPolishingInput
      ) {
        return;
      }

      const runId = polishRunRef.current + 1;
      polishRunRef.current = runId;
      setIsPolishingInput(true);
      setErrorMsg(null);

      try {
        let replacement = "";
        const { streamGenerateContent } = await loadChatService();
        await streamGenerateContent(
          getTaskModel("promptOptimization"),
          polishTextContent(originalText),
          (text) => {
            if (!isMountedRef.current || polishRunRef.current !== runId) return;
            replacement = text;
            setInput(text);
          },
        );

        if (!isMountedRef.current || polishRunRef.current !== runId) return;
        if (!replacement.trim()) {
          setInput(originalText);
          setErrorMsg(t("polishFailed"));
        }
      } catch (error) {
        logInputError("Failed to polish input text", error);
        if (isMountedRef.current && polishRunRef.current === runId) {
          setInput(originalText);
          setErrorMsg(t("polishFailed"));
        }
      } finally {
        if (isMountedRef.current && polishRunRef.current === runId) {
          setIsPolishingInput(false);
        }
      }
    };

    // Adjust textarea height
    useEffect(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height =
          textareaRef.current.scrollHeight + "px";
      }
    }, [input]);

    const currentModelName =
      availableModels.find((m) => m.name === selectedModel)?.displayName ||
      selectedModel ||
      t("noModelSelected");
    const hasKnowledgeAttachments = attachments.some(isKnowledgeAttachment);
    const attachmentProcessingLabel =
      attachmentProcessingStage === "converting"
        ? t("convertingImage")
        : attachmentProcessingStage === "compressing"
          ? t("compressingImage")
          : attachmentProcessingStage === "parsing"
            ? t("parsingDocument")
            : attachmentProcessingStage === "conversation"
              ? t("attachingConversation")
              : t("preparingAttachment");
    const attachmentActionsDisabled = isInputBusy || offline;
    const textareaMinHeightClass = isHeroVariant
      ? "min-h-[5em]"
      : "min-h-[2em]";
    const composerPaddingClass = isHeroVariant ? "mb-0 md:mb-18" : "";

    const eventHasFiles = (types: DOMStringList | readonly string[]) =>
      Array.from(types).includes("Files");

    const handleComposerDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
      if (attachmentActionsDisabled || !eventHasFiles(e.dataTransfer.types)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current += 1;
      setIsDragUploadActive(true);
    };

    const handleComposerDragOver = (e: React.DragEvent<HTMLDivElement>) => {
      if (attachmentActionsDisabled || !eventHasFiles(e.dataTransfer.types)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      setIsDragUploadActive(true);
    };

    const handleComposerDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
      if (!eventHasFiles(e.dataTransfer.types)) return;
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDragUploadActive(false);
      }
    };

    const handleComposerDrop = (e: React.DragEvent<HTMLDivElement>) => {
      if (attachmentActionsDisabled) return;
      const files = extractChatAttachmentFilesFromDrop(e.dataTransfer);
      if (files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
      setIsDragUploadActive(false);
      void processSelectedFiles(files);
    };

    const handleComposerPaste = (
      e: React.ClipboardEvent<HTMLTextAreaElement>,
    ) => {
      if (attachmentActionsDisabled) return;
      const files = extractChatAttachmentFilesFromClipboard(e.clipboardData);
      if (files.length === 0) return;
      e.preventDefault();
      void processSelectedFiles(files);
    };

    return (
      <div
        ref={composerRootRef}
        className={`glass-shell relative flex w-full flex-col rounded-xl border focus-within:ring-2 focus-within:ring-blue-100/50 dark:focus-within:ring-blue-900/30 focus-within:border-blue-400/50 transition-[background-color,border-color,box-shadow] duration-200 ${composerPaddingClass}`}
        aria-busy={isInputBusy}
        onDragEnter={handleComposerDragEnter}
        onDragOver={handleComposerDragOver}
        onDragLeave={handleComposerDragLeave}
        onDrop={handleComposerDrop}
      >
        {/* Modals */}
        {showRemoteModal && (
          <RemoteFileModal
            onClose={() => setShowRemoteModal(false)}
            onAttach={(att) => appendAttachments([att])}
            capabilities={modelCapabilities}
          />
        )}

        {showKBModal && (
          <KnowledgeSelectionModal
            onClose={() => setShowKBModal(false)}
            onSelect={handleKBSelect}
          />
        )}

        {/* Error Message Toast */}
        {errorMsg && !isParsingAttachments && (
          <div
            id={errorMessageId}
            role="alert"
            aria-live="assertive"
            className="absolute -top-10 left-0 right-0 flex justify-center z-50 animate-in fade-in slide-in-from-bottom-2"
          >
            <div className="bg-red-600 text-white text-xs px-3 py-1.5 rounded-full shadow-lg font-medium flex items-center gap-2 dark:bg-red-500">
              <Button
                variant="bare"
                type="button"
                aria-label={t("dismissError")}
                className={`rounded-full p-0.5 hover:bg-white/15 transition-colors ${iconButtonFocusClass}`}
                onClick={() => setErrorMsg(null)}
              >
                <X size={12} aria-hidden="true" />
              </Button>
              <span>{errorMsg}</span>
            </div>
          </div>
        )}

        {isParsingAttachments && (
          <div
            role="status"
            aria-live="polite"
            className="absolute -top-10 left-0 right-0 z-50 flex justify-center animate-in fade-in slide-in-from-bottom-2"
          >
            <div className="flex items-center gap-2 rounded-full bg-gray-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg dark:bg-muted dark:text-foreground">
              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
              <span>{attachmentProcessingLabel}</span>
            </div>
          </div>
        )}

        {isDragUploadActive && (
          <div
            className="absolute inset-1 z-40 flex flex-col items-center justify-center rounded-lg border border-dashed border-brand/60 bg-white/85 text-center shadow-sm backdrop-blur-md dark:bg-background/85"
            aria-hidden="true"
          >
            <FileUp size={20} className="mb-2 text-brand" />
            <div className="text-sm font-semibold text-foreground">
              {t("dropFilesTitle")}
            </div>
            <div className="mt-1 max-w-60 text-xs text-muted-foreground">
              {t("dropFilesHint")}
            </div>
          </div>
        )}

        {/* Attachments Preview Area */}
        {replyTo ? (
          <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-border/70 bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
            <Button
              variant="bare"
              type="button"
              onClick={() => onNavigateReply?.(replyTo.messageId)}
              className={`flex min-w-0 flex-1 items-start gap-2 rounded text-left transition-colors hover:text-foreground ${iconButtonFocusClass}`}
              aria-label={t("openReplySource")}
            >
              <Quote size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span className="line-clamp-2 wrap-break-word">
                {replyTo.excerpt || t("replySourceUnavailable")}
              </span>
            </Button>
            <Button
              variant="bare"
              type="button"
              onClick={onCancelReply}
              className={`shrink-0 rounded p-0.5 transition-colors hover:bg-accent hover:text-foreground ${iconButtonFocusClass}`}
              aria-label={t("cancelReply")}
            >
              <X size={13} aria-hidden="true" />
            </Button>
          </div>
        ) : null}

        <ComposerReferenceChips
          skills={forcedSkills}
          plugins={forcedPlugins}
          onRemoveSkill={(id) =>
            setForcedSkillIds((prev) => prev.filter((item) => item !== id))
          }
          onRemovePlugin={(id) =>
            setForcedPluginIds((prev) => prev.filter((item) => item !== id))
          }
          skillsLabel={t("referencedSkills")}
          pluginsLabel={t("referencedPlugins")}
          removeSkillLabel={(title) => t("removeReferencedSkill", { title })}
          removePluginLabel={(title) => t("removeReferencedPlugin", { title })}
        />

        <MessageInputAttachmentTray
          attachments={attachments}
          onRemove={removeAttachment}
          ariaLabel={t("attachedFiles")}
        />

        <ComposerCommandMenu
          anchorRef={composerRootRef}
          open={isCommandMenuOpen}
          onClose={closeCommandMenu}
          sections={commandSections}
          highlightedId={highlightedCommandId}
          onHighlight={setHighlightedCommandId}
          onSelect={handleSelectCommand}
          listboxId={commandListboxId}
          getOptionId={getCommandOptionId}
          ariaLabel={t("commandMenuAria")}
          emptyLabel={
            commandMatch?.trigger === "@" && conversationsForMenu.length === 0
              ? t("noConversationsAvailable")
              : t("commandNoMatches")
          }
          hintLabel={t("commandHint")}
        />

        {/* Text Input */}
        <label htmlFor={messageInputId} className="sr-only">
          {t("message")}
        </label>
        <textarea
          id={messageInputId}
          name="message"
          ref={textareaRef}
          className={`w-full px-2 pt-3 bg-transparent focus:outline-0 text-gray-800 dark:text-foreground placeholder-gray-500 dark:placeholder:text-muted-foreground resize-none max-h-32 md:max-h-48 text-(length:--neo-font-size-base) leading-5 ${textareaMinHeightClass} overflow-y-auto overscroll-contain custom-scrollbar`}
          placeholder={
            isRecording
              ? voice.sttProvider === "browser"
                ? t("listening")
                : t("recording")
              : t("askAnything")
          }
          autoComplete="off"
          aria-describedby={
            errorMsg && !isParsingAttachments ? errorMessageId : undefined
          }
          aria-keyshortcuts={focusComposerShortcut.ariaKeyShortcuts}
          role={isCommandMenuOpen ? "combobox" : undefined}
          aria-expanded={isCommandMenuOpen || undefined}
          aria-controls={isCommandMenuOpen ? commandListboxId : undefined}
          aria-activedescendant={
            isCommandMenuOpen && highlightedCommandId
              ? getCommandOptionId(highlightedCommandId)
              : undefined
          }
          value={input}
          onChange={handleComposerChange}
          onSelect={handleComposerSelect}
          onKeyDown={handleKeyDown}
          onPaste={handleComposerPaste}
          disabled={isInputBusy}
        />
        {offline ? (
          <p
            className="px-4 pb-1 text-[11px] text-amber-700 dark:text-amber-300"
            role="status"
          >
            {t("offlineDraftSaved")}
          </p>
        ) : null}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-1 p-1 md:flex-nowrap md:gap-2 md:p-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
            {/* Attachment Menu */}
            <div className="relative">
              <input
                id={attachFileInputId}
                name="chat-attachments"
                aria-label={t("uploadFilesAria")}
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                className="hidden"
                multiple
                accept="*/*"
              />
              <input
                id={attachImageInputId}
                name="chat-images"
                aria-label={t("uploadImagesAria")}
                type="file"
                ref={imageInputRef}
                onChange={handleFileSelect}
                className="hidden"
                multiple
                accept="image/*,.heic,.heif"
              />
              {/* Fallback Input for dumb models */}
              <input
                id={attachTextFallbackInputId}
                name="chat-text-attachments"
                aria-label={t("uploadTextFilesAria")}
                type="file"
                ref={textFallbackInputRef}
                onChange={handleTextFallbackSelect}
                className="hidden"
                multiple
                accept="text/*,application/json,application/xml,application/javascript,application/xhtml+xml,application/x-yaml,application/sql,application/graphql,application/ld+json,application/x-sh,application/x-httpd-php,application/typescript,.csv,.doc,.docx,.md,.markdown,.pdf,.ppt,.pptx,.txt,.xls,.xlsx"
              />

              <DropdownMenu
                open={showAttachMenu}
                onOpenChange={(open) => {
                  setShowSkillSelect(false);
                  setShowPluginSelect(false);
                  setShowReasoningSelect(false);
                  setShowModelSelect(false);
                  setShowAttachMenu(open);
                }}
              >
                <Tooltip content={t("attach")} position="top">
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="bare"
                      type="button"
                      aria-label={t("attachFiles")}
                      aria-pressed={hasKnowledgeAttachments}
                      className={`${iconButtonBaseClass} transition-colors ${iconButtonFocusClass} ${
                        showAttachMenu || hasKnowledgeAttachments
                          ? "bg-gray-100 dark:bg-accent text-gray-800 dark:text-foreground"
                          : "text-gray-500 dark:text-muted-foreground hover:text-gray-700 dark:hover:text-foreground hover:bg-gray-100 dark:hover:bg-accent/50"
                      }`}
                      disabled={attachmentActionsDisabled}
                    >
                      <Paperclip size={16} aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                </Tooltip>

                <DropdownMenuContent side="top" align="start" className="w-48">
                  <DropdownMenuItem
                    onSelect={() => {
                      if (
                        modelCapabilities.attachment ||
                        modelCapabilities.audio ||
                        modelCapabilities.video
                      ) {
                        fileInputRef.current?.click();
                      } else {
                        textFallbackInputRef.current?.click();
                      }
                    }}
                  >
                    <FileUp
                      size={14}
                      className="text-blue-500"
                      aria-hidden="true"
                    />
                    <span>{t("uploadFile")}</span>
                  </DropdownMenuItem>
                  {modelCapabilities.vision && (
                    <DropdownMenuItem
                      onSelect={() => {
                        imageInputRef.current?.click();
                      }}
                    >
                      <ImageUp
                        size={14}
                        className="text-green-500"
                        aria-hidden="true"
                      />
                      <span>{t("uploadImage")}</span>
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      setShowKBModal(true);
                    }}
                    disabled={attachmentActionsDisabled}
                  >
                    <Library
                      size={14}
                      className="text-purple-500 dark:text-purple-400"
                      aria-hidden="true"
                    />
                    <span>{t("knowledgeBase")}</span>
                  </DropdownMenuItem>

                  {(modelCapabilities.attachment ||
                    modelCapabilities.vision ||
                    modelCapabilities.audio ||
                    modelCapabilities.video) && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => {
                          setShowRemoteModal(true);
                        }}
                      >
                        <Link
                          size={14}
                          className="text-purple-500"
                          aria-hidden="true"
                        />
                        <span>{t("remoteFile")}</span>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Skill Toggle Button */}
            <div className="relative">
              <DropdownMenu
                open={showSkillSelect}
                onOpenChange={(open) => {
                  setShowAttachMenu(false);
                  setShowPluginSelect(false);
                  setShowReasoningSelect(false);
                  setShowModelSelect(false);
                  setShowSkillSelect(open);
                }}
              >
                <Tooltip
                  content={
                    activeSkillIds.length > 0
                      ? t("activeSkillsCount", { count: activeSkillIds.length })
                      : t("skills")
                  }
                  position="top"
                >
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="bare"
                      type="button"
                      aria-label={
                        activeSkillIds.length > 0
                          ? t("activeSkillsAria", {
                              count: activeSkillIds.length,
                            })
                          : t("skills")
                      }
                      className={`${iconButtonBaseClass} transition-colors ${iconButtonFocusClass} ${
                        activeSkillIds.length > 0
                          ? "text-emerald-500 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
                          : "text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-muted-foreground dark:hover:bg-accent/50 dark:hover:text-foreground"
                      }`}
                      disabled={isInputBusy}
                    >
                      <Sparkles size={16} aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                </Tooltip>

                <DropdownMenuContent
                  side="top"
                  align="start"
                  className="max-h-64 w-64 overflow-y-auto custom-scrollbar"
                >
                  {skillsForMenu.length > 0 ? (
                    <>
                      <DropdownMenuLabel>
                        {t("installedSkills")}
                      </DropdownMenuLabel>
                      {skillsForMenu.map((skill) => {
                        const isActive = activeSkillSet.has(skill.id);
                        return (
                          <DropdownMenuCheckboxItem
                            key={skill.id}
                            checked={isActive}
                            indicatorPosition="right"
                            indicator={
                              <span className="flex h-3 w-3 items-center justify-center rounded-full border border-emerald-500 bg-emerald-500">
                                <span className="h-1.5 w-1.5 rounded-full bg-white" />
                              </span>
                            }
                            onSelect={(event) => event.preventDefault()}
                            onCheckedChange={() => toggleSessionSkill(skill.id)}
                          >
                            <span className="truncate">{skill.title}</span>
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                    </>
                  ) : (
                    <div
                      className="px-3 py-4 text-center text-xs text-muted-foreground"
                      role="status"
                    >
                      {t("noSkillsAvailable")}
                    </div>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Plugin Toggle Button */}
            <div className="relative">
              <DropdownMenu
                open={showPluginSelect}
                onOpenChange={(open) => {
                  setShowAttachMenu(false);
                  setShowSkillSelect(false);
                  setShowReasoningSelect(false);
                  setShowModelSelect(false);
                  setShowPluginSelect(open);
                }}
              >
                <Tooltip
                  content={
                    !modelCapabilities.toolCall
                      ? t("agentModeUnavailable")
                      : activePlugins.length > 0
                        ? t("activePluginsCount", {
                            count: activePlugins.length,
                          })
                        : t("plugins")
                  }
                  position="top"
                >
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="bare"
                      type="button"
                      aria-label={
                        activePlugins.length > 0
                          ? t("activePluginsAria", {
                              count: activePlugins.length,
                            })
                          : t("plugins")
                      }
                      className={`${iconButtonBaseClass} transition-colors ${iconButtonFocusClass} ${activePlugins.length > 0 ? "text-cyan-500 dark:text-cyan-400 hover:bg-cyan-50 dark:hover:bg-cyan-900/20" : "text-gray-500 dark:text-muted-foreground hover:text-gray-700 dark:hover:text-foreground hover:bg-gray-100 dark:hover:bg-accent/50"}`}
                      disabled={isInputBusy || !modelCapabilities.toolCall}
                    >
                      <Blocks size={16} aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                </Tooltip>

                <DropdownMenuContent
                  side="top"
                  align="start"
                  className="max-h-64 w-64 overflow-y-auto custom-scrollbar"
                >
                  {validPlugins.length > 0 ? (
                    <>
                      {pluginSourceGroups.plugins.length > 0 && (
                        <>
                          <DropdownMenuLabel>
                            {t("installedPlugins")}
                          </DropdownMenuLabel>
                          {pluginSourceGroups.plugins.map((plugin) => {
                            const isActive = activePlugins.includes(plugin.id);
                            return (
                              <DropdownMenuCheckboxItem
                                checked={isActive}
                                aria-label={
                                  isActive
                                    ? t("disablePlugin", {
                                        title: plugin.title,
                                      })
                                    : t("enablePlugin", {
                                        title: plugin.title,
                                      })
                                }
                                indicatorPosition="right"
                                indicator={
                                  <span className="flex h-3 w-3 items-center justify-center rounded-full border border-cyan-500 bg-cyan-500">
                                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                                  </span>
                                }
                                key={plugin.id}
                                onSelect={(event) => event.preventDefault()}
                                onCheckedChange={() =>
                                  togglePluginActive(plugin.id)
                                }
                              >
                                <span className="flex min-w-0 items-center gap-2 truncate">
                                  <SafeImage
                                    src={plugin.logoUrl}
                                    className="w-4 h-4 object-contain"
                                    alt=""
                                    fallback={
                                      <Blocks size={14} aria-hidden="true" />
                                    }
                                  />
                                  <span className="truncate">
                                    {plugin.title}
                                  </span>
                                </span>
                              </DropdownMenuCheckboxItem>
                            );
                          })}
                        </>
                      )}
                      {pluginSourceGroups.mcp.length > 0 && (
                        <>
                          {pluginSourceGroups.plugins.length > 0 && (
                            <DropdownMenuSeparator />
                          )}
                          <DropdownMenuLabel>
                            {t("mcpServers")}
                          </DropdownMenuLabel>
                          {pluginSourceGroups.mcp.map((plugin) => {
                            const isActive = activePlugins.includes(plugin.id);
                            return (
                              <DropdownMenuCheckboxItem
                                checked={isActive}
                                aria-label={
                                  isActive
                                    ? t("disablePlugin", {
                                        title: plugin.title,
                                      })
                                    : t("enablePlugin", {
                                        title: plugin.title,
                                      })
                                }
                                indicatorPosition="right"
                                indicator={
                                  <span className="flex h-3 w-3 items-center justify-center rounded-full border border-cyan-500 bg-cyan-500">
                                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                                  </span>
                                }
                                key={plugin.id}
                                onSelect={(event) => event.preventDefault()}
                                onCheckedChange={() =>
                                  togglePluginActive(plugin.id)
                                }
                              >
                                <span className="flex min-w-0 items-center gap-2 truncate">
                                  <SafeImage
                                    src={plugin.logoUrl}
                                    className="w-4 h-4 object-contain"
                                    alt=""
                                    fallback={
                                      <Blocks size={14} aria-hidden="true" />
                                    }
                                  />
                                  <span className="truncate">
                                    {plugin.title}
                                  </span>
                                </span>
                              </DropdownMenuCheckboxItem>
                            );
                          })}
                        </>
                      )}
                    </>
                  ) : (
                    <div
                      className="px-3 py-4 text-center text-xs text-muted-foreground"
                      role="status"
                    >
                      {installedPlugins.length > 0
                        ? t("pluginsMissingAuth")
                        : t("noPluginsInstalled")}{" "}
                      <br /> {t("visitPluginMarket")}
                    </div>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Reasoning Button (Conditional) */}
            {isReasoningSupported && (
              <div className="relative">
                <DropdownMenu
                  open={showReasoningSelect}
                  onOpenChange={(open) => {
                    setShowAttachMenu(false);
                    setShowSkillSelect(false);
                    setShowPluginSelect(false);
                    setShowModelSelect(false);
                    setShowReasoningSelect(open);
                  }}
                >
                  <Tooltip
                    content={t("reasoningModeTooltip", {
                      mode: currentReasoningOption.label,
                    })}
                    position="top"
                  >
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="bare"
                        type="button"
                        aria-label={t("reasoningModeAria", {
                          mode: currentReasoningOption.label,
                        })}
                        aria-pressed={isReasoningEnabledForMode}
                        className={`${iconButtonBaseClass} transition-colors ${iconButtonFocusClass} ${
                          isReasoningEnabledForMode
                            ? "text-violet-500 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20"
                            : "text-gray-500 dark:text-muted-foreground hover:text-gray-700 dark:hover:text-foreground hover:bg-gray-100 dark:hover:bg-accent/50"
                        }`}
                        disabled={isInputBusy}
                      >
                        <Lightbulb size={16} aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                  </Tooltip>

                  <DropdownMenuContent
                    side="top"
                    align="start"
                    className="w-40 p-1.5 md:w-72"
                  >
                    <DropdownMenuLabel>
                      {t("reasoningModeLabel")}
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      className="space-y-0.5 md:space-y-1"
                      value={currentReasoningMode}
                      onValueChange={(value) => {
                        const reasoningMode = normalizeReasoningMode(value);
                        setChatConfig({
                          reasoningMode,
                          useReasoning: isReasoningEnabled(reasoningMode),
                        });
                        setShowReasoningSelect(false);
                      }}
                    >
                      {reasoningOptions.map((option) => (
                        <DropdownMenuRadioItem
                          key={option.value}
                          value={option.value}
                          indicatorPosition="right"
                          className="h-auto min-h-8 rounded-md px-2 py-1.5 pr-8 text-left transition-[background-color,color] hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground md:py-2"
                        >
                          <span className="flex min-w-0 flex-col gap-1">
                            <span className="truncate text-sm font-medium leading-5">
                              {option.label}
                            </span>
                            <span className="hidden text-[11px] font-normal leading-4 text-muted-foreground md:block">
                              {option.description}
                            </span>
                          </span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            {/* Search Button */}
            {onToggleSearch && (
              <div>
                <Tooltip content={searchToggleTooltip} position="top">
                  <Button
                    variant="bare"
                    type="button"
                    aria-label={searchToggleAriaLabel}
                    aria-pressed={
                      isSearchEnabled && searchCompatibility.enabled
                    }
                    className={`${iconButtonBaseClass} transition-colors ${iconButtonFocusClass} ${
                      isSearchEnabled && searchCompatibility.enabled
                        ? "text-blue-500 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                        : !searchCompatibility.enabled
                          ? "text-amber-500 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                          : "text-gray-500 dark:text-muted-foreground hover:text-gray-700 dark:hover:text-foreground hover:bg-gray-100 dark:hover:bg-accent/50"
                    }`}
                    onClick={handleSearchToggle}
                    disabled={isInputBusy}
                  >
                    <Globe size={16} aria-hidden="true" />
                  </Button>
                </Tooltip>
              </div>
            )}

            {/* Agent Mode Button */}
            <div>
              <Tooltip content={agentModeTooltip} position="top">
                <Button
                  variant="bare"
                  type="button"
                  aria-label={agentModeTooltip}
                  aria-pressed={
                    modelCapabilities.toolCall ? agentModeEnabled : undefined
                  }
                  aria-disabled={!modelCapabilities.toolCall ? true : undefined}
                  className={`${iconButtonBaseClass} transition-colors ${iconButtonFocusClass} ${
                    agentModeEnabled
                      ? "text-blue-500 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                      : !modelCapabilities.toolCall
                        ? "text-gray-400 dark:text-muted-foreground/60"
                        : "text-gray-500 dark:text-muted-foreground hover:text-gray-700 dark:hover:text-foreground hover:bg-gray-100 dark:hover:bg-accent/50"
                  }`}
                  onClick={handleAgentModeToggle}
                  disabled={isInputBusy}
                >
                  <Bot size={16} aria-hidden="true" />
                </Button>
              </Tooltip>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {/* Model Selector */}
            <div className="relative">
              <DropdownMenu
                open={showModelSelect && availableModels.length > 0}
                onOpenChange={(open) => {
                  setShowAttachMenu(false);
                  setShowSkillSelect(false);
                  setShowPluginSelect(false);
                  setShowReasoningSelect(false);
                  setShowModelSelect(open && availableModels.length > 0);
                }}
              >
                <Tooltip content={currentModelName} position="top" portal>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="bare"
                      type="button"
                      aria-label={t("selectModelAria", {
                        model: currentModelName,
                      })}
                      className={`group ${iconButtonBaseClass} gap-1.5 px-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 md:w-auto md:max-w-52 dark:text-muted-foreground dark:hover:bg-accent/50 dark:hover:text-foreground ${iconButtonFocusClass}`}
                      disabled={isInputBusy}
                    >
                      {/* Mobile: Just Icon */}
                      <Cpu size={16} className="md:hidden" aria-hidden="true" />

                      {/* Desktop: Text + Chevron */}
                      <div className="hidden min-w-0 items-center gap-0.5 md:flex">
                        <span className="max-w-44 truncate text-xs font-medium">
                          {truncateMiddle(currentModelName, 30)}
                        </span>
                        <ChevronDown
                          size={12}
                          aria-hidden="true"
                          className={`opacity-50 transition-[opacity,transform] duration-200 group-hover:opacity-100 ${showModelSelect ? "rotate-180" : ""}`}
                        />
                      </div>
                    </Button>
                  </DropdownMenuTrigger>
                </Tooltip>

                <DropdownMenuContent
                  side="top"
                  align="end"
                  className="max-h-64 w-56 overflow-y-auto custom-scrollbar"
                >
                  <DropdownMenuRadioGroup
                    value={selectedModel}
                    onValueChange={(model) => {
                      onSelectModel?.(model);
                      setShowModelSelect(false);
                    }}
                  >
                    {(
                      Object.entries(groupedModels) as [string, ModelInfo[]][]
                    ).map(([providerName, models]) => (
                      <div key={providerName}>
                        <DropdownMenuLabel>{providerName}</DropdownMenuLabel>
                        {models.map((model) => (
                          <DropdownMenuRadioItem
                            value={model.name}
                            aria-label={t("useModelAria", {
                              model: model.displayName,
                            })}
                            indicatorPosition="right"
                            key={model.name}
                            className={
                              selectedModel === model.name
                                ? "font-medium text-brand"
                                : undefined
                            }
                          >
                            <span className="truncate">
                              {model.displayName}
                            </span>
                          </DropdownMenuRadioItem>
                        ))}
                      </div>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Text Polish Button */}
            <div>
              <Tooltip
                content={
                  isPolishingInput ? t("polishingText") : t("polishText")
                }
                position="top"
              >
                <Button
                  variant="bare"
                  type="button"
                  aria-label={t("polishTextAria")}
                  aria-busy={isPolishingInput || undefined}
                  disabled={
                    isInputBusy || offline || isPolishingInput || !input.trim()
                  }
                  className={`${iconButtonBaseClass} transition-colors ${iconButtonFocusClass} ${
                    input.trim()
                      ? "text-gray-500 dark:text-muted-foreground hover:text-gray-700 dark:hover:text-foreground hover:bg-gray-100 dark:hover:bg-accent/50"
                      : "text-gray-300 dark:text-muted-foreground/40"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                  onClick={handlePolishInput}
                >
                  {isPolishingInput ? (
                    <Loader2
                      size={16}
                      className="animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <PencilSparkles size={16} aria-hidden="true" />
                  )}
                </Button>
              </Tooltip>
            </div>

            {/* Actions */}
            <div className="flex shrink-0 items-center gap-1">
              {isInputBusy ? (
                onStop && !isParsingAttachments ? (
                  <Tooltip
                    content={
                      <ShortcutTooltipContent
                        label={t("stopGeneration")}
                        shortcut={stopGenerationShortcut.display}
                      />
                    }
                    position="top"
                  >
                    <Button
                      variant="bare"
                      type="button"
                      aria-label={t("stopGenerationAria")}
                      aria-keyshortcuts={
                        stopGenerationShortcut.ariaKeyShortcuts
                      }
                      aria-busy="true"
                      className={`${iconButtonBaseClass} relative overflow-hidden bg-gray-100 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-500 dark:bg-accent dark:text-muted-foreground dark:hover:bg-red-900/20 dark:hover:text-red-400 group ${iconButtonFocusClass}`}
                      onClick={onStop}
                    >
                      <div className="relative w-4 h-4">
                        <Loader2
                          size={16}
                          aria-hidden="true"
                          className="animate-spin absolute inset-0 transition-[opacity,transform] duration-300 group-hover:opacity-0 group-hover:scale-75"
                        />
                        <Square
                          size={16}
                          fill="currentColor"
                          aria-hidden="true"
                          className="absolute inset-0 opacity-0 scale-75 transition-[opacity,transform] duration-300 group-hover:opacity-100 group-hover:scale-100"
                        />
                      </div>
                    </Button>
                  </Tooltip>
                ) : (
                  <Button
                    variant="bare"
                    type="button"
                    aria-label={t("working")}
                    aria-busy="true"
                    className={`${iconButtonBaseClass} cursor-not-allowed bg-transparent text-gray-500 dark:text-muted-foreground`}
                  >
                    <Loader2
                      size={16}
                      className="animate-spin"
                      aria-hidden="true"
                    />
                  </Button>
                )
              ) : input || attachments.length > 0 ? (
                <Tooltip content={t("sendMessage")} position="top">
                  <Button
                    variant="bare"
                    type="button"
                    aria-label={t("sendMessageAria")}
                    disabled={offline || !selectedModel || isParsingAttachments}
                    className={`${iconButtonBaseClass} bg-gray-100 text-gray-500 shadow-sm transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-accent dark:text-muted-foreground dark:hover:bg-accent/80 ${iconButtonFocusClass}`}
                    onClick={() => void handleSend()}
                  >
                    <SendHorizontal size={16} aria-hidden="true" />
                  </Button>
                </Tooltip>
              ) : (
                <div className="relative">
                  {isRecording && (
                    <div
                      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-red-600 text-white text-xs font-bold rounded-full animate-pulse whitespace-nowrap shadow-md dark:bg-red-500"
                      aria-hidden="true"
                    >
                      {formatTime(recordingSeconds)}
                    </div>
                  )}

                  <Tooltip
                    content={
                      isRecording
                        ? t("stopRecording")
                        : voice.autoTranscribe
                          ? t("speechToText")
                          : t("voiceMessage")
                    }
                    position="top"
                  >
                    <Button
                      variant="bare"
                      type="button"
                      aria-label={
                        isRecording
                          ? t("stopRecordingAria", {
                              time: formatTime(recordingSeconds),
                            })
                          : voice.autoTranscribe
                            ? t("speechToTextAria")
                            : t("voiceMessageAria")
                      }
                      aria-pressed={isRecording}
                      className={`${iconButtonBaseClass} transition-[background-color,color,box-shadow] ${iconButtonFocusClass} ${isRecording ? "bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-800" : "text-gray-500 dark:text-muted-foreground hover:text-gray-700 dark:hover:text-foreground hover:bg-gray-100 dark:hover:bg-accent/50"}`}
                      onClick={toggleRecording}
                      disabled={offline}
                    >
                      {isRecording ? (
                        <StopCircle size={16} aria-hidden="true" />
                      ) : (
                        <Mic size={16} aria-hidden="true" />
                      )}
                    </Button>
                  </Tooltip>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  },
);

MessageInput.displayName = "MessageInput";

export default MessageInput;
