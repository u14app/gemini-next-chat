import { describe, expect, it } from "vitest";
import { createAppExportPayload } from "@/lib/data/appExport";
import {
  assembleSyncDocuments,
  splitAppExportIntoSyncDocuments,
} from "@/lib/sync/snapshot";
import type { SyncDocumentDescriptor } from "@/lib/sync/types";

describe("shortcut data portability", () => {
  it("keeps shortcut preferences in backups and the encrypted core-settings sync document", () => {
    const shortcutBindings = {
      globalSearch: {
        code: "KeyP",
        mod: true,
        alt: false,
        shift: true,
      },
      newChat: null,
      focusComposer: {
        code: "Slash",
        mod: true,
        alt: false,
        shift: false,
      },
      cycleChatMode: {
        code: "KeyM",
        mod: true,
        alt: false,
        shift: false,
      },
      toggleSidebar: {
        code: "Backslash",
        mod: true,
        alt: false,
        shift: false,
      },
      openShortcutSettings: {
        code: "KeyS",
        mod: true,
        alt: true,
        shift: false,
      },
      stopGeneration: {
        code: "Period",
        mod: true,
        alt: true,
        shift: false,
      },
    };
    const coreSettings = {
      state: {
        shortcutBindings,
        providers: [
          {
            id: "provider-1",
            apiKey: "plain-secret",
            apiKeySecret: {
              version: 1,
              keyId: "key",
              iv: "iv",
              ciphertext: "ciphertext",
              context: "provider",
            },
          },
        ],
      },
      version: 6,
    };
    const exported = createAppExportPayload({
      exportedAt: "2026-08-01T00:00:00.000Z",
      coreSettings,
    });

    expect(exported.data.coreSettings).toMatchObject({
      state: { shortcutBindings },
      version: 6,
    });
    expect(JSON.stringify(exported.data.coreSettings)).not.toContain(
      "plain-secret",
    );
    expect(JSON.stringify(exported.data.coreSettings)).not.toContain(
      "ciphertext",
    );

    const documents = splitAppExportIntoSyncDocuments(exported);
    const coreSettingsDocument = documents.find(
      (document) => document.id === "core-settings",
    );

    expect(coreSettingsDocument).toMatchObject({
      kind: "core-settings",
      payload: { state: { shortcutBindings }, version: 6 },
    });

    const materialized = new Map(
      documents.map((document) => [
        document.id,
        {
          descriptor: {
            id: document.id,
            kind: document.kind,
            updatedAt: exported.exportedAt,
          } satisfies SyncDocumentDescriptor,
          payload: document.payload,
        },
      ]),
    );

    expect(assembleSyncDocuments(materialized).coreSettings).toMatchObject({
      state: { shortcutBindings },
      version: 6,
    });
  });
});
