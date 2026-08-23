"use client";
import React, { useEffect, useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Attachment, ToolCall, ToolConfirmationDecision } from "@/types";
import {
  FileArchive,
  BookOpen,
  ChevronDown,
  FolderInput,
  FolderSearch,
  ImageOff,
  LoaderCircle,
  ListChecks,
  Search,
  Sparkles,
  SquareCode,
  Wrench,
  CheckCircle2,
  AlertCircle,
  FileText,
  FilePen,
  FilePlus2,
  FileX2,
  FolderOpen,
  Globe,
  Share2,
  ShieldAlert,
  MessageCircleQuestionMark,
  PackageOpen,
} from "lucide-react";
import { Blocks } from "lucide-react";
import {
  formatToolDisplayName,
  formatToolDisplayValue,
} from "@/lib/utils/toolDisplay";
import { redactSensitiveToolArgs } from "@/lib/plugin/confirmation";
import { isToolResultEnvelope } from "@/lib/agent/toolResult";
import { useAttachmentDisplayUrl } from "@/lib/utils/useAttachmentDisplayUrl";
import { useUIStore } from "@/store/core/uiStore";
import SafeImage from "../ui/SafeImage";
import { Button } from "@/components/ui/primitives";

interface ToolCallBlockProps {
  toolCalls: ToolCall[];
  onConfirmationDecision?: (
    toolCallId: string,
    decision: ToolConfirmationDecision,
  ) => void;
  onRevokeSessionApproval?: (toolCall: ToolCall) => void;
}

const EMPTY_TOOL_CALLS: ToolCall[] = [];

const BUILTIN_TOOL_PRESENTATIONS = {
  web_search: { labelKey: "toolWebSearch", icon: Search },
  search_web: { labelKey: "toolSearchWebV2", icon: Search },
  search_knowledge: { labelKey: "toolKnowledgeSearch", icon: BookOpen },
  memory_list: { labelKey: "toolMemoryList", icon: BookOpen },
  remember: { labelKey: "toolRemember", icon: FilePlus2 },
  memory_update: { labelKey: "toolMemoryUpdate", icon: FilePen },
  forget: { labelKey: "toolForget", icon: FileX2 },
  memory_restore: { labelKey: "toolMemoryRestore", icon: FolderInput },
  load_skill: { labelKey: "toolLoadSkill", icon: Sparkles },
  search_skills: { labelKey: "toolSearchSkills", icon: Search },
  inspect_skill: { labelKey: "toolInspectSkill", icon: BookOpen },
  run_javascript: { labelKey: "toolRunJavaScript", icon: SquareCode },
  fetch_url: { labelKey: "toolFetchUrl", icon: Globe },
  fetch_urls: { labelKey: "toolFetchUrls", icon: Globe },
  inspect_attachment: {
    labelKey: "toolInspectAttachment",
    icon: FolderSearch,
  },
  extract_document: { labelKey: "toolExtractDocument", icon: FileText },
  update_task_plan: { labelKey: "toolUpdateTaskPlan", icon: ListChecks },
  request_user_input: {
    labelKey: "toolRequestUserInput",
    icon: MessageCircleQuestionMark,
  },
  search_tools: { labelKey: "toolSearchTools", icon: Search },
  load_tools: { labelKey: "toolLoadTools", icon: PackageOpen },
  inspect_mcp_server: { labelKey: "toolInspectMcpServer", icon: Wrench },
  list_mcp_resources: {
    labelKey: "toolListMcpResources",
    icon: FolderSearch,
  },
  read_mcp_resource: { labelKey: "toolReadMcpResource", icon: FileText },
  list_mcp_prompts: { labelKey: "toolListMcpPrompts", icon: BookOpen },
  get_mcp_prompt: { labelKey: "toolGetMcpPrompt", icon: BookOpen },
  start_long_text_output: {
    labelKey: "toolStartLongTextOutput",
    icon: FileText,
  },
  list_workspace_files: {
    labelKey: "toolListWorkspaceFiles",
    icon: FolderOpen,
  },
  read_workspace_file: { labelKey: "toolReadWorkspaceFile", icon: FileText },
  stat_workspace_file: { labelKey: "toolStatWorkspaceFile", icon: FileText },
  diff_workspace_file: { labelKey: "toolDiffWorkspaceFile", icon: FilePen },
  write_workspace_file: { labelKey: "toolWriteWorkspaceFile", icon: FilePlus2 },
  edit_workspace_file: { labelKey: "toolEditWorkspaceFile", icon: FilePen },
  apply_workspace_patch: { labelKey: "toolApplyWorkspacePatch", icon: FilePen },
  trash_workspace_file: { labelKey: "toolTrashWorkspaceFile", icon: FileX2 },
  restore_workspace_file: {
    labelKey: "toolRestoreWorkspaceFile",
    icon: FolderInput,
  },
  delete_workspace_file: { labelKey: "toolDeleteWorkspaceFile", icon: FileX2 },
  validate_workspace_file: {
    labelKey: "toolValidateWorkspaceFile",
    icon: CheckCircle2,
  },
  publish_artifact: { labelKey: "toolPublishArtifact", icon: Share2 },
  share_workspace_file: { labelKey: "toolShareWorkspaceFile", icon: Share2 },
  search_workspace_files: {
    labelKey: "toolSearchWorkspaceFiles",
    icon: FolderSearch,
  },
  move_workspace_file: { labelKey: "toolMoveWorkspaceFile", icon: FolderInput },
  create_archive: { labelKey: "toolCreateArchive", icon: FileArchive },
} as const;

