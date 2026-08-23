// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import ToolCallBlock from "@/components/content/ToolCallBlock";
import type { ToolCall } from "@/types";
import contentMessages from "@/i18n/locales/en/Content.json";
import japaneseContentMessages from "@/i18n/locales/ja/Content.json";
import chineseContentMessages from "@/i18n/locales/zh/Content.json";

afterEach(cleanup);

function renderBlock(
  toolCall: ToolCall,
  handlers: {
    onDecision?: (toolCallId: string, decision: string) => void;
    onRevoke?: (toolCall: ToolCall) => void;
  } = {},
) {
  return renderBlocks([toolCall], handlers);
}

function renderBlocks(
  toolCalls: ToolCall[],
  handlers: {
    onDecision?: (toolCallId: string, decision: string) => void;
    onRevoke?: (toolCall: ToolCall) => void;
  } = {},
  locale = "en",
  messages: Record<string, string> = contentMessages,
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ Content: messages }}>
      <ToolCallBlock
        toolCalls={toolCalls}
        onConfirmationDecision={handlers.onDecision}
        onRevokeSessionApproval={handlers.onRevoke}
      />
    </NextIntlClientProvider>,
  );
}

const awaitingWriteCall: ToolCall = {
  id: "call-1",
  name: "create_issue",
  pluginId: "tracker",
  pluginTitle: "Issue Tracker",
  functionFingerprint: "fingerprint-1",
  risk: "write",
  args: { title: "Bug", apiKey: "do-not-display" },
  status: "awaiting_confirmation",
  confirmation: { required: true, canPersist: true, state: "pending" },
};

describe("ToolCallBlock confirmation controls", () => {
  it("shows redacted write confirmation and returns the selected decision", async () => {
    const onDecision = vi.fn();
    renderBlock(awaitingWriteCall, { onDecision });

    expect(screen.getByText("Allow once")).toBeTruthy();
    expect(screen.getByText("Allow for this chat")).toBeTruthy();
    expect(screen.queryByText("do-not-display")).toBeNull();

    await userEvent.click(screen.getByText("Allow for this chat"));
    expect(onDecision).toHaveBeenCalledWith("call-1", "allow_session");
  });

  it("does not offer session permission for destructive calls", () => {
    renderBlock(
      {
        ...awaitingWriteCall,
        id: "call-destructive",
        risk: "destructive",
        confirmation: {
          required: true,
          canPersist: false,
          state: "pending",
        },
      },
      { onDecision: vi.fn() },
    );

    expect(screen.getByText("Allow once")).toBeTruthy();
    expect(screen.queryByText("Allow for this chat")).toBeNull();
  });

  it("does not offer session permission when V2 policy forbids persistence", () => {
    renderBlock(
      {
        ...awaitingWriteCall,
        id: "call-credential",
        confirmation: {
          required: true,
          canPersist: false,
          state: "pending",
        },
      },
      { onDecision: vi.fn() },
    );

    expect(screen.getByText("Allow once")).toBeTruthy();
    expect(screen.queryByText("Allow for this chat")).toBeNull();
  });

  it("allows an existing session permission to be revoked", async () => {
    const onRevoke = vi.fn();
    const approvedCall: ToolCall = {
      ...awaitingWriteCall,
      status: "success",
      result: { ok: true },
      confirmation: {
        required: true,
        state: "approved",
        decision: "allow_session",
        decidedAt: Date.now(),
      },
    };
    renderBlock(approvedCall, { onRevoke });

    await userEvent.click(screen.getByText("Revoke permission for this chat"));
    expect(onRevoke).toHaveBeenCalledWith(
      expect.objectContaining({
        id: approvedCall.id,
        pluginId: approvedCall.pluginId,
        functionFingerprint: approvedCall.functionFingerprint,
        risk: approvedCall.risk,
      }),
    );
  });

  it("distinguishes one-time approval from session approval", () => {
    renderBlock({
      ...awaitingWriteCall,
      status: "success",
      result: { ok: true },
      confirmation: {
        required: true,
        state: "approved",
        decision: "allow_once",
        decidedAt: Date.now(),
      },
    });

    expect(screen.getByText("Allowed once")).toBeTruthy();
    expect(screen.queryByText("Allowed for this chat")).toBeNull();
  });

  it("shows interrupted confirmation separately from user denial", () => {
    renderBlock({
      ...awaitingWriteCall,
      status: "error",
      errorInfo: {
        code: "CONFIRMATION_INTERRUPTED",
        message: "Approval was interrupted",
      },
      confirmation: {
        required: true,
        state: "interrupted",
        decidedAt: Date.now(),
      },
    });

    expect(screen.getByText("Approval interrupted")).toBeTruthy();
    expect(screen.queryByText("Denied")).toBeNull();
  });
});

