// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import MessageOutputRenderer from "@/components/content/MessageOutputRenderer";
import contentMessages from "@/i18n/locales/en/Content.json";
import messageMessages from "@/i18n/locales/en/Message.json";
import type { Message } from "@/types";

afterEach(cleanup);

function renderMessage(message: Message) {
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
      />
    </NextIntlClientProvider>,
  );
}

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
