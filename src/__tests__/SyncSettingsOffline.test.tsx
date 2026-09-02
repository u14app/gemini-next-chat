/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import syncMessages from "@/i18n/locales/en/Sync.json";

const storageHealthMocks = vi.hoisted(() => ({
  inspectLocalStorageHealth: vi.fn(),
}));

vi.mock("@/lib/data/storageHealth", () => ({
  inspectLocalStorageHealth: storageHealthMocks.inspectLocalStorageHealth,
}));

const syncState = vi.hoisted(() => ({
  enabled: true,
  provider: {
    kind: "webdav" as const,
    baseUrl: "https://dav.example.com",
    rootPath: "neo-chat",
  },
  credentialSecret: { version: 1 },
  rootKeySecret: { version: 1 },
  vaultId: "vault-1",
  status: "idle" as const,
  connectionTestStatus: "idle" as "idle" | "testing" | "success" | "error",
  connectionTestError: undefined as string | undefined,
  lastSyncAt: undefined,
  lastSyncBytes: 0,
  activeController: undefined,
  requiresReload: false,
  error: undefined,
  deviceName: "Test device",
  devices: [],
  conflicts: [
    {
      id: "settings:theme",
      documentId: "settings",
      path: ["theme"],
      currentValue: "light",
      values: ["light", "dark"],
    },
  ],
  configureProvider: vi.fn(),
  testConnection: vi.fn(),
  createRecoveryCode: vi.fn(),
  createNewVault: vi.fn(),
  initializeVault: vi.fn(),
  syncNow: vi.fn(),
  cancelSync: vi.fn(),
  setDeviceName: vi.fn(),
  resolveConflict: vi.fn(),
  disableSync: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

vi.mock("@/store/core/syncStore", () => ({
  useSyncStore: () => syncState,
}));

import SyncSettings from "@/components/settings/SyncSettings";

beforeEach(() => {
  vi.clearAllMocks();
  syncState.connectionTestStatus = "idle";
  syncState.connectionTestError = undefined;
  storageHealthMocks.inspectLocalStorageHealth.mockResolvedValue({
    quota: {
      usage: 1024 * 1024,
      quota: 4 * 1024 * 1024,
    },
    opfs: {
      referencedCount: 3,
      storedCount: 4,
      orphanCount: 2,
      missingCount: 1,
    },
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

describe("SyncSettings offline boundary", () => {
  it("explains and disables sync mutations while offline", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    render(
      <NextIntlClientProvider locale="en" messages={{ Sync: syncMessages }}>
        <SyncSettings />
      </NextIntlClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(
        "You are offline",
      );
    });
    for (const name of [
      "Sync now",
      "Save provider",
      "Test connection",
      "Create a new vault",
      "Import and enable vault",
      'Use "light"',
    ]) {
      expect(
        screen.getByRole("button", { name }).hasAttribute("disabled"),
      ).toBe(true);
    }
    expect(
      screen.getByRole("radio", { name: "WebDAV" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("textbox", { name: "This device name" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("renders handled errors from sync setup operations", async () => {
    syncState.configureProvider.mockRejectedValueOnce(
      new Error("Provider could not be saved."),
    );
    render(
      <NextIntlClientProvider locale="en" messages={{ Sync: syncMessages }}>
        <SyncSettings />
      </NextIntlClientProvider>,
    );

    const saveButton = screen.getByRole("button", { name: "Save provider" });
    await waitFor(() =>
      expect(saveButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Provider could not be saved.",
      );
    });
  });

  it("shows connection-test success inline with a live status", async () => {
    syncState.testConnection.mockImplementationOnce(async () => {
      syncState.connectionTestStatus = "success";
      syncState.connectionTestError = undefined;
    });
    render(
      <NextIntlClientProvider locale="en" messages={{ Sync: syncMessages }}>
        <SyncSettings />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => {
      expect(screen.getByText("Connection successful.")).toBeTruthy();
    });
    expect(
      screen.getByText("Connection successful.").closest('[role="status"]'),
    ).toBeTruthy();
  });

  it("shows a loading status while the connection test is running", async () => {
    const pending = deferred<void>();
    syncState.testConnection.mockImplementationOnce(() => {
      syncState.connectionTestStatus = "testing";
      return pending.promise;
    });
    render(
      <NextIntlClientProvider locale="en" messages={{ Sync: syncMessages }}>
        <SyncSettings />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => {
      expect(screen.getByText("Testing connection…")).toBeTruthy();
    });
    expect(
      screen
        .getByRole("button", { name: "Test connection" })
        .hasAttribute("disabled"),
    ).toBe(true);

    syncState.connectionTestStatus = "success";
    pending.resolve();
    await waitFor(() => {
      expect(screen.getByText("Connection successful.")).toBeTruthy();
    });
  });

  it("shows connection-test failures beside the provider controls", async () => {
    syncState.testConnection.mockImplementationOnce(async () => {
      syncState.connectionTestStatus = "error";
      syncState.connectionTestError = "Remote endpoint rejected the request.";
      throw new Error("Remote endpoint rejected the request.");
    });
    render(
      <NextIntlClientProvider locale="en" messages={{ Sync: syncMessages }}>
        <SyncSettings />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Connection test failed: Remote endpoint rejected the request.",
        ),
      ).toBeTruthy();
    });
    expect(
      screen
        .getByText(
          "Connection test failed: Remote endpoint rejected the request.",
        )
        .closest('[role="alert"]'),
    ).toBeTruthy();
  });

  it("invalidates a connection result when the provider draft changes", async () => {
    syncState.connectionTestStatus = "success";
    render(
      <NextIntlClientProvider locale="en" messages={{ Sync: syncMessages }}>
        <SyncSettings />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("Connection successful.")).toBeTruthy();
    const endpoint = await screen.findByDisplayValue("https://dav.example.com");
    fireEvent.change(endpoint, {
      target: { value: "https://other.example.com" },
    });

    expect(screen.queryByText("Connection successful.")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Test connection" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("shows read-only local health and truthful unavailable capabilities", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ Sync: syncMessages }}>
        <SyncSettings />
      </NextIntlClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("1.0 MB of 4.0 MB")).toBeTruthy();
    });
    expect(screen.getByText("Backup freshness")).toBeTruthy();
    expect(
      screen.getByText(/backup creation time is not persisted/i),
    ).toBeTruthy();
    expect(
      screen.getByText(/cannot yet be revoked individually/i),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Open backup settings" })
        .getAttribute("href"),
    ).toBe("?panel=settings&settingsTab=system");
  });
});
