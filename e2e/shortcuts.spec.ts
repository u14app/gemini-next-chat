import { expect, test, type Page } from "@playwright/test";

const STORAGE_VERSION = 6;

function persistedState(state: Record<string, unknown>) {
  return JSON.stringify({ state, version: STORAGE_VERSION });
}

async function setIndexedDbValue(page: Page, key: string, value: unknown) {
  await page.evaluate(
    async ({ key, value }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("neo-chat");
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("app_data")) {
            request.result.createObjectStore("app_data");
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("app_data", "readwrite");
        transaction.objectStore("app_data").put(value, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
    { key, value },
  );
}

async function getIndexedDbValue(page: Page, key: string) {
  return page.evaluate(async (storageKey) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("neo-chat");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction("app_data", "readonly");
      const request = transaction.objectStore("app_data").get(storageKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return value;
  }, key);
}

async function seedShortcutChat(page: Page) {
  const sessionId = "shortcut-e2e-session";
  await page.goto("/manifest.webmanifest");
  await page.evaluate(
    (value) => localStorage.setItem("neo-chat-core-settings", value),
    persistedState({
      theme: "light",
      language: "en",
      providers: [
        {
          id: "shortcut-provider",
          name: "Shortcut Provider",
          type: "OpenAI Compatible",
          baseUrl: "https://shortcut.example.test/v1",
          apiKey: "",
          enabled: true,
          models: ["shortcut-model"],
          modelsList: ["shortcut-model"],
        },
      ],
      defaultModels: {},
    }),
  );
  await setIndexedDbValue(
    page,
    "neo-chat-settings",
    persistedState({
      system: {
        enableAutoTitle: false,
        enableRelatedQuestions: false,
        enableAutoCompression: false,
      },
      customModelMetadata: {
        "shortcut-model": {
          id: "shortcut-model",
          name: "Shortcut Model",
        },
      },
    }),
  );
  await setIndexedDbValue(
    page,
    "neo-chat-storage",
    persistedState({
      sessions: [
        {
          id: sessionId,
          title: "Shortcut fixture",
          messageCount: 0,
          updatedAt: Date.now(),
          model: "shortcut-provider:shortcut-model",
        },
      ],
      workspaces: [],
      selectedModel: "shortcut-provider:shortcut-model",
      chatConfig: {
        useSearch: false,
        useReasoning: false,
        reasoningMode: "off",
        useRAG: false,
        temperature: 1,
      },
    }),
  );
  await setIndexedDbValue(page, `session_messages_${sessionId}`, {
    nodesById: {},
    rootMessageIds: [],
  });
}

async function openShortcutChat(page: Page) {
  await page.goto("/");

  const session = page.getByRole("button", {
    name: "Shortcut fixture",
    exact: true,
  });
  await expect(session).toBeVisible();
  await session.click();
  await expect(session).toHaveAttribute("aria-current", "page");
  await expect(page.locator('textarea[name="message"]')).toBeEnabled();
}

async function pressToggleSidebar(page: Page) {
  await page.keyboard.down("Control");
  await page.keyboard.press("\\");
  await page.keyboard.up("Control");
}

test("dispatches all default shortcuts and preserves dialog priority", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedShortcutChat(page);
  await openShortcutChat(page);

  const composer = page.locator('textarea[name="message"]');
  const sidebar = page.locator('[role="dialog"], .glass-shell').first();
  const searchButton = page.getByRole("button", { name: "Open search" });
  await expect(composer).toBeEnabled();
  await expect(searchButton).toHaveAttribute("aria-keyshortcuts", /K$/);

  await page.keyboard.press("Control+k");
  await expect(page).toHaveURL(/(?:\?|&)panel=search(?:&|$)/);
  await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();

  await page.keyboard.press("Control+Alt+n");
  await expect(page).toHaveURL(/(?:\?|&)panel=search(?:&|$)/);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Shortcut fixture", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  await expect(sidebar).toHaveCSS("width", "288px");
  await pressToggleSidebar(page);
  await expect(sidebar).toHaveCSS("width", "64px");

  await page.keyboard.press("Control+Alt+n");
  await pressToggleSidebar(page);
  await expect(sidebar).toHaveCSS("width", "288px");
  await expect(
    page.locator('button[aria-current="page"]').filter({ hasText: "New Chat" }),
  ).toBeVisible();

  await page.keyboard.press("Control+Alt+s");
  await expect(page).toHaveURL(/settingsTab=shortcuts/);
  await expect(
    page.getByRole("heading", { name: "Keyboard shortcuts" }),
  ).toBeVisible();

  await page.keyboard.press("Control+/");
  await expect(page).not.toHaveURL(/(?:\?|&)panel=/);
  await expect(composer).toBeFocused();
  await expect(composer).toHaveAttribute("aria-keyshortcuts", /\/$/);
});

test("records conflicts and keeps custom bindings after reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedShortcutChat(page);
  await openShortcutChat(page);
  await page.keyboard.press("Control+Alt+s");
  await expect(
    page.getByRole("heading", { name: "Keyboard shortcuts" }),
  ).toBeVisible();

  const recordSearch = page.getByRole("button", {
    name: "Record a shortcut for Global search",
  });
  await recordSearch.click();
  await page.keyboard.press("Control+Alt+p");

  const recordComposer = page.getByRole("button", {
    name: "Record a shortcut for Focus message input",
  });
  await recordComposer.click();
  await page.keyboard.press("Control+Alt+p");
  await expect(page.locator('p[role="alert"]')).toContainText(
    "already assigned to Global search",
  );
  await page.keyboard.press("Escape");

  const recordNewChat = page.getByRole("button", {
    name: "Record a shortcut for New chat",
  });
  await recordNewChat.click();
  await page.keyboard.press("j");

  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = localStorage.getItem("neo-chat-core-settings");
        if (!stored) return null;
        return JSON.parse(stored).state.shortcutBindings;
      }),
    )
    .toMatchObject({
      globalSearch: { code: "KeyP", mod: true, alt: true, shift: false },
      newChat: { code: "KeyJ", mod: false, alt: false, shift: false },
    });

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Keyboard shortcuts" }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page).toHaveURL(/settingsTab=shortcuts/);
  await page.keyboard.press("Control+Alt+p");
  await expect(page).toHaveURL(/(?:\?|&)panel=search(?:&|$)/);
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+/");
  const composer = page.locator('textarea[name="message"]');
  await expect(composer).toBeFocused();
  await page.keyboard.press("j");
  await expect(composer).toHaveValue("j");

  await composer.evaluate((element) => (element as HTMLElement).blur());
  await page.keyboard.press("j");
  await expect(
    page.locator('button[aria-current="page"]').filter({ hasText: "New Chat" }),
  ).toBeVisible();
  await expect(composer).toHaveValue("");
});

