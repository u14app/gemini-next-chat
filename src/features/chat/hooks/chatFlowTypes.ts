"use client";
import type React from "react";
import type { useTranslations } from "next-intl";
import type { ComposerSkillParameterValues } from "@/components/skill/SkillParameterDialog";
import type { MessageInputRef } from "@/components/chat/MessageInput";
import type { ModelInfo } from "@/services/api/chatService";
import type { Message, ModelMetadata, SystemSettings } from "@/types";
import type { StreamRenderScheduler } from "@/lib/chat/streamRenderScheduler";
import type { useChatGenerationController } from "./useChatGenerationController";
import type { useChatRequestPreparation } from "./useChatRequestPreparation";
import type { useChatShellState } from "./useChatShellState";
import type { useToolConfirmationController } from "./useToolConfirmationController";

type ShellState = ReturnType<typeof useChatShellState>;
type ChatSlice = ShellState["chat"];
type SettingsSlice = ShellState["settings"];
type GenerationController = ReturnType<typeof useChatGenerationController>;
type RequestPreparation = ReturnType<typeof useChatRequestPreparation>;

/** What the stream renderer schedules on each frame. */
export interface StreamRenderSnapshot {
  content: string;
  reasoning?: string;
  outputBlocks?: Message["outputBlocks"];
}

/**
 * The dependency set the send / branch / edit flows share. They are all
 * slices of ChatApp's render scope; bundling them keeps each flow hook a
 * one-argument call instead of a 30-parameter one.
 */
export interface ChatFlowDeps {
  t: ReturnType<typeof useTranslations<"ChatApp">>;
  locale: string;
  showActionError: (message: string) => void;
  syncActiveSessionWithNotice: (
    sessionId: string,
    logMessage: string,
  ) => Promise<void>;

  // --- Chat store ---
  sessions: ChatSlice["sessions"];
  currentSessionId: ChatSlice["currentSessionId"];
  activeMessages: ChatSlice["activeMessages"];
  selectedModel: ChatSlice["selectedModel"];
  chatConfig: ChatSlice["chatConfig"];
  getCurrentSession: ChatSlice["getCurrentSession"];
  createSession: ChatSlice["createSession"];
  addMessage: ChatSlice["addMessage"];
  updateMessage: ChatSlice["updateMessage"];
  updateMessageContent: ChatSlice["updateMessageContent"];
  addMessageVersion: ChatSlice["addMessageVersion"];
  createEditedUserMessageBranch: ChatSlice["createEditedUserMessageBranch"];
  switchMessageVersion: ChatSlice["switchMessageVersion"];
  selectMessageVersion: ChatSlice["selectMessageVersion"];
  deleteMessage: ChatSlice["deleteMessage"];
  deleteMessageAndSubsequent: ChatSlice["deleteMessageAndSubsequent"];
  setSuggestedQuestions: ChatSlice["setSuggestedQuestions"];
  updateSessionTitle: ChatSlice["updateSessionTitle"];
  updateSessionCompression: ChatSlice["updateSessionCompression"];
  syncActiveSession: ChatSlice["syncActiveSession"];

  // --- Settings store ---
  system: SystemSettings;
  modelMetadata: Record<string, ModelMetadata>;
  customModelMetadata: Record<string, ModelMetadata>;
  installedSkills: SettingsSlice["installedSkills"];
  skillBundles: SettingsSlice["skillBundles"];
  activeSkillBundleIds: string[];
  skillAutoSelect: boolean;
  availableModels: ModelInfo[];

  // --- Generation lifecycle ---
  isGenerating: GenerationController["isGenerating"];
  beginActiveGeneration: GenerationController["beginActiveGeneration"];
  isGenerationRunActive: GenerationController["isGenerationRunActive"];
  finishActiveGeneration: GenerationController["finishActiveGeneration"];
  abortBackgroundPostProcessing: () => void;
  beginBackgroundPostProcessing: () => AbortSignal;
  queueMemoryExtraction: (
    sessionId: string,
    userMessage: Pick<Message, "id" | "content">,
    assistantMessage: Pick<Message, "id" | "content">,
    signal?: AbortSignal,
  ) => void;

  // --- Streaming plumbing (owned by ChatApp so stop/delete can flush it) ---
  createMessageStreamRenderer: (
    sessionId: string,
    messageId: string,
  ) => StreamRenderScheduler<StreamRenderSnapshot>;
  activeStreamRenderRef: React.RefObject<StreamRenderScheduler<StreamRenderSnapshot> | null>;
  activeStreamCheckpointRef: React.RefObject<{
    flush: () => Promise<void>;
  } | null>;
  persistLongTextFilesForMessage: (
    sessionId: string,
    messageId: string,
    options?: { expectedRequestId?: string; signal?: AbortSignal },
  ) => Promise<void>;
  toolConfirmationController: ReturnType<
    typeof useToolConfirmationController
  >["controller"];
  messageInputRef: React.RefObject<MessageInputRef | null>;

  // --- Request preparation ---
  getEffectiveContextForSession: RequestPreparation["getEffectiveContextForSession"];
  prepareComposerSkillParameters: RequestPreparation["prepareComposerSkillParameters"];
  processPromptForModel: RequestPreparation["processPromptForModel"];
  createAgentToolStreamOptions: RequestPreparation["createAgentToolStreamOptions"];
  commitInjectedMemoryContext: RequestPreparation["commitInjectedMemoryContext"];
  skillParameterValuesRef: React.RefObject<
    ComposerSkillParameterValues["skillParameterValues"]
  >;
  skillBundleParameterValuesRef: React.RefObject<
    ComposerSkillParameterValues["skillBundleParameterValues"]
  >;
}