describe("ToolCallBlock built-in tool presentation", () => {
  it("uses the localized built-in name in the active tool title", () => {
    renderBlock({
      id: "web-search",
      name: "web_search",
      args: { query: "release notes" },
      status: "pending",
    });

    expect(screen.getByText("Running Web search…")).toBeTruthy();
  });

  it("keeps the current Tool target visible in the collapsed summary", () => {
    renderBlock({
      id: "fetch-target",
      name: "fetch_url",
      args: { url: "https://example.com/report" },
      status: "pending",
    });

    expect(screen.getByText("Target: https://example.com/report")).toBeTruthy();
  });

  it("shows distinct names and icons for all Agent built-ins", async () => {
    const { container } = renderBlocks(
      [
        ["web-search", "web_search"],
        ["knowledge-search", "search_knowledge"],
        ["load-skill", "load_skill"],
        ["run-javascript", "run_javascript"],
        ["fetch-url", "fetch_url"],
        ["task-plan", "update_task_plan"],
        ["long-text", "start_long_text_output"],
        ["list-workspace", "list_workspace_files"],
        ["search-workspace", "search_workspace_files"],
        ["read-workspace", "read_workspace_file"],
        ["write-workspace", "write_workspace_file"],
        ["edit-workspace", "edit_workspace_file"],
        ["move-workspace", "move_workspace_file"],
        ["delete-workspace", "delete_workspace_file"],
        ["share-workspace", "share_workspace_file"],
        ["create-archive", "create_archive"],
      ].map(([id, name]) => ({
        id,
        name,
        args: {},
        result: { ok: true },
        status: "success" as const,
      })),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Used 16 Tools" }),
    );

    [
      "Web search",
      "Knowledge search",
      "Load skill",
      "Run JavaScript",
      "Read web page",
      "Update task plan",
      "Start long text document",
      "List workspace files",
      "Search workspace files",
      "Read workspace file",
      "Write workspace file",
      "Edit workspace file",
      "Move workspace file",
      "Delete workspace file",
      "Share workspace file",
      "Create archive",
    ].forEach((label) => expect(screen.getByText(label)).toBeTruthy());
    [
      "lucide-search",
      "lucide-book-open",
      "lucide-sparkles",
      "lucide-square-code",
      "lucide-globe",
      "lucide-list-checks",
      "lucide-folder-open",
      "lucide-folder-search",
      "lucide-file-plus-corner",
      "lucide-file-pen",
      "lucide-folder-input",
      "lucide-file-x-corner",
      "lucide-share-2",
      "lucide-file-archive",
    ].forEach((className) =>
      expect(container.querySelector(`.${className}`)).toBeTruthy(),
    );
  });

  it.each([
    {
      locale: "en",
      messages: contentMessages,
      labels: [
        "Search workspace files",
        "Move workspace file",
        "Create archive",
      ],
    },
    {
      locale: "ja",
      messages: japaneseContentMessages,
      labels: [
        "ワークスペースファイルを検索",
        "ワークスペースファイルを移動",
        "アーカイブを作成",
      ],
    },
    {
      locale: "zh",
      messages: chineseContentMessages,
      labels: ["搜索工作区文件", "移动工作区文件", "创建压缩包"],
    },
  ])("localizes the missing workspace tools in $locale", async (variant) => {
    renderBlocks(
      ["search_workspace_files", "move_workspace_file", "create_archive"].map(
        (name, index) => ({
          id: `workspace-tool-${index}`,
          name,
          args: {},
          result: { ok: true },
          status: "success" as const,
        }),
      ),
      {},
      variant.locale,
      variant.messages,
    );

    await userEvent.click(screen.getByRole("button"));
    variant.labels.forEach((label) =>
      expect(screen.getByText(label)).toBeTruthy(),
    );
  });

  it("keeps the existing formatter and wrench icon for plugin tools", async () => {
    const { container } = renderBlock({
      id: "plugin-tool",
      name: "create_issue",
      pluginId: "tracker",
      args: {},
      result: { ok: true },
      status: "success",
    });

    await userEvent.click(screen.getByRole("button", { name: "Used 1 Tool" }));

    expect(screen.getByText("Create Issue")).toBeTruthy();
    expect(container.querySelector(".lucide-wrench")).toBeTruthy();
  });
});

describe("ToolCallBlock image results", () => {
  it("renders generated images inside the expanded tool result", async () => {
    renderBlock({
      id: "image-tool",
      name: "generate_image",
      args: { prompt: "A red panda" },
      result: { imageBase64: "[image omitted]", imageCount: 1 },
      resultImages: [
        {
          id: "image-1",
          mimeType: "image/png",
          url: "https://example.com/generated.png",
          fileName: "plugin-image.png",
        },
      ],
      status: "success",
    });

    await userEvent.click(screen.getByRole("button", { name: "Used 1 Tool" }));

    expect(
      screen.getByRole("img", { name: "plugin-image.png" }).getAttribute("src"),
    ).toBe("https://example.com/generated.png");
  });
});
