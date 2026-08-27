// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listWorkspace: vi.fn(),
  listSessionArtifacts: vi.fn(),
  publishWorkspaceArtifact: vi.fn(),
  restoreWorkspaceFile: vi.fn(),
  trashWorkspaceFile: vi.fn(),
  resolveOPFSBlob: vi.fn(),
}));

vi.mock("@/services/workspace/sessionWorkspace", () => ({
  listWorkspace: mocks.listWorkspace,
}));
vi.mock("@/services/workspace/sessionArtifact", () => ({
  listSessionArtifacts: mocks.listSessionArtifacts,
  publishWorkspaceArtifact: mocks.publishWorkspaceArtifact,
}));
vi.mock("@/services/workspace/workspaceTrash", () => ({
  restoreWorkspaceFile: mocks.restoreWorkspaceFile,
  trashWorkspaceFile: mocks.trashWorkspaceFile,
}));
vi.mock("@/utils/opfs", () => ({
  resolveOPFSBlob: mocks.resolveOPFSBlob,
}));

import AgentArtifactWorkspace from "@/components/agent/AgentArtifactDrawer";
import messages from "@/i18n/locales/en/Content.json";

const usage = {
  fileCount: 3,
  totalBytes: 42,
  maxFiles: 100,
  maxTotalBytes: 10_000,
  trashedFileCount: 1,
};

const scratchFiles = [
  {
    path: "notes.txt",
    url: "opfs://scratch/notes.txt",
    fileName: "notes.txt",
    mimeType: "text/plain",
    bytes: 15,
    contentHash: "sha256:scratch",
    revision: "sha256:scratch-revision",
    updatedAt: 1_700_000_000_000,
    source: "agent" as const,
  },
  {
    path: "image.png",
    url: "opfs://scratch/image.png",
    fileName: "image.png",
    mimeType: "image/png",
    bytes: 20,
    contentHash: "sha256:image",
    revision: "sha256:image-revision",
    updatedAt: 1_700_000_000_000,
    source: "attachment" as const,
  },
];

const trashFiles = [
  {
    path: "trash/0192f0a1-1111-7000-8000-abcdefabcdef-old.txt",
    url: "opfs://scratch/trash/old.txt",
    fileName: "old.txt",
    mimeType: "text/plain",
    bytes: 7,
    contentHash: "sha256:trash",
    revision: "sha256:trash-revision",
    updatedAt: 1_700_000_000_000,
    source: "agent" as const,
  },
];

const artifacts = [
  {
    fileName: "published.txt",
    mimeType: "text/plain",
    bytes: 17,
    contentHash: "sha256:published",
    revision: "sha256:published",
    url: "opfs://artifacts/published.txt",
  },
];

function renderWorkspace() {
  render(
    <NextIntlClientProvider locale="en" messages={{ Content: messages }}>
      <AgentArtifactWorkspace active sessionId="session-1" />
    </NextIntlClientProvider>,
  );
}

describe("Agent Artifact workspace", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.listWorkspace.mockImplementation(
      async (_sessionId: string, prefix?: string) => ({
        ok: true,
        value: {
          files: prefix === "trash" ? trashFiles : scratchFiles,
          usage,
          truncated: false,
        },
      }),
    );
    mocks.listSessionArtifacts.mockResolvedValue({
      ok: true,
      value: artifacts,
    });
    mocks.resolveOPFSBlob.mockImplementation(async (url: string) => {
      if (url.includes("notes.txt")) return new Blob(["scratch preview"]);
      if (url.includes("published.txt")) {
        return new Blob(["published preview"]);
      }
      return null;
    });
  });

  afterEach(cleanup);

  it("previews one scratch or published text file at a time", async () => {
    renderWorkspace();
    await screen.findByText("notes.txt");

    await userEvent.click(
      screen.getByRole("button", { name: "Preview notes.txt" }),
    );
    expect(await screen.findByText("scratch preview")).toBeTruthy();

    await userEvent.click(
      screen.getByRole("tab", { name: /Immutable published/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Preview published.txt" }),
    );
    expect(await screen.findByText("published preview")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText("scratch preview")).toBeNull();
    });
  });

  it("does not offer content preview for binary files or trash", async () => {
    renderWorkspace();
    await screen.findByText("image.png");

    expect(
      screen.queryByRole("button", { name: "Preview image.png" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Preview old.txt" }),
    ).toBeNull();
  });

  it("uses keyboard-operable tabs for the three file states", async () => {
    renderWorkspace();
    await screen.findByText("notes.txt");

    expect(screen.getByText("2 scratch files")).toBeTruthy();
    expect(screen.getByText("1 published")).toBeTruthy();
    const usageMeter = screen.getByRole("meter");
    expect(usageMeter.className).toContain("h-1.5");
    expect(usageMeter.className).not.toContain("w-14");

    const scratchTab = screen.getByRole("tab", { name: /Mutable scratch/ });
    const publishedTab = screen.getByRole("tab", {
      name: /Immutable published/,
    });
    const trashTab = screen.getByRole("tab", {
      name: /Recoverable trash/,
    });

    expect(scratchTab.getAttribute("aria-selected")).toBe("true");
    expect(
      screen.getByRole("tabpanel", { name: /Mutable scratch/ }),
    ).toBeTruthy();
    const listContainer = screen.getByRole("tabpanel", {
      name: /Mutable scratch/,
    }).parentElement?.parentElement;
    expect(listContainer?.className).toContain("max-h-[min(52dvh,32rem)]");
    expect(listContainer?.className).toContain("overflow-y-auto");
    expect(
      screen.queryByRole("button", { name: "Preview published.txt" }),
    ).toBeNull();

    scratchTab.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(publishedTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(publishedTab);
    const previewButton = screen.getByRole("button", {
      name: "Preview published.txt",
    });
    expect(previewButton.className).toContain("h-8 w-8");

    await userEvent.click(trashTab);
    expect(
      screen.getByRole("button", { name: "Restore old.txt" }),
    ).toBeTruthy();
  });

  it("marks published diffs ambiguous when scratch names collide", async () => {
    mocks.listWorkspace.mockImplementation(
      async (_sessionId: string, prefix?: string) => ({
        ok: true,
        value: {
          files:
            prefix === "trash"
              ? []
              : [
                  {
                    ...scratchFiles[0],
                    path: "one/report.txt",
                    fileName: "report.txt",
                  },
                  {
                    ...scratchFiles[0],
                    path: "two/report.txt",
                    fileName: "report.txt",
                  },
                ],
          usage,
          truncated: false,
        },
      }),
    );
    mocks.listSessionArtifacts.mockResolvedValue({
      ok: true,
      value: [{ ...artifacts[0], fileName: "report.txt" }],
    });

    renderWorkspace();
    await userEvent.click(
      await screen.findByRole("tab", { name: /Immutable published/ }),
    );

    expect(
      await screen.findByText(
        "Multiple scratch files share this name, so the diff source cannot be selected automatically.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "Compare published report.txt with scratch",
      }),
    ).toBeNull();
  });
});
