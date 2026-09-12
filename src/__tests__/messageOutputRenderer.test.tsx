// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import MessageOutputRenderer from "@/components/content/MessageOutputRenderer";
import contentMessages from "@/i18n/locales/en/Content.json";
import messageMessages from "@/i18n/locales/en/Message.json";
import type { Message, WorkspaceFilePresentation } from "@/types";
import { createAgentRun } from "@/lib/agent";
import { useAgentRunStore } from "@/store/core/agentRunStore";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useAgentRunStore.setState({ runsById: {}, loadedSessionIds: {} });
});

function renderMessage(
  message: Message,
  onWorkspaceFileOpen?: (file: WorkspaceFilePresentation) => void,
) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{
        Content: contentMessages,
        Message: messageMessages,
      }}
    >
      <MessageOutputRenderer
        message={message}
        displayedContent={message.content}
        searchSources={message.searchSources || []}
        onWorkspaceFileOpen={onWorkspaceFileOpen}
      />
    </NextIntlClientProvider>,
  );
}

describe("MessageOutputRenderer workspace file presentation", () => {
  it("never renders an Agent run bar for an internal Research journal", () => {
    const run = createAgentRun({
      id: "research-run",
      sessionId: "session-1",
      modelMessageId: "research-message",
      model: "openai:gpt-tools",
      workflowKind: "research",
      now: 1,
    });
    useAgentRunStore.setState({
      runsById: { [run.id]: run },
      loadedSessionIds: {},
    });

    renderMessage({
      id: "research-message",
      role: "model",
      content: "",
      timestamp: 1,
      generation: {
        status: "streaming",
        requestId: "request-1",
        agentRunId: run.id,
        ownerDeviceId: "device-1",
        model: "openai:gpt-tools",
        attempt: 0,
        checkpointAt: 1,
      },
    });

    expect(screen.queryByLabelText("Agent run")).toBeNull();
  });

  it("connects a workspace text card to the full-screen handler", async () => {
    const onWorkspaceFileOpen = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(function MockIntersectionObserver() {
        return {
          observe: vi.fn(),
          disconnect: vi.fn(),
          unobserve: vi.fn(),
          takeRecords: vi.fn(),
        };
      }),
    );
    const file: WorkspaceFilePresentation = {
      path: "out/report.md",
      fileName: "report.md",
      mimeType: "text/markdown",
      bytes: 24,
      url: "opfs://chat/workspace/session-1/out/report.md",
      revision: "share-1",
      title: "Quarterly report",
    };

    renderMessage(
      {
        id: "workspace-message",
        role: "model",
        content: "",
        timestamp: 1,
        outputBlocks: [
          {
            id: "workspace-file",
            type: "workspace_file",
            file,
          },
        ],
      },
      onWorkspaceFileOpen,
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "Open workspace file Quarterly report in full screen",
      }),
    );

    expect(onWorkspaceFileOpen).toHaveBeenCalledWith(file);
  });
});

