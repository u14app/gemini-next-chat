// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import AgentRunBar from "@/components/content/AgentRunBar";
import {
  createAgentRun,
  prepareToolExecution,
  transitionAgentRunStatus,
} from "@/lib/agent";
import type { AgentRun } from "@/lib/agent";
import englishContent from "@/i18n/locales/en/Content.json";
import japaneseContent from "@/i18n/locales/ja/Content.json";
import chineseContent from "@/i18n/locales/zh/Content.json";

afterEach(cleanup);

const readPolicy = {
  effects: ["network_read" as const],
  idempotency: "idempotent" as const,
  sensitivity: "none" as const,
  origin: "builtin" as const,
};

function createRun(toolName = "search_web") {
  return prepareToolExecution(
    createAgentRun({ id: "run-1", sessionId: "session-1", now: 100 }),
    {
      id: "execution-1",
      callId: "call-1",
      toolName,
      definitionFingerprint: "definition-hash",
      argumentsHash: "arguments-hash",
      round: 1,
      policy: readPolicy,
      at: 110,
    },
  );
}

function renderRun(
  run: AgentRun,
  locale = "en",
  messages: Record<string, string> = englishContent,
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ Content: messages }}>
      <AgentRunBar run={run} />
    </NextIntlClientProvider>,
  );
}

describe("AgentRunBar", () => {
  it("collapses on completion and keeps terminal user expansion", async () => {
    const run = createRun();
    const view = renderRun(run);
    const activeToggle = screen.getByRole("button", {
      name: /Agent is working/u,
    });
    expect(activeToggle.getAttribute("aria-expanded")).toBe("true");

    const completed = transitionAgentRunStatus(run, "completed", {
      at: 200,
      stop: { reason: "completed" },
    });
    view.rerender(
      <NextIntlClientProvider
        locale="en"
        messages={{ Content: englishContent }}
      >
        <AgentRunBar run={completed} />
      </NextIntlClientProvider>,
    );
    const completedToggle = screen.getByRole("button", {
      name: /Agent run completed/u,
    });
    expect(completedToggle.getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(completedToggle);
    expect(completedToggle.getAttribute("aria-expanded")).toBe("true");
    view.rerender(
      <NextIntlClientProvider
        locale="en"
        messages={{ Content: englishContent }}
      >
        <AgentRunBar run={{ ...completed, updatedAt: 210 }} />
      </NextIntlClientProvider>,
    );
    expect(completedToggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("opens failed and interrupted runs for diagnosis", () => {
    const run = createRun();
    const failed = transitionAgentRunStatus(run, "failed", {
      at: 200,
      stop: {
        reason: "runtime_error",
        error: { message: "Tool failed" },
      },
    });
    const view = renderRun(failed);
    expect(
      screen
        .getByRole("button", { name: /Agent run failed/u })
        .getAttribute("aria-expanded"),
    ).toBe("true");

    const interrupted = transitionAgentRunStatus(run, "interrupted", {
      at: 200,
      stop: { reason: "page_interrupted" },
    });
    view.rerender(
      <NextIntlClientProvider
        locale="en"
        messages={{ Content: englishContent }}
      >
        <AgentRunBar run={interrupted} />
      </NextIntlClientProvider>,
    );
    expect(
      screen
        .getByRole("button", { name: /Agent run interrupted/u })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it.each([
    {
      locale: "zh",
      messages: chineseContent,
      tool: "网络搜索",
      tokens: "词元",
      evidence: "论据",
    },
    {
      locale: "ja",
      messages: japaneseContent,
      tool: "Web を検索",
      tokens: "トークン",
      evidence: "根拠",
    },
    {
      locale: "en",
      messages: englishContent,
      tool: "Search web",
      tokens: "Tokens",
      evidence: "Evidence",
    },
  ])("localizes Agent tool and usage labels in $locale", (variant) => {
    renderRun(createRun(), variant.locale, variant.messages);

    expect(screen.getAllByText(variant.tool).length).toBeGreaterThan(0);
    expect(screen.getByText(variant.tokens)).toBeTruthy();
    expect(screen.getByText(variant.evidence)).toBeTruthy();
  });

  it("humanizes unknown plugin tool identifiers", () => {
    renderRun(createRun("create_issue"));

    expect(screen.getAllByText("Create Issue").length).toBeGreaterThan(0);
    expect(screen.queryByText("create_issue")).toBeNull();
  });
});
