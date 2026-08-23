// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ComposerReferenceChips from "@/components/chat/ComposerReferenceChips";

describe("ComposerReferenceChips", () => {
  it("names both reference kinds when skills and plugins are present", () => {
    render(
      <ComposerReferenceChips
        skills={[{ id: "skill", title: "Planner" }]}
        plugins={[{ id: "plugin", title: "Weather" }]}
        onRemoveSkill={vi.fn()}
        onRemovePlugin={vi.fn()}
        skillsLabel="Forced skills"
        pluginsLabel="Forced plugins"
        removeSkillLabel={(title) => `Remove skill ${title}`}
        removePluginLabel={(title) => `Remove plugin ${title}`}
      />,
    );

    expect(
      screen.getByRole("list", {
        name: "Forced skills, Forced plugins",
      }),
    ).toBeTruthy();
  });
});