describe("MessageOutputRenderer reasoning presentation", () => {
  it("uses a reasoning block's own lifecycle even when another block follows", () => {
    render(
      <NextIntlClientProvider
        locale="en"
        messages={{ Content: contentMessages, Message: messageMessages }}
      >
        <MessageOutputRenderer
          message={{
            id: "reasoning-message",
            role: "model",
            content: "",
            timestamp: 1,
            outputBlocks: [
              {
                id: "reasoning-complete",
                type: "reasoning",
                content: "Completed thought",
                startedAt: 10,
                endedAt: 20,
                durationMs: 10,
              },
              {
                id: "reasoning-active",
                type: "reasoning",
                content: "Active thought",
                startedAt: 30,
              },
              {
                id: "plan-after-reasoning",
                type: "task_plan",
                steps: [{ title: "Continue", status: "in_progress" }],
              },
            ],
          }}
          displayedContent=""
          searchSources={[]}
        />
      </NextIntlClientProvider>,
    );

    const completedToggle = screen.getByRole("button", {
      name: /Thought Process/u,
    });
    const activeToggle = screen.getByRole("button", {
      name: /Thinking/u,
    });
    expect(completedToggle.getAttribute("aria-expanded")).toBe("false");
    expect(completedToggle.getAttribute("aria-busy")).toBeNull();
    expect(activeToggle.getAttribute("aria-expanded")).toBe("true");
    expect(activeToggle.getAttribute("aria-busy")).toBe("true");
  });

  it("keeps thinking, failed search, and later thinking as compact separate blocks", () => {
    const { container } = renderMessage({
      id: "reasoning-search-reasoning",
      role: "model",
      content: "",
      timestamp: 1,
      outputBlocks: [
        {
          id: "thinking-before-search",
          type: "reasoning",
          content: "I should look this up.",
          startedAt: 10,
          endedAt: 20,
          durationMs: 10,
        },
        {
          id: "failed-search",
          type: "search",
          sources: [],
          images: [],
          isSearching: false,
          error: "Search request failed",
        },
        {
          id: "thinking-after-search",
          type: "reasoning",
          content: "I will continue without those results.",
          startedAt: 30,
        },
      ],
    });

    const blocks = Array.from(
      container.querySelectorAll<HTMLElement>("[data-message-output-block]"),
    );
    expect(blocks).toHaveLength(3);
    expect(blocks.map((block) => block.className)).toEqual([
      expect.stringContaining("mb-3"),
      expect.stringContaining("mb-3"),
      expect.stringContaining("mb-3"),
    ]);
    expect(blocks.every((block) => !block.className.includes("mt-3"))).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: /Thinking/u })).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /Thought Process/u }),
    ).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Search failed" })).toBeTruthy();
  });

  it("adds top spacing when a framed block follows ordinary Markdown", () => {
    const { container } = renderMessage({
      id: "text-before-reasoning",
      role: "model",
      content: "",
      timestamp: 2,
      outputBlocks: [
        {
          id: "text-before",
          type: "text",
          content: "A line of model text.\n",
        },
        {
          id: "reasoning-after-text",
          type: "reasoning",
          content: "A separate thought.",
          startedAt: 10,
          endedAt: 20,
          durationMs: 10,
        },
      ],
    });

    const blocks = container.querySelectorAll<HTMLElement>(
      "[data-message-output-block]",
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.className).toContain("mb-3");
    expect(blocks[0]?.className).toContain("mt-3");
  });
});

