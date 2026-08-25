"use client";
import React, { useEffect, useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Attachment, ToolCall, ToolConfirmationDecision } from "@/types";
import { formatBytes } from "@/config/limits";
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
  getBuiltinToolLabelKey,
} from "@/lib/utils/toolDisplay";
import { redactSensitiveToolArgs } from "@/lib/plugin/confirmation";
import { isToolResultEnvelope } from "@/lib/agent/toolResult";
import {
  getWorkspaceToolPresentation,
  type WorkspaceToolPresentation,
} from "@/lib/utils/workspaceToolPresentation";
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

const BUILTIN_TOOL_ICONS = {
  web_search: Search,
  search_web: Search,
  search_knowledge: BookOpen,
  memory_list: BookOpen,
  remember: FilePlus2,
  memory_update: FilePen,
  forget: FileX2,
  memory_restore: FolderInput,
  load_skill: Sparkles,
  search_skills: Search,
  inspect_skill: BookOpen,
  run_javascript: SquareCode,
  fetch_url: Globe,
  fetch_urls: Globe,
  inspect_attachment: FolderSearch,
  extract_document: FileText,
  update_task_plan: ListChecks,
  request_user_input: MessageCircleQuestionMark,
  search_tools: Search,
  load_tools: PackageOpen,
  inspect_mcp_server: Wrench,
  list_mcp_resources: FolderSearch,
  read_mcp_resource: FileText,
  list_mcp_prompts: BookOpen,
  get_mcp_prompt: BookOpen,
  start_long_text_output: FileText,
  list_workspace_files: FolderOpen,
  read_workspace_file: FileText,
  stat_workspace_file: FileText,
  diff_workspace_file: FilePen,
  write_workspace_file: FilePlus2,
  edit_workspace_file: FilePen,
  apply_workspace_patch: FilePen,
  trash_workspace_file: FileX2,
  restore_workspace_file: FolderInput,
  delete_workspace_file: FileX2,
  validate_workspace_file: CheckCircle2,
  publish_artifact: Share2,
  share_workspace_file: Share2,
  search_workspace_files: FolderSearch,
  move_workspace_file: FolderInput,
  create_archive: FileArchive,
} as const;

type BuiltinToolIconName = keyof typeof BUILTIN_TOOL_ICONS;

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
  const Icon = BUILTIN_TOOL_ICONS[name as BuiltinToolIconName] ?? Wrench;
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
        const builtinLabelKey = getBuiltinToolLabelKey(toolCall.name);
        const resultValue = isToolResultEnvelope(toolCall.result)
          ? toolCall.result.ok
            ? toolCall.result.data
            : toolCall.result.error
          : toolCall.result;
        return {
          ...toolCall,
          displayName: builtinLabelKey
            ? t(builtinLabelKey)
            : formatToolDisplayName(toolCall.name),
          argsDisplay: formatToolDisplayValue(
            redactSensitiveToolArgs(toolCall.args),
          ),
          resultDisplay:
            resultValue !== undefined
              ? formatToolDisplayValue(resultValue)
              : null,
          targetSummary: getToolTargetSummary(toolCall.args),
          workspacePresentation: getWorkspaceToolPresentation(toolCall),
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

  const WorkspaceResultCard = ({
    snapshot,
  }: {
    snapshot: WorkspaceToolPresentation;
  }) => {
    const metadata = [
      snapshot.mode
        ? {
            label: t("workspaceToolMode"),
            value: t(`workspaceToolMode_${snapshot.mode}`),
          }
        : null,
      snapshot.revision
        ? {
            label: t("workspaceToolRevision"),
            value: snapshot.revision.replace(/^sha256:/, "").slice(0, 12),
          }
        : null,
      typeof snapshot.bytes === "number"
        ? {
            label: t("workspaceToolSize"),
            value: formatBytes(snapshot.bytes),
          }
        : null,
      typeof snapshot.replacements === "number"
        ? {
            label: t("workspaceToolReplacements"),
            value: String(snapshot.replacements),
          }
        : null,
    ].filter((item): item is { label: string; value: string } => item !== null);

    return (
      <div className="mb-2 overflow-hidden rounded-md border border-blue-200/80 bg-blue-50/50 dark:border-blue-900/70 dark:bg-blue-950/15">
        <div className="flex items-start gap-2 border-b border-blue-200/70 px-3 py-2 dark:border-blue-900/60">
          <FileText
            size={13}
            className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-300"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[11px] font-semibold text-foreground">
              {snapshot.target || t("workspaceToolWorkspaceTarget")}
            </div>
            {snapshot.from && snapshot.to ? (
              <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                {t("workspaceToolMove", {
                  from: snapshot.from,
                  to: snapshot.to,
                })}
              </div>
            ) : null}
          </div>
        </div>

        {metadata.length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 px-3 py-2 sm:grid-cols-4">
            {metadata.map((item) => (
              <div key={item.label} className="min-w-0">
                <dt className="text-[9px] font-medium text-muted-foreground">
                  {item.label}
                </dt>
                <dd className="mt-0.5 truncate font-mono text-[10px] text-foreground/85">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {snapshot.previews.map((preview, index) => (
          <div
            key={`${preview.kind}-${index}`}
            className="border-t border-blue-200/70 px-3 py-2 dark:border-blue-900/60"
          >
            <div className="text-[9px] font-medium text-muted-foreground">
              {t(`workspaceToolPreview_${preview.kind}`)}
            </div>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-foreground/85 custom-scrollbar">
              {preview.text || t("workspaceToolEmptyContent")}
            </pre>
            {preview.truncated ? (
              <span className="mt-1 inline-block text-[9px] font-medium text-amber-700 dark:text-amber-300">
                {t("workspaceToolPreviewTruncated")}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    );
  };

  const renderRawPayload = (tc: (typeof displayToolCalls)[number]) => (
    <>
      <div className="mb-1 max-h-72 overflow-auto rounded bg-gray-100 p-2 font-mono text-gray-600 dark:bg-muted dark:text-foreground/85">
        <span className="opacity-50 select-none">{t("argsLabel")}</span>
        {tc.argsDisplay.truncated ? <TruncatedBadge /> : null}
        <pre className="mt-1 whitespace-pre-wrap break-words">
          {tc.argsDisplay.text}
        </pre>
      </div>

      {tc.result !== undefined || tc.resultImages?.length ? (
        <div
          className={`max-h-72 overflow-auto rounded border-l-2 p-2 font-mono ${tc.isError ? "border-red-500 bg-red-50 text-red-600 dark:bg-red-900/10 dark:text-red-300" : "border-green-500 bg-green-50 text-gray-600 dark:bg-green-900/10 dark:text-foreground/85"}`}
        >
          <span className="opacity-50 select-none">{t("resultLabel")}</span>
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
      ) : null}
    </>
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
        className="flex w-full cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 motion-reduce:transition-none dark:text-muted-foreground dark:hover:bg-accent/30"
      >
        <div
          className={`p-1 rounded ${awaitingConfirmation ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" : isLoading ? "text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" : isError ? "text-red-600" : "dark:text-green-400"}`}
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

                {tc.workspacePresentation ? (
                  <WorkspaceResultCard snapshot={tc.workspacePresentation} />
                ) : null}

                {tc.workspacePresentation ? (
                  <details className="rounded-md border border-border bg-background/60 px-2.5 py-2">
                    <summary className="cursor-pointer select-none text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground">
                      {t("workspaceToolRawDetails")}
                    </summary>
                    <div className="mt-2">{renderRawPayload(tc)}</div>
                  </details>
                ) : (
                  renderRawPayload(tc)
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
