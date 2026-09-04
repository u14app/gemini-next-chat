// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import commonMessages from "@/i18n/locales/en/Common.json";
import ResearchTemplatePicker from "@/components/research/ResearchTemplatePicker";
import type { UseResearchTemplatesResult } from "@/hooks/research/useResearchTemplates";
import type { ResearchTemplate } from "@/lib/research/templates";

afterEach(cleanup);

const labels = {
  title: "Research template",
  description: "Choose a template.",
  inherit: "Inherit",
  disabled: "No template",
  loading: "Loading",
  unavailable: "Unavailable",
  duplicate: "Duplicate",
  remove: "Delete",
  builtIn: "Built-in",
  custom: "Custom",
  selectAria: "Research template",
  duplicateAria: "Duplicate selected research template",
  removeAria: "Delete selected research template",
  newTemplate: "New template",
  editTemplate: "Edit template",
  editAria: "Edit selected research template",
  snapshot: "Saved snapshot",
  preview: "Template preview",
  deliverable: "Deliverable",
  sections: "Required sections",
  sources: "Source priorities",
  strategy: "Starting strategy",
};

function makeTemplate(overrides: Partial<ResearchTemplate> = {}) {
  return {
    schemaVersion: 1,
    id: "internal-review",
    name: "Current template",
    description: "Current description",
    deliverableKind: "decision_memo",
    requiredSections: ["Current heading"],
    sourcePriorities: [{ sourceType: "web", priority: "high" }],
    strategy: {
      initialBreadth: 4,
      maxDepth: 2,
      maxQueries: 16,
      resultsPerQuery: 5,
    },
    revision: 2,
    ...overrides,
  } satisfies ResearchTemplate;
}

function makeApi(templates: ResearchTemplate[]): UseResearchTemplatesResult {
  const fallback = makeTemplate();
  return {
    templates,
    isLoading: false,
    error: null,
    refresh: vi.fn(async () => undefined),
    create: vi.fn(async () => fallback),
    update: vi.fn(async () => fallback),
    duplicate: vi.fn(async () => fallback),
    remove: vi.fn(async () => undefined),
    saveFromPlan: vi.fn(async () => fallback),
    get: vi.fn(async () => fallback),
  };
}

function renderPicker(
  selection: ResearchTemplate | null | undefined,
  templates: ResearchTemplate[],
) {
  const onChange = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ Common: commonMessages }}>
      <ResearchTemplatePicker
        selection={selection}
        onChange={onChange}
        labels={labels}
        templatesApi={makeApi(templates)}
      />
    </NextIntlClientProvider>,
  );
  return onChange;
}

describe("ResearchTemplatePicker", () => {
  it("previews the selected profile snapshot even when the library has a newer revision", () => {
    const current = makeTemplate();
    const snapshot = makeTemplate({
      name: "Archived template",
      description: "Archived description",
      requiredSections: ["Archived heading"],
      revision: 1,
    });

    renderPicker(snapshot, [current]);

    expect(screen.getByText("Archived heading")).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Research template" }).textContent,
    ).toContain("Archived template");
    expect(screen.getByText("Saved snapshot")).toBeTruthy();
  });

  it("keeps a deleted selected snapshot available for explicit recovery", async () => {
    const snapshot = makeTemplate({
      name: "Deleted template",
      revision: 4,
      requiredSections: ["Deleted heading"],
    });

    renderPicker(snapshot, []);
    await userEvent.click(
      screen.getByRole("combobox", { name: "Research template" }),
    );

    expect(
      screen.getByRole("option", { name: "Deleted template" }),
    ).toBeTruthy();
    expect(screen.getByText("Deleted heading")).toBeTruthy();
  });

  it("mounts the complete editor without native select elements", async () => {
    renderPicker(undefined, []);
    await userEvent.click(screen.getByRole("button", { name: "New template" }));

    expect(screen.getByText("Template details")).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Deliverable type" }),
    ).toBeTruthy();
    expect(document.querySelector("select")).toBeNull();
  });
});