describe("MessageOutputRenderer web search presentation", () => {
  it("shows only the dedicated search loading state", () => {
    const { container } = renderMessage({
      id: "message-1",
      role: "model",
      content: "",
      timestamp: 1,
      outputBlocks: [
        {
          id: "tools-1",
          type: "tool_group",
          toolCalls: [
            {
              id: "web-search-1",
              name: "web_search",
              args: { query: "release notes" },
              status: "running",
            },
          ],
        },
        {
          id: "search-1",
          type: "search",
          sources: [],
          images: [],
          isSearching: true,
        },
      ],
    });

    expect(screen.getByText("Searching…")).toBeTruthy();
    expect(screen.queryByText("Running Web search…")).toBeNull();
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
  });

  it("keeps search results while hiding the generic tool result", async () => {
    renderMessage({
      id: "message-2",
      role: "model",
      content: "",
      timestamp: 2,
      outputBlocks: [
        {
          id: "tools-2",
          type: "tool_group",
          toolCalls: [
            {
              id: "web-search-2",
              name: "web_search",
              args: { query: "release notes" },
              status: "success",
              result: "hidden raw tool result",
            },
          ],
        },
        {
          id: "search-2",
          type: "search",
          sources: [
            {
              title: "Release notes",
              url: "https://example.com/releases",
              content: "Latest release",
            },
          ],
          images: [],
          isSearching: false,
        },
      ],
    });

    expect(screen.queryByRole("button", { name: "Used 1 Tool" })).toBeNull();
    expect(screen.queryByText("hidden raw tool result")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Sources" }));
    expect(screen.getByText("Release notes")).toBeTruthy();
  });

  it("does not present a stale search error when results are available", async () => {
    renderMessage({
      id: "message-search-partial",
      role: "model",
      content: "",
      timestamp: 3,
      outputBlocks: [
        {
          id: "search-partial",
          type: "search",
          sources: [
            {
              title: "Available result",
              url: "https://example.com/result",
              content: "Useful search content",
            },
          ],
          images: [],
          isSearching: false,
          error: "Search request failed",
        },
      ],
    });

    const toggle = screen.getByRole("button", { name: "Sources" });
    expect(screen.queryByText("Search request failed")).toBeNull();

    await userEvent.click(toggle);
    expect(screen.getByText("Available result")).toBeTruthy();
    expect(screen.queryByText("Search request failed")).toBeNull();
  });

  it("allows an error-only search panel to expand and collapse", async () => {
    renderMessage({
      id: "message-search-error",
      role: "model",
      content: "",
      timestamp: 4,
      outputBlocks: [
        {
          id: "search-error",
          type: "search",
          sources: [],
          images: [],
          isSearching: false,
          error: "Search request failed",
        },
      ],
    });

    const toggle = screen.getByRole("button", { name: "Search failed" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Search request failed")).toBeNull();

    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Search request failed")).toBeTruthy();

    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Search request failed")).toBeNull();
  });

  it("counts and renders only non-search tools in a mixed group", async () => {
    renderMessage({
      id: "message-3",
      role: "model",
      content: "",
      timestamp: 3,
      outputBlocks: [
        {
          id: "tools-3",
          type: "tool_group",
          toolCalls: [
            {
              id: "web-search-3",
              name: "web_search",
              args: { query: "release notes" },
              status: "success",
              result: { sources: [] },
            },
            {
              id: "javascript-1",
              name: "run_javascript",
              args: { code: "1 + 1" },
              status: "success",
              result: 2,
            },
          ],
        },
      ],
    });

    const toolButton = screen.getByRole("button", { name: "Used 1 Tool" });
    await userEvent.click(toolButton);

    expect(screen.getByText("Run JavaScript")).toBeTruthy();
    expect(screen.queryByText("Web search")).toBeNull();
    expect(screen.queryByText("release notes")).toBeNull();
  });

  it("hides web search tool details for legacy messages", () => {
    renderMessage({
      id: "message-4",
      role: "model",
      content: "",
      timestamp: 4,
      searchSources: [
        {
          title: "Legacy source",
          url: "https://example.com/legacy",
          content: "Legacy result",
        },
      ],
      toolCalls: [
        {
          id: "web-search-legacy",
          name: "web_search",
          args: { query: "legacy search" },
          status: "success",
          result: "legacy raw tool result",
        },
      ],
    });

    expect(screen.getByRole("button", { name: "Sources" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Used 1 Tool" })).toBeNull();
    expect(screen.queryByText("legacy raw tool result")).toBeNull();
  });

  it("hides successful long text declarations but keeps their failures", async () => {
    const { rerender } = renderMessage({
      id: "long-text-success",
      role: "model",
      content: "",
      timestamp: 5,
      outputBlocks: [
        {
          id: "tools-long-text-success",
          type: "tool_group",
          toolCalls: [
            {
              id: "long-text-call-success",
              name: "start_long_text_output",
              args: { title: "Report" },
              status: "success",
              result: { ok: true },
            },
          ],
        },
      ],
    });
    expect(screen.queryByRole("button", { name: "Used 1 Tool" })).toBeNull();

    rerender(
      <NextIntlClientProvider
        locale="en"
        messages={{ Content: contentMessages, Message: messageMessages }}
      >
        <MessageOutputRenderer
          message={{
            id: "long-text-error",
            role: "model",
            content: "",
            timestamp: 6,
            outputBlocks: [
              {
                id: "tools-long-text-error",
                type: "tool_group",
                toolCalls: [
                  {
                    id: "long-text-call-error",
                    name: "start_long_text_output",
                    args: { title: "Report" },
                    status: "error",
                    isError: true,
                    result: { error: { message: "Document body missing" } },
                  },
                ],
              },
            ],
          }}
          displayedContent=""
          searchSources={[]}
        />
      </NextIntlClientProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Used 1 Tool" }));
    expect(screen.getByText("Start long text document")).toBeTruthy();
    expect(screen.getByText(/Document body missing/)).toBeTruthy();
  });
});
