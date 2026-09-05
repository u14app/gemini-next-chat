// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShareDialog from "@/components/sharing/ShareDialog";
import SharedConversationPage, {
  SharedConversationView,
} from "@/components/sharing/SharedConversationPage";
import Sharing from "@/i18n/locales/en/Sharing.json";
import Common from "@/i18n/locales/en/Common.json";
import type { MarkdownRendererProps } from "@/components/content/MarkdownRenderer";
import type { PublicShare, ShareMetadata } from "@/lib/sharing/types";

const mock = vi.hoisted(() => ({
  get: vi.fn(),
  publish: vi.fn(),
  revoke: vi.fn(),
  publicGet: vi.fn(),
  prepare: vi.fn(),
  renderer: vi.fn(),
  preview: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/services/sharing/client", () => ({
  getSessionShare: mock.get,
  publishSessionShare: mock.publish,
  revokeSessionShare: mock.revoke,
  getPublicShare: mock.publicGet,
}));
vi.mock("@/services/sharing/public", () => ({
  getPublicShare: mock.publicGet,
}));
vi.mock("@/services/sharing/snapshot", () => ({
  prepareSessionShare: mock.prepare,
}));
vi.mock("@/components/chat/sessionPresentation", () => ({
  readSessionForPresentation: mock.read,
}));
vi.mock("@/store/core/chatStore", () => ({
  useChatStore: {
    getState: () => ({
      sessions: [
        {
          id: "session",
          title: "Chat",
          model: "model",
          messageCount: 1,
          updatedAt: 1,
        },
      ],
    }),
  },
}));
vi.mock("@/store/core/uiStore", () => ({
  useUIStore: Object.assign(
    (selector: (state: { imagePreview: { isOpen: boolean } }) => unknown) =>
      selector({ imagePreview: { isOpen: false } }),
    { getState: () => ({ openImagePreview: mock.preview }) },
  ),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/content/MarkdownRenderer", () => ({
  default: (props: MarkdownRendererProps) => {
    mock.renderer(props);
    return <div>{props.content}</div>;
  },
}));

const metadata: ShareMetadata = {
  id: "A".repeat(43),
  createdAt: 1,
  updatedAt: 1,
  revision: 1,
  expiresAt: null,
};
const prepared = {
  snapshot: { schemaVersion: 1, title: "Chat", createdAt: 1, messages: [] },
  assets: [],
};
const withLocale = (children: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={{ Sharing, Common }}>
    {children}
  </NextIntlClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  mock.get.mockResolvedValue(null);
  mock.publish.mockResolvedValue(metadata);
  mock.revoke.mockResolvedValue(undefined);
  mock.prepare.mockResolvedValue(prepared);
  mock.read.mockResolvedValue({ id: "session", messages: [] });
});
afterEach(cleanup);

describe("share dialog", () => {
  it("publishes only on request and defaults to one day", async () => {
    render(withLocale(<ShareDialog sessionId="session" onClose={vi.fn()} />));
    const create = await screen.findByRole("button", { name: "Create link" });
    expect(mock.publish).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox")).toBeNull();
    const expiry = screen.getByRole("group", { name: "Expires after" });
    expect(
      within(expiry).getByRole("button", { name: "1 day", pressed: true }),
    ).toBeTruthy();
    expect(within(expiry).getAllByRole("button")).toHaveLength(4);
    fireEvent.click(create);
    await waitFor(() =>
      expect(mock.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session",
          expiresIn: "1d",
          ...prepared,
        }),
      ),
    );
    expect(
      await screen.findByRole("textbox", { name: "Share link" }),
    ).toHaveProperty("value", expect.stringContaining(`/share/${metadata.id}`));
  });

  it("keeps expiry on content updates and changes it only when selected", async () => {
    mock.get.mockResolvedValue(metadata);
    render(withLocale(<ShareDialog sessionId="session" onClose={vi.fn()} />));
    fireEvent.click(
      await screen.findByRole("button", { name: "Update snapshot" }),
    );
    await waitFor(() => expect(mock.publish).toHaveBeenCalledTimes(1));
    expect(mock.publish.mock.calls[0][0]).not.toHaveProperty("expiresIn");
    await screen.findByRole("button", { name: "Update snapshot" });
    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(
      screen.getByRole("button", { name: "7 days", pressed: true }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update snapshot" }));
    await waitFor(() => expect(mock.publish).toHaveBeenCalledTimes(2));
    expect(mock.publish.mock.calls[1][0]).toHaveProperty("expiresIn", "7d");
  });

  it("can return to keeping the current expiry before updating", async () => {
    mock.get.mockResolvedValue(metadata);
    render(withLocale(<ShareDialog sessionId="session" onClose={vi.fn()} />));
    const keep = await screen.findByRole("button", {
      name: "Keep current expiry",
      pressed: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "30 days" }));
    fireEvent.click(keep);
    fireEvent.click(screen.getByRole("button", { name: "Update snapshot" }));
    await waitFor(() => expect(mock.publish).toHaveBeenCalledTimes(1));
    expect(mock.publish.mock.calls[0][0]).not.toHaveProperty("expiresIn");
  });

  it("disables expiry choices during loading and publishing", async () => {
    let finishLoad!: (value: null) => void;
    mock.get.mockReturnValue(new Promise((resolve) => (finishLoad = resolve)));
    render(withLocale(<ShareDialog sessionId="session" onClose={vi.fn()} />));
    const expiry = screen.getByRole("group", { name: "Expires after" });
    const choices = within(expiry).getAllByRole("button");
    choices.forEach((button) =>
      expect(button).toHaveProperty("disabled", true),
    );
    finishLoad(null);
    await waitFor(() =>
      choices.forEach((button) =>
        expect(button).toHaveProperty("disabled", false),
      ),
    );
    mock.publish.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "Create link" }));
    choices.forEach((button) =>
      expect(button).toHaveProperty("disabled", true),
    );
  });

  it("keeps a usable link visible after revocation fails", async () => {
    mock.get.mockResolvedValue(metadata);
    mock.revoke.mockRejectedValue(new Error("offline"));
    render(withLocale(<ShareDialog sessionId="session" onClose={vi.fn()} />));
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel sharing" }),
    );
    await screen.findByRole("alert");
    expect(screen.getByRole("textbox", { name: "Share link" })).toHaveProperty(
      "value",
      expect.stringContaining(metadata.id),
    );
  });
});