type BuiltinToolName = keyof typeof BUILTIN_TOOL_PRESENTATIONS;

const getBuiltinToolPresentation = (
  name: string,
): (typeof BUILTIN_TOOL_PRESENTATIONS)[BuiltinToolName] | undefined =>
  BUILTIN_TOOL_PRESENTATIONS[name as BuiltinToolName];

function getToolTargetSummary(args: unknown): string | null {
  const redacted = redactSensitiveToolArgs(args);
  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) {
    return null;
  }
  const input = redacted as Record<string, unknown>;
  for (const key of [
    "url",
    "uri",
    "path",
    "from",
    "to",
    "target",
    "recipient",
    "channel",
    "id",
  ]) {
    const value = input[key];
    if (typeof value === "string" && value && value !== "[REDACTED]") {
      return value.slice(0, 240);
    }
  }
  return null;
}

const ToolNameIcon: React.FC<{ name: string }> = ({ name }) => {
  const Icon = getBuiltinToolPresentation(name)?.icon ?? Wrench;
  return <Icon size={12} className="text-gray-400" aria-hidden="true" />;
};

const ToolResultImage: React.FC<{ image: Attachment }> = ({ image }) => {
  const openImagePreview = useUIStore((state) => state.openImagePreview);
  const src = useAttachmentDisplayUrl(image);

  return (
    <Button
      variant="bare"
      type="button"
      disabled={!src}
      onClick={() => {
        if (!src) return;
        openImagePreview(
          [
            {
              url: src,
              alt: image.fileName,
              description: image.fileName,
            },
          ],
          0,
        );
      }}
      className="block max-w-full overflow-hidden rounded-lg border border-gray-200 bg-white/70 text-left shadow-sm transition-shadow enabled:cursor-pointer enabled:hover:shadow-md disabled:cursor-default dark:border-border dark:bg-background/40"
      aria-label={image.fileName}
    >
      <SafeImage
        src={src}
        alt={image.fileName}
        className="max-h-72 max-w-full object-contain"
        fallback={
          <div className="flex h-32 w-56 max-w-full items-center justify-center text-gray-400 dark:text-muted-foreground">
            <ImageOff size={20} aria-hidden="true" />
          </div>
        }
      />
    </Button>
  );
};