test("stops an active generation with the default shortcut", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    Object.defineProperty(window, "__closeShortcutStream", {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
    window.fetch = async (input, init) => {
      const requestUrl =
        typeof input === "string" || input instanceof URL
          ? String(input)
          : input.url;
      if (new URL(requestUrl, window.location.href).pathname !== "/api/chat") {
        return originalFetch(input, init);
      }

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          (
            window as typeof window & { __closeShortcutStream: () => void }
          ).__closeShortcutStream = () => {
            try {
              controller.close();
            } catch {
              // The app may already have closed the mocked response.
            }
          };
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "content", content: "Streaming" })}\n\n`,
            ),
          );
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };
  });
  await seedShortcutChat(page);
  await openShortcutChat(page);

  const composer = page.locator('textarea[name="message"]');
  await composer.fill("Keep streaming");
  await page.getByRole("button", { name: "Send message" }).click();
  const stopButton = page.getByRole("button", { name: "Stop generation" });
  await expect(stopButton).toBeVisible();
  await expect(stopButton).toHaveAttribute("aria-keyshortcuts", /Alt\+\.$/);
  // The stop control also appears during request setup. Wait for a real
  // streamed response before asserting interruption of an assistant message.
  await expect(page.getByText("Streaming", { exact: true })).toBeVisible();

  await page.keyboard.press("Control+Alt+.");
  await expect(stopButton).toHaveCount(0);
  await expect
    .poll(async () => {
      const stored = (await getIndexedDbValue(
        page,
        "session_messages_shortcut-e2e-session",
      )) as {
        nodesById?: Record<
          string,
          { message?: { role?: string; generation?: { status?: string } } }
        >;
      };
      return Object.values(stored?.nodesById || {}).find(
        (node) => node.message?.role === "model",
      )?.message?.generation?.status;
    })
    .toBe("interrupted");
  await page.evaluate(() =>
    (
      window as typeof window & { __closeShortcutStream: () => void }
    ).__closeShortcutStream(),
  );
});