describe("public share reader", () => {
  it("opens attachment images with explicit same-origin registration", () => {
    const assetId = "a".repeat(64);
    const share: PublicShare = {
      ...metadata,
      snapshot: {
        schemaVersion: 1,
        title: "Chat",
        createdAt: 1,
        messages: [
          {
            id: "m",
            role: "model",
            timestamp: 1,
            blocks: [{ type: "image", assetId, alt: "A photo" }],
          },
        ],
      },
    };
    render(withLocale(<SharedConversationView share={share} />));
    fireEvent.click(screen.getByRole("button", { name: "A photo" }));
    const url = new URL(
      `/api/shares/${metadata.id}/assets/${assetId}?revision=1`,
      window.location.origin,
    ).toString();
    expect(mock.preview).toHaveBeenCalledWith(
      [{ url, alt: "A photo", description: "A photo" }],
      0,
      [url],
    );
  });

  it("passes registered images to the read-only renderer without rewriting source literals", () => {
    const marker = `share-asset:${"a".repeat(64)}`;
    const content = `![Photo](${marker})\n\n\`${marker}\``;
    const share: PublicShare = {
      ...metadata,
      snapshot: {
        schemaVersion: 1,
        title: "Public title",
        createdAt: 1,
        messages: [
          {
            id: "message",
            role: "model",
            timestamp: 1,
            blocks: [
              { type: "text", content },
              { type: "attachment", fileName: "notes.pdf" },
            ],
          },
        ],
      },
    };
    render(withLocale(<SharedConversationView share={share} />));
    expect(mock.renderer).toHaveBeenCalledWith(
      expect.objectContaining({
        content,
        readOnly: true,
        imageUrlAliases: {
          [marker]: expect.stringContaining(
            `/api/shares/${metadata.id}/assets/`,
          ),
        },
      }),
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("link", { name: "notes.pdf" })).toBeNull();
    expect(screen.getByText("Name only")).toBeTruthy();
  });

  it("shows an invalid-link state without restoring any conversation", async () => {
    mock.publicGet.mockRejectedValue(
      Object.assign(new Error("gone"), { status: 410 }),
    );
    render(withLocale(<SharedConversationPage shareId={metadata.id} />));
    await screen.findByRole("heading", {
      name: "This share is no longer available",
    });
    expect(mock.renderer).not.toHaveBeenCalled();
    expect(mock.publicGet).toHaveBeenCalledWith(
      metadata.id,
      expect.any(AbortSignal),
    );
  });

  it("revalidates a restored history page so revoked content is removed", async () => {
    mock.publicGet.mockResolvedValueOnce({
      ...metadata,
      snapshot: prepared.snapshot,
    });
    render(withLocale(<SharedConversationPage shareId={metadata.id} />));
    await screen.findByRole("heading", { name: "Chat" });
    mock.publicGet.mockRejectedValueOnce(
      Object.assign(new Error("revoked"), { status: 404 }),
    );
    const event = new Event("pageshow");
    Object.defineProperty(event, "persisted", { value: true });
    fireEvent(window, event);
    await screen.findByRole("heading", {
      name: "This share is no longer available",
    });
    expect(mock.publicGet).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("heading", { name: "Chat" })).toBeNull();
  });
});