const ToolCallBlock: React.FC<ToolCallBlockProps> = ({
  toolCalls,
  onConfirmationDecision,
  onRevokeSessionApproval,
}) => {
  const t = useTranslations("Content");
  const [isExpanded, setIsExpanded] = useState(false);
  const panelId = useId();
  const safeToolCalls = toolCalls || EMPTY_TOOL_CALLS;

  const displayToolCalls = useMemo(
    () =>
      safeToolCalls.map((toolCall) => {
        const builtinPresentation = getBuiltinToolPresentation(toolCall.name);
        const resultValue = isToolResultEnvelope(toolCall.result)
          ? toolCall.result.ok
            ? toolCall.result.data
            : toolCall.result.error
          : toolCall.result;
        return {
          ...toolCall,
          displayName: builtinPresentation
            ? t(builtinPresentation.labelKey)
            : formatToolDisplayName(toolCall.name),
          argsDisplay: formatToolDisplayValue(
            redactSensitiveToolArgs(toolCall.args),
          ),
          resultDisplay:
            resultValue !== undefined
              ? formatToolDisplayValue(resultValue)
              : null,
          targetSummary: getToolTargetSummary(toolCall.args),
        };
      }),
    [safeToolCalls, t],
  );

  const awaitingConfirmation = safeToolCalls.find(
    (tc) => tc.status === "awaiting_confirmation",
  );

  useEffect(() => {
    if (awaitingConfirmation) setIsExpanded(true);
  }, [awaitingConfirmation]);

  if (safeToolCalls.length === 0) return null;

  const activeTool = safeToolCalls.find(
    (tc) =>
      tc.status === "pending" ||
      tc.status === "awaiting_confirmation" ||
      tc.status === "running",
  );
  const activeDisplayTool = displayToolCalls.find(
    (tc) => tc.id === activeTool?.id,
  );
  const summaryDisplayTool =
    activeDisplayTool || displayToolCalls[displayToolCalls.length - 1];
  const isLoading = !!activeTool && !awaitingConfirmation;
  const isError = safeToolCalls.some(
    (tc) =>
      tc.status === "error" ||
      tc.status === "skipped" ||
      tc.status === "denied" ||
      tc.isError ||
      (isToolResultEnvelope(tc.result) && !tc.result.ok),
  );

  const displayTitle =
    awaitingConfirmation && activeDisplayTool
      ? t("confirmationRequired", { name: activeDisplayTool.displayName })
      : isLoading && activeDisplayTool
        ? t("runningTool", { name: activeDisplayTool.displayName })
        : t("usedTools", { count: safeToolCalls.length });

  const getRiskLabel = (risk: ToolCall["risk"]) => {
    switch (risk) {
      case "read":
        return t("riskRead");
      case "write":
        return t("riskWrite");
      case "destructive":
        return t("riskDestructive");
      case "external":
        return t("riskExternal");
      default:
        return null;
    }
  };

  const getEffectLabel = (
    effect: NonNullable<ToolCall["invocationPolicy"]>["effects"][number],
  ) => t(`effect_${effect}`);

  const TruncatedBadge = () => (
    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-200">
      {t("truncated")}
    </span>
  );

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-gray-200 bg-gray-50/50 transition-[border-color,background-color,box-shadow] duration-300 dark:border-border dark:bg-muted/30">
      <Button
        variant="bare"
        type="button"
        aria-expanded={isExpanded}
        aria-controls={panelId}
        aria-busy={isLoading || undefined}
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex min-h-11 w-full cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 motion-reduce:transition-none dark:text-muted-foreground dark:hover:bg-accent/30"
      >
        <div
          className={`p-1 rounded ${awaitingConfirmation ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" : isLoading ? "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" : isError ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"}`}
        >
          {awaitingConfirmation ? (
            <ShieldAlert size={12} aria-hidden="true" />
          ) : isLoading ? (
            <LoaderCircle
              size={12}
              className="animate-spin"
              aria-hidden="true"
            />
          ) : (
            <Blocks size={12} aria-hidden="true" />
          )}
        </div>

        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate">{displayTitle}</span>
          {summaryDisplayTool?.targetSummary ? (
            <span className="block truncate text-[10px] font-normal text-muted-foreground">
              {t("toolTarget")}: {summaryDisplayTool.targetSummary}
            </span>
          ) : null}
        </span>

        <ChevronDown
          size={14}
          className={`transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </Button>

      <div
        id={panelId}
        role="region"
        aria-label={t("toolCallDetails")}
        hidden={!isExpanded}
        className="border-t border-gray-200/50 dark:border-border"
      >
        <div className="overflow-hidden">
          <div className="space-y-3 bg-white/40 px-3 py-2 dark:bg-card/40">
            {displayToolCalls.map((tc) => (
              <div key={tc.id} className="text-xs">
                <div className="flex items-center justify-between mb-1.5 font-medium text-gray-700 dark:text-foreground/85">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <ToolNameIcon name={tc.name} />
                    <span className="truncate">{tc.displayName}</span>
                    {tc.invocationPolicy?.effects.map((effect) => (
                      <span
                        key={effect}
                        className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-muted dark:text-muted-foreground"
                      >
                        {getEffectLabel(effect)}
                      </span>
                    ))}
                    {!tc.invocationPolicy?.effects.length && tc.risk ? (
                      <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-muted dark:text-muted-foreground">
                        {getRiskLabel(tc.risk)}
                      </span>
                    ) : null}
                    {tc.confirmation?.decision === "allow_once" ? (
                      <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200">
                        {t("approvedOnce")}
                      </span>
                    ) : tc.confirmation?.decision === "allow_session" ? (
                      <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200">
                        {t("approvedSession")}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    {typeof tc.durationMs === "number" ? (
                      <span className="mr-1 tabular-nums text-[10px] text-muted-foreground">
                        {tc.durationMs < 1_000
                          ? `${tc.durationMs}ms`
                          : `${(tc.durationMs / 1_000).toFixed(1)}s`}
                      </span>
                    ) : null}
                    {tc.status === "awaiting_confirmation" ? (
                      <span
                        role="status"
                        aria-live="polite"
                        className="flex items-center gap-1 text-amber-600 dark:text-amber-400"
                      >
                        <ShieldAlert size={10} aria-hidden="true" />{" "}
                        {t("statusAwaitingConfirmation")}
                      </span>
                    ) : tc.status === "pending" || tc.status === "running" ? (
                      <span
                        role="status"
                        aria-live="polite"
                        className="text-blue-500 flex items-center gap-1"
                      >
                        <LoaderCircle
                          size={10}
                          className="animate-spin"
                          aria-hidden="true"
                        />{" "}
                        {tc.status === "pending"
                          ? t("statusPending")
                          : t("statusRunning")}
                      </span>
                    ) : tc.status === "skipped" ? (
                      <span className="text-amber-500 flex items-center gap-1">
                        <AlertCircle size={10} aria-hidden="true" />{" "}
                        {t("statusSkipped")}
                      </span>
                    ) : tc.status === "denied" ? (
                      <span className="text-amber-600 flex items-center gap-1 dark:text-amber-400">
                        <AlertCircle size={10} aria-hidden="true" />{" "}
                        {t("statusDenied")}
                      </span>
                    ) : tc.confirmation?.state === "interrupted" ? (
                      <span className="text-amber-600 flex items-center gap-1 dark:text-amber-400">
                        <AlertCircle size={10} aria-hidden="true" />{" "}
                        {t("statusInterrupted")}
                      </span>
                    ) : tc.confirmation?.state === "error" ? (
                      <span className="text-red-500 flex items-center gap-1">
                        <AlertCircle size={10} aria-hidden="true" />{" "}
                        {t("statusConfirmationFailed")}
                      </span>
                    ) : tc.status === "error" || tc.isError ? (
                      <span className="text-red-500 flex items-center gap-1">
                        <AlertCircle size={10} aria-hidden="true" />{" "}
                        {t("statusError")}
                      </span>
                    ) : (
                      <span className="text-green-500 flex items-center gap-1">
                        <CheckCircle2 size={10} aria-hidden="true" />{" "}
                        {t("statusSuccess")}
                      </span>
                    )}
                  </div>
                </div>

                {tc.status === "awaiting_confirmation" &&
                onConfirmationDecision ? (
                  <div
                    role="alert"
                    className="mb-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
                  >
                    <p className="leading-relaxed">
                      {t("confirmationPrompt", {
                        plugin:
                          tc.pluginTitle || tc.pluginId || t("toolPlugin"),
                        risk: getRiskLabel(tc.risk) || t("riskExternal"),
                      })}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="bare"
                        type="button"
                        onClick={() =>
                          onConfirmationDecision(tc.id, "allow_once")
                        }
                        className="min-h-11 rounded bg-amber-600 px-3 py-2 font-medium text-white hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                      >
                        {t("allowOnce")}
                      </Button>
                      {tc.confirmation?.canPersist ? (
                        <Button
                          variant="bare"
                          type="button"
                          onClick={() =>
                            onConfirmationDecision(tc.id, "allow_session")
                          }
                          className="min-h-11 rounded border border-amber-400 bg-white px-3 py-2 font-medium text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:bg-transparent dark:text-amber-100 dark:hover:bg-amber-950/60"
                        >
                          {t("allowSession")}
                        </Button>
                      ) : null}
                      <Button
                        variant="bare"
                        type="button"
                        onClick={() => onConfirmationDecision(tc.id, "deny")}
                        className="min-h-11 rounded border border-gray-300 bg-white px-3 py-2 font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-accent"
                      >
                        {t("denyTool")}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {tc.confirmation?.decision === "allow_session" &&
                onRevokeSessionApproval ? (
                  <Button
                    variant="bare"
                    type="button"
                    onClick={() => onRevokeSessionApproval(tc)}
                    className="mb-2 min-h-11 rounded border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-accent"
                  >
                    {t("revokeSessionApproval")}
                  </Button>
                ) : null}

                <div className="mb-1 max-h-72 overflow-auto rounded bg-gray-100 p-2 font-mono text-gray-600 dark:bg-muted dark:text-foreground/85">
                  <span className="opacity-50 select-none">
                    {t("argsLabel")}
                  </span>
                  {tc.argsDisplay.truncated ? <TruncatedBadge /> : null}
                  <pre className="mt-1 whitespace-pre-wrap break-words">
                    {tc.argsDisplay.text}
                  </pre>
                </div>

                {(tc.result !== undefined || tc.resultImages?.length) && (
                  <div
                    className={`max-h-72 overflow-auto rounded p-2 font-mono border-l-2 ${tc.isError ? "bg-red-50 dark:bg-red-900/10 border-red-500 text-red-600 dark:text-red-300" : "bg-green-50 dark:bg-green-900/10 border-green-500 text-gray-600 dark:text-foreground/85"}`}
                  >
                    <span className="opacity-50 select-none">
                      {t("resultLabel")}
                    </span>
                    {tc.resultDisplay?.truncated ? <TruncatedBadge /> : null}
                    {tc.result !== undefined ? (
                      <pre className="mt-1 whitespace-pre-wrap break-words">
                        {tc.resultDisplay?.text || ""}
                      </pre>
                    ) : null}
                    {tc.resultImages?.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {tc.resultImages.map((image) => (
                          <ToolResultImage key={image.id} image={image} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ToolCallBlock;
