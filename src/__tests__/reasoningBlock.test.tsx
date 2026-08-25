// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import ReasoningBlock from "@/components/content/ReasoningBlock";
import contentMessages from "@/i18n/locales/en/Content.json";

afterEach(cleanup);

interface ReasoningState {
  id: string;
  content: string;
  active: boolean;
}

function ReasoningSequence({ blocks }: { blocks: ReasoningState[] }) {
  return (
    <NextIntlClientProvider locale="en" messages={{ Content: contentMessages }}>
      {blocks.map((block) => (
        <ReasoningBlock
          key={block.id}
          reasoning={block.content}
          isThinking={block.active}
        />
      ))}
    </NextIntlClientProvider>
  );
}

describe("ReasoningBlock expansion", () => {
  it("opens and closes each streamed block independently", async () => {
    const view = render(
      <ReasoningSequence
        blocks={[{ id: "first", content: "First thought", active: true }]}
      />,
    );
    expect(
      screen.getAllByRole("button")[0]?.getAttribute("aria-expanded"),
    ).toBe("true");

    view.rerender(
      <ReasoningSequence
        blocks={[
          { id: "first", content: "First thought", active: false },
          { id: "second", content: "Second thought", active: true },
        ]}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]?.getAttribute("aria-expanded")).toBe("false");
    expect(buttons[1]?.getAttribute("aria-expanded")).toBe("true");

    view.rerender(
      <ReasoningSequence
        blocks={[
          { id: "first", content: "First thought", active: false },
          { id: "second", content: "Second thought", active: false },
        ]}
      />,
    );
    expect(
      screen.getAllByRole("button")[1]?.getAttribute("aria-expanded"),
    ).toBe("false");

    await userEvent.click(screen.getAllByRole("button")[0]!);
    expect(
      screen.getAllByRole("button")[0]?.getAttribute("aria-expanded"),
    ).toBe("true");
    view.rerender(
      <ReasoningSequence
        blocks={[
          { id: "first", content: "First thought", active: false },
          { id: "second", content: "Second thought", active: false },
        ]}
      />,
    );
    expect(
      screen.getAllByRole("button")[0]?.getAttribute("aria-expanded"),
    ).toBe("true");
  });
});
