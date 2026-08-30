"use client";

import { useShallow } from "zustand/react/shallow";

import { useChatStore } from "@/store/core/chatStore";
import { useCoreSettingsStore } from "@/store/core/coreSettingsStore";
import { useKnowledgeStore } from "@/store/core/knowledgeStore";
import { useSettingsStore } from "@/store/core/settingsStore";

export function useChatShellState() {
  const chat = useChatStore(
    useShallow((state) => ({
      _hasHydrated: state._hasHydrated,
      sessions: state.sessions,
      workspaces: state.workspaces,
      currentSessionId: state.currentSessionId,
      activeMessages: state.activeMessages,
      activeMessageTree: state.activeMessageTree,
      isActiveSessionLoading: state.isActiveSessionLoading,
      activeSessionLoadError: state.activeSessionLoadError,
      selectedModel: state.selectedModel,
      chatConfig: state.chatConfig,
      createSession: state.createSession,
      selectSession: state.selectSession,
      deleteSession: state.deleteSession,
      updateSessionTitle: state.updateSessionTitle,
      updateSessionInstruction: state.updateSessionInstruction,
      updateSessionConfig: state.updateSessionConfig,
      updateSessionCompression: state.updateSessionCompression,
      updateSessionMemoryContext: state.updateSessionMemoryContext,
      toggleSessionPin: state.toggleSessionPin,
      duplicateSession: state.duplicateSession,
      addMessage: state.addMessage,
      updateMessageContent: state.updateMessageContent,
      updateMessage: state.updateMessage,
      addMessageVersion: state.addMessageVersion,
      createEditedUserMessageBranch: state.createEditedUserMessageBranch,
      switchMessageVersion: state.switchMessageVersion,
      selectMessageVersion: state.selectMessageVersion,
      deleteMessage: state.deleteMessage,
      deleteMessageAndSubsequent: state.deleteMessageAndSubsequent,
      setSuggestedQuestions: state.setSuggestedQuestions,
      setModel: state.setModel,
      setChatConfig: state.setChatConfig,
      getCurrentSession: state.getCurrentSession,
      syncActiveSession: state.syncActiveSession,
    })),
  );

  const settings = useSettingsStore(
    useShallow((state) => ({
      _hasHydrated: state._hasHydrated,
      modelMetadata: state.modelMetadata,
      customModelMetadata: state.customModelMetadata,
      fetchModelMetadata: state.fetchModelMetadata,
      ensureBuiltInPlugins: state.ensureBuiltInPlugins,
      system: state.system,
      rag: state.rag,
      search: state.search,
      activePlugins: state.activePlugins,
      installedPlugins: state.installedPlugins,
      pluginConfigs: state.pluginConfigs,
      installedSkills: state.installedSkills,
      customSkills: state.customSkills,
      activeSkillIds: state.activeSkillIds,
      skillBundles: state.skillBundles,
      activeSkillBundleIds: state.activeSkillBundleIds,
      skillAutoSelect: state.skillAutoSelect,
      setActivePlugins: state.setActivePlugins,
      togglePluginActive: state.togglePluginActive,
      applyServerConfig: state.applyServerConfig,
    })),
  );

  const core = useCoreSettingsStore(
    useShallow((state) => ({
      _hasHydrated: state._hasHydrated,
      theme: state.theme,
      providers: state.providers,
      updateProvider: state.updateProvider,
      applyServerConfig: state.applyServerConfig,
    })),
  );

  const knowledgeCollections = useKnowledgeStore(
    useShallow((state) => state.collections),
  );

  return {
    chat,
    settings,
    core,
    knowledgeCollections,
  };
}
