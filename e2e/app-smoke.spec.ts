import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

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

async function writeOpfsFile(page: Page, path: string, content: string) {
  await page.evaluate(
    async ({ path: filePath, content: fileContent }) => {
      const segments = filePath.split("/");
      const fileName = segments.pop();
      if (!fileName) throw new Error("An OPFS file name is required.");

      let directory = await navigator.storage.getDirectory();
      for (const segment of segments) {
        directory = await directory.getDirectoryHandle(segment, {
          create: true,
        });
      }
      const file = await directory.getFileHandle(fileName, { create: true });
      const writable = await file.createWritable();
      await writable.write(fileContent);
      await writable.close();
    },
    { path, content },
  );
}

async function readOpfsFile(page: Page, url: string) {
  return page.evaluate(async (opfsUrl) => {
    if (!opfsUrl.startsWith("opfs://")) return null;
    const segments = opfsUrl.slice("opfs://".length).split("/");
    const fileName = segments.pop();
    if (!fileName) return null;

    let directory = await navigator.storage.getDirectory();
    for (const segment of segments) {
      directory = await directory.getDirectoryHandle(segment);
    }
    const file = await directory.getFileHandle(fileName);
    return (await file.getFile()).text();
  }, url);
}

async function clearBrowserAppData(page: Page) {
  await page.evaluate(async () => {
    localStorage.clear();

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("neo-chat");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (database.objectStoreNames.contains("app_data")) {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("app_data", "readwrite");
        transaction.objectStore("app_data").clear();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    }
    database.close();

    const root =
      (await navigator.storage.getDirectory()) as FileSystemDirectoryHandle & {
        keys(): AsyncIterableIterator<string>;
      };
    for await (const entryName of root.keys()) {
      await root.removeEntry(entryName, { recursive: true });
    }
  });
}

function persistedState(state: Record<string, unknown>) {
  return JSON.stringify({ state, version: 6 });
}

function sseBody(events: unknown[]) {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

async function sendChatMessage(page: Page, text: string) {
  await page.locator('textarea[name="message"]').fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

async function openSearchWithKeyboard(page: Page) {
  await expect
    .poll(
      async () => {
        await page.keyboard.press("Control+k");
        return new URL(page.url()).searchParams.get("panel");
      },
      { timeout: 15_000 },
    )
    .toBe("search");
}

async function openPanel(page: Page, buttonName: string, panel: string) {
  const button = page.getByRole("button", { name: buttonName });
  await expect(button).toBeVisible();
  await expect
    .poll(
      async () => {
        await button.click();
        return new URL(page.url()).searchParams.get("panel");
      },
      { timeout: 15_000 },
    )
    .toBe(panel);
}

async function expectNoPageHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function attachCanvasImages(
  page: Page,
  images: Array<{
    name: string;
    width: number;
    height: number;
    patterned?: boolean;
  }>,
) {
  return page.evaluate(async (specs) => {
    const input = document.querySelector<HTMLInputElement>(
      'input[name="chat-images"]',
    );
    if (!input) throw new Error("Chat image input is unavailable.");

    const transfer = new DataTransfer();
    const sizes: Record<string, number> = {};

    for (const spec of specs) {
      const canvas = document.createElement("canvas");
      canvas.width = spec.width;
      canvas.height = spec.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D context is unavailable.");

      const gradient = context.createLinearGradient(
        0,
        0,
        spec.width,
        spec.height,
      );
      gradient.addColorStop(0, "#2563eb");
      gradient.addColorStop(0.5, "#22c55e");
      gradient.addColorStop(1, "#f59e0b");
      context.fillStyle = gradient;
      context.fillRect(0, 0, spec.width, spec.height);

      if (spec.patterned) {
        const block = 12;
        for (let y = 0; y < spec.height; y += block) {
          for (let x = 0; x < spec.width; x += block) {
            if ((x / block + y / block) % 3 !== 0) continue;
            context.fillStyle = `rgba(${(x * 13) % 255}, ${
              (y * 17) % 255
            }, ${(x + y) % 255}, 0.7)`;
            context.fillRect(x, y, block, block);
          }
        }
      }

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error("Canvas export failed.")),
          "image/jpeg",
          0.92,
        );
      });
      const file = new File([blob], spec.name, {
        type: "image/jpeg",
      });
      sizes[spec.name] = file.size;
      transfer.items.add(file);
    }

    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return sizes;
  }, images);
}

test("loads the local chat shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator('textarea[name="message"]')).toBeVisible();
});

test("loads the HEIC converter from the checked-in public script", async ({
  page,
}) => {
  await page.goto("/");
  await page.addScriptTag({ url: "/heic-to.min.js" });

  const exports = await page.evaluate(() => {
    const heicTo = Reflect.get(window, "HeicTo");
    return {
      heicTo: typeof heicTo,
      isHeic:
        typeof heicTo === "function"
          ? typeof Reflect.get(heicTo, "isHeic")
          : "undefined",
    };
  });

  expect(exports).toEqual({
    heicTo: "function",
    isHeic: "function",
  });
});

test("keeps an offline draft editable until connectivity returns", async ({
  page,
  context,
}) => {
  await page.goto("/manifest.webmanifest");
  const model = "offline-provider:offline-model";
  await page.evaluate(
    (value) => localStorage.setItem("neo-chat-core-settings", value),
    persistedState({
      theme: "light",
      language: "en",
      providers: [
        {
          id: "offline-provider",
          name: "Offline Provider",
          type: "OpenAI Compatible",
          baseUrl: "https://offline-model.example.test/v1",
          apiKey: "",
          enabled: true,
          models: ["offline-model"],
          modelsList: ["offline-model"],
        },
      ],
      defaultModels: {},
    }),
  );
  await setIndexedDbValue(
    page,
    "neo-chat-storage",
    persistedState({
      sessions: [],
      workspaces: [],
      currentSessionId: null,
      selectedModel: model,
      chatConfig: {},
    }),
  );

  await page.goto("/");
  const composer = page.locator('textarea[name="message"]');
  await expect(composer).toBeVisible();
  await expect(composer).toBeEnabled();
  await page.waitForLoadState("networkidle");

  await context.setOffline(true);
  await expect(page.getByText(/Offline draft/)).toBeVisible();
  await composer.fill("locally retained draft");
  await expect(composer).toHaveValue("locally retained draft");
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeDisabled();

  await context.setOffline(false);
  await expect(page.getByText(/Offline draft/)).toHaveCount(0);
  await expect(composer).toHaveValue("locally retained draft");
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeEnabled();
});

test("uses expanded desktop and collapsed pad sidebar defaults", async ({
  page,
}) => {
  const sidebar = page.locator(".glass-shell").first();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(sidebar).toHaveCSS("width", "288px");

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(sidebar).toHaveCSS("width", "64px");

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(sidebar).toHaveCSS("width", "288px");
});

test("gates Agent mode by tool support and isolates it per chat", async ({
  page,
}) => {
  const agentSessionId = "agent-mode-enabled-session";
  const legacySessionId = "agent-mode-legacy-session";
  const now = Date.now();

  await page.goto("/manifest.webmanifest");
  await page.evaluate(
    (value) => localStorage.setItem("neo-chat-core-settings", value),
    persistedState({
      theme: "light",
      language: "en",
      providers: [
        {
          id: "agent-provider",
          name: "Agent Provider",
          type: "OpenAI Compatible",
          baseUrl: "https://agent-model.example.test/v1",
          apiKey: "",
          enabled: true,
          models: ["tool-model", "plain-model"],
          modelsList: ["tool-model", "plain-model"],
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
        "tool-model": {
          id: "tool-model",
          name: "Tool Model",
          tool_call: true,
        },
        "plain-model": {
          id: "plain-model",
          name: "Plain Model",
          tool_call: false,
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
          id: agentSessionId,
          title: "Agent enabled chat",
          messageCount: 0,
          updatedAt: now,
          model: "agent-provider:tool-model",
          config: { useAgentMode: false },
        },
        {
          id: legacySessionId,
          title: "Legacy Agent chat",
          messageCount: 0,
          updatedAt: now - 1,
          model: "agent-provider:tool-model",
        },
      ],
      workspaces: [],
      currentSessionId: agentSessionId,
      selectedModel: "agent-provider:tool-model",
      chatConfig: {
        useSearch: false,
        useAgentMode: false,
        useReasoning: false,
        reasoningMode: "off",
        useRAG: false,
        temperature: 1,
      },
    }),
  );
  await setIndexedDbValue(page, `session_messages_${agentSessionId}`, {
    nodesById: {},
    rootMessageIds: [],
  });
  await setIndexedDbValue(page, `session_messages_${legacySessionId}`, {
    nodesById: {},
    rootMessageIds: [],
  });
  await setIndexedDbValue(
    page,
    "neo-chat-memory",
    persistedState({
      settings: {
        enabled: false,
        searchEnabled: false,
        autoRecordEnabled: false,
        dreamEnabled: false,
      },
      memories: [],
      dreamStatus: { isRunning: false },
    }),
  );

  await page.goto("/");
  const enabledSession = page.getByRole("button", {
    name: "Agent enabled chat",
    exact: true,
  });
  await enabledSession.click();
  await expect(enabledSession).toHaveAttribute("aria-current", "page");

  const enableAgentMode = page.getByRole("button", {
    name: "Mode: Auto",
  });
  await expect(enableAgentMode).toBeEnabled();
  await enableAgentMode.click();
  const agentModeOption = page
    .getByRole("group", { name: "Mode" })
    .getByRole("button", { name: /^Agent/ });
  await expect(agentModeOption).toBeEnabled();
  await agentModeOption.click();
  await expect(page.getByRole("button", { name: "Mode: Agent" })).toBeVisible();

  const legacySession = page.getByRole("button", {
    name: "Legacy Agent chat",
    exact: true,
  });
  await legacySession.click();
  await expect(legacySession).toHaveAttribute("aria-current", "page");
  await expect(page.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Mode: Auto" })).toBeVisible();

  await enabledSession.click();
  await expect(enabledSession).toHaveAttribute("aria-current", "page");
  await expect(page.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Mode: Agent" })).toBeVisible();

  await page.getByRole("button", { name: "Select model: Tool Model" }).click();
  await page.getByRole("menuitemradio", { name: "Use Plain Model" }).click();

  await page.getByRole("button", { name: "Mode: Agent" }).click();
  const unavailableAgentMode = page
    .getByRole("group", { name: "Mode" })
    .getByRole("button", { name: /^Agent/ });
  await expect(unavailableAgentMode).toBeDisabled();
});

test("keeps a 500-message chat timeline DOM bounded while scrolling", async ({
  page,
}) => {
  await page.goto("/manifest.webmanifest");
  const sessionId = "virtualized-500-message-fixture";
  const now = Date.now();
  const nodesById = Object.fromEntries(
    Array.from({ length: 500 }, (_, index) => {
      const id = `message-${index}`;
      const nextId = index < 499 ? `message-${index + 1}` : undefined;
      return [
        id,
        {
          id,
          message: {
            id,
            role: index % 2 === 0 ? "user" : "model",
            content: `Virtualized fixture message ${index}`,
            timestamp: now + index,
          },
          parentMessageId: index > 0 ? `message-${index - 1}` : undefined,
          childMessageIds: nextId ? [nextId] : [],
          activeChildMessageId: nextId,
        },
      ];
    }),
  );

  await setIndexedDbValue(
    page,
    "neo-chat-storage",
    persistedState({
      sessions: [
        {
          id: sessionId,
          title: "Virtualized 500 messages",
          messageCount: 500,
          updatedAt: now,
          model: "",
        },
      ],
      workspaces: [],
      currentSessionId: sessionId,
      selectedModel: "",
      chatConfig: {},
    }),
  );
  await setIndexedDbValue(page, `session_messages_${sessionId}`, {
    nodesById,
    rootMessageIds: ["message-0"],
  });

  await page.goto("/");
  const session = page.getByRole("button", {
    name: "Virtualized 500 messages",
    exact: true,
  });
  await session.click();
  await expect(session).toHaveAttribute("aria-current", "page");
  const timeline = page.getByTestId("virtualized-message-timeline");
  await expect(timeline).toBeVisible();
  const renderedRows = page.locator("[data-message-id]");
  await expect(renderedRows.first()).toBeVisible();
  expect(await renderedRows.count()).toBeLessThanOrEqual(50);

  const scroller = page.locator("[data-chat-scroll-container]");
  await scroller.evaluate((element) => element.scrollTo({ top: 0 }));
  await expect(page.locator('[data-message-id="message-0"]')).toBeVisible();
  expect(await renderedRows.count()).toBeLessThanOrEqual(50);
});

test("follows streamed output only when enabled and keeps manual scrolling stable", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.goto("/manifest.webmanifest");
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const releasedGates = new Set<string>();
    const gateWaiters = new Map<string, () => void>();
    const fixture = {
      phase: "idle",
      release(gate: string) {
        releasedGates.add(gate);
        gateWaiters.get(gate)?.();
        gateWaiters.delete(gate);
      },
    };
    Object.defineProperty(window, "__streamScrollFixture", {
      configurable: true,
      value: fixture,
    });

    const waitForGate = (gate: string) => {
      if (releasedGates.has(gate)) return Promise.resolve();
      return new Promise<void>((resolve) => gateWaiters.set(gate, resolve));
    };
    const wait = (durationMs: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, durationMs));

    window.fetch = async (input, init) => {
      const requestUrl =
        typeof input === "string" || input instanceof URL
          ? String(input)
          : input.url;
      const url = new URL(requestUrl, window.location.href);
      if (url.pathname !== "/api/chat") {
        return originalFetch(input, init);
      }

      const encoder = new TextEncoder();
      let cancelled = false;
      fixture.phase = "connected";
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const push = (event: unknown) => {
            if (cancelled) return;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          };

          void (async () => {
            try {
              push({
                type: "reasoning",
                content: "Initial reasoning fixture.",
              });
              fixture.phase = "reasoning-ready";
              await waitForGate("grow-reasoning");

              for (let index = 0; index < 10; index += 1) {
                push({
                  type: "reasoning",
                  content:
                    `\n\n### Reasoning segment ${index}\n` +
                    "Measured reasoning detail ".repeat(12),
                });
                await wait(30);
              }
              push({
                type: "reasoning",
                content: "\n\nreasoning-tail-marker",
              });
              fixture.phase = "reasoning-grown";
              await waitForGate("grow-content");

              push({
                type: "content",
                content: "\n\n```typescript\n",
              });
              for (let index = 0; index < 10; index += 1) {
                const lines = Array.from(
                  { length: 6 },
                  (_, lineIndex) =>
                    `const streamedValue${index}_${lineIndex} = "stable";`,
                ).join("\n");
                push({
                  type: "content",
                  content: `${lines}\n`,
                });
                await wait(30);
              }
              push({
                type: "content",
                content: "// content-tail-marker",
              });
              fixture.phase = "content-grown";
              await waitForGate("close-code");

              push({ type: "content", content: "\n```" });
              fixture.phase = "code-closed";
              await waitForGate("finish");

              push({ type: "done" });
              fixture.phase = "done";
              controller.close();
            } catch (error) {
              if (!cancelled) controller.error(error);
            }
          })();
        },
        cancel() {
          cancelled = true;
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };
  });

  await page.evaluate(
    (value) => {
      localStorage.setItem("neo-chat-core-settings", value);
    },
    persistedState({
      theme: "light",
      language: "en",
      providers: [
        {
          id: "scroll-provider",
          name: "Scroll Provider",
          type: "OpenAI Compatible",
          baseUrl: "https://model.example.test/v1",
          apiKey: "",
          enabled: true,
          models: ["scroll-model"],
          modelsList: ["scroll-model"],
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
        enableAutoScroll: true,
        enableAutoTitle: false,
        enableRelatedQuestions: false,
        enableAutoCompression: false,
        enableCodeCollapse: true,
      },
      customModelMetadata: {
        "scroll-model": {
          id: "scroll-model",
          name: "Scroll Model",
          reasoning: true,
        },
      },
    }),
  );

  const sessionId = "stream-scroll-session";
  const now = Date.now();
  const historyLength = 32;
  const nodesById = Object.fromEntries(
    Array.from({ length: historyLength }, (_, index) => {
      const id = `scroll-history-${index}`;
      const nextId =
        index < historyLength - 1 ? `scroll-history-${index + 1}` : undefined;
      return [
        id,
        {
          id,
          message: {
            id,
            role: index % 2 === 0 ? "user" : "model",
            content:
              `Scroll history fixture ${index}. ` +
              "A long archived message keeps the timeline overflow real. ".repeat(
                4,
              ),
            timestamp: now - historyLength + index,
          },
          parentMessageId:
            index > 0 ? `scroll-history-${index - 1}` : undefined,
          childMessageIds: nextId ? [nextId] : [],
          activeChildMessageId: nextId,
        },
      ];
    }),
  );
  await setIndexedDbValue(
    page,
    "neo-chat-storage",
    persistedState({
      sessions: [
        {
          id: sessionId,
          title: "Streaming scroll fixture",
          messageCount: historyLength,
          updatedAt: now,
          model: "scroll-provider:scroll-model",
        },
      ],
      workspaces: [],
      currentSessionId: sessionId,
      selectedModel: "scroll-provider:scroll-model",
      chatConfig: {
        useSearch: false,
        useReasoning: true,
        reasoningMode: "auto",
        useRAG: false,
        temperature: 1,
      },
    }),
  );
  await setIndexedDbValue(page, `session_messages_${sessionId}`, {
    nodesById,
    rootMessageIds: ["scroll-history-0"],
    activeRootMessageId: "scroll-history-0",
  });
  await setIndexedDbValue(
    page,
    "neo-chat-memory",
    persistedState({
      settings: {
        enabled: false,
        searchEnabled: false,
        autoRecordEnabled: false,
        dreamEnabled: false,
      },
      memories: [],
      dreamStatus: { isRunning: false },
    }),
  );

  const streamPhase = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __streamScrollFixture: { phase: string };
          }
        ).__streamScrollFixture.phase,
    );
  const releaseStream = (gate: string) =>
    page.evaluate(
      (gateName) =>
        (
          window as unknown as {
            __streamScrollFixture: { release: (name: string) => void };
          }
        ).__streamScrollFixture.release(gateName),
      gate,
    );

  await page.goto("/");
  const session = page.getByRole("button", {
    name: "Streaming scroll fixture",
    exact: true,
  });
  await session.click();
  await expect(session).toHaveAttribute("aria-current", "page");
  const scroller = page.locator("[data-chat-scroll-container]");
  await expect(scroller).toBeVisible();
  await expect(
    page.locator('[data-message-id="scroll-history-0"]'),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Open settings menu" }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(
    page.getByLabel("Auto-scroll while messages are being generated"),
  ).toBeChecked();
  await page.getByRole("button", { name: "Close settings" }).click();

  await expect(scroller).toBeVisible();
  await expect(
    page.locator('[data-message-id="scroll-history-0"]'),
  ).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() =>
      scroller.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);
  expect(
    await scroller.evaluate(
      (element) => getComputedStyle(element).scrollBehavior,
    ),
  ).toBe("auto");
  await scroller.evaluate((element) =>
    element.scrollTo({ top: element.scrollHeight, behavior: "auto" }),
  );
  await expect
    .poll(() =>
      scroller.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(48);
  await expect(
    page.locator('[data-message-id="scroll-history-31"]'),
  ).toBeVisible();

  await sendChatMessage(page, "Exercise streamed scrolling");
  await expect.poll(streamPhase).toBe("reasoning-ready");
  const activeReasoningToggle = scroller.locator('button[aria-busy="true"]');
  await expect(activeReasoningToggle).toBeVisible();
  await expect(activeReasoningToggle).toHaveAttribute("aria-expanded", "true");
  await expect
    .poll(() =>
      scroller.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(48);

  await scroller.hover();
  await page.mouse.wheel(0, -80);
  await expect
    .poll(() =>
      scroller.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeGreaterThan(40);
  const pausedScroll = await scroller.evaluate((element) => ({
    distanceFromEnd:
      element.scrollHeight - element.scrollTop - element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  }));
  expect(pausedScroll.distanceFromEnd).toBeLessThan(160);

  await releaseStream("grow-reasoning");
  await expect.poll(streamPhase).toBe("reasoning-grown");
  await expect
    .poll(() =>
      scroller.evaluate((element) =>
        element.textContent?.includes("reasoning-tail-marker"),
      ),
    )
    .toBe(true);
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight))
    .toBeGreaterThan(pausedScroll.scrollHeight);
  const afterReasoning = await scroller.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  }));
  expect(afterReasoning.scrollHeight).toBeGreaterThan(
    pausedScroll.scrollHeight,
  );
  expect(
    Math.abs(afterReasoning.scrollTop - pausedScroll.scrollTop),
  ).toBeLessThanOrEqual(2);

  await scroller.evaluate((element) =>
    element.scrollTo({ top: element.scrollHeight, behavior: "auto" }),
  );
  await expect
    .poll(() =>
      scroller.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(48);

  await releaseStream("grow-content");
  await expect.poll(streamPhase).toBe("content-grown");
  await expect
    .poll(
      () =>
        scroller.evaluate((element) =>
          element.textContent?.includes("content-tail-marker"),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  await expect
    .poll(() =>
      scroller.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(48);

  const codePlaceholder = scroller
    .locator("pre")
    .filter({ hasText: "content-tail-marker" });
  await expect(codePlaceholder).toBeVisible();
  await expect(scroller.locator(".markdown-codeblock")).toHaveCount(0);

  await releaseStream("close-code");
  await expect.poll(streamPhase).toBe("code-closed");
  const codeBlock = scroller.locator(".markdown-codeblock").last();
  await expect(codeBlock).toBeVisible();
  await expect(
    codeBlock.getByRole("button", { name: "Expand code" }),
  ).toHaveAttribute("aria-expanded", "false");
  const codeContent = scroller.locator(".markdown-codeblock-content").last();
  const collapsedCodeBeforeFinish = await codeContent.evaluate((element) => {
    (
      window as typeof window & {
        __streamCodeContentNode?: Element;
      }
    ).__streamCodeContentNode = element;
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });
  expect(
    collapsedCodeBeforeFinish.scrollHeight -
      collapsedCodeBeforeFinish.clientHeight,
  ).toBeGreaterThan(0);

  await releaseStream("finish");
  await expect.poll(streamPhase).toBe("done");
  const codeExpandToggle = codeBlock.getByRole("button", {
    name: "Expand code",
  });
  await expect(codeExpandToggle).toBeVisible();
  await expect(codeExpandToggle).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(() =>
      codeContent.evaluate(
        (element) =>
          element ===
          (
            window as typeof window & {
              __streamCodeContentNode?: Element;
            }
          ).__streamCodeContentNode,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      codeContent.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      scroller.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(48);

  await codeExpandToggle.click();
  const codeCollapseToggle = codeBlock.getByRole("button", {
    name: "Collapse code",
  });
  await expect(codeCollapseToggle).toHaveAttribute("aria-expanded", "true");
  await expect
    .poll(() =>
      codeContent.evaluate((element) =>
        Math.abs(element.scrollHeight - element.clientHeight),
      ),
    )
    .toBeLessThanOrEqual(2);
  await codeCollapseToggle.click();
  await expect(
    codeBlock.getByRole("button", { name: "Expand code" }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(() =>
      codeContent.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    )
    .toBeGreaterThan(0);
});

test("applies stable gutters to the primary app scroll regions", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });

  for (const path of [
    "/",
    "/?panel=search",
    "/?panel=assistants",
    "/?panel=skills",
    "/?panel=plugins",
    "/?panel=knowledge",
    "/?panel=settings&settingsTab=system",
  ]) {
    await page.goto(path);
    const scrollers =
      path === "/?panel=search"
        ? page.locator(
            '[role="dialog"] [class~="overflow-y-auto"], [role="dialog"] [class~="overflow-auto"]',
          )
        : page.locator(
            'main [class~="overflow-y-auto"], main [class~="overflow-auto"]',
          );
    await expect(scrollers.first()).toBeVisible();
    expect(
      await scrollers.evaluateAll((elements) =>
        elements.every(
          (element) =>
            getComputedStyle(element).scrollbarGutter === "stable both-edges",
        ),
      ),
    ).toBe(true);
    await expectNoPageHorizontalOverflow(page);
  }

  await page.goto("/");
  await expect(page.locator('textarea[name="message"]')).toBeVisible();
  expect(
    await page
      .locator("html")
      .evaluate((element) => getComputedStyle(element).scrollbarGutter),
  ).toBe("stable both-edges");
  expect(
    await page
      .locator('textarea[name="message"]')
      .evaluate((element) => getComputedStyle(element).scrollbarGutter),
  ).toBe("stable both-edges");

  await page.goto("/?panel=settings&settingsTab=system");
  const desktopSettingsNavigation = page.locator(
    '[class~="md:overflow-y-auto"]',
  );
  await expect(desktopSettingsNavigation).toBeVisible();
  expect(
    await desktopSettingsNavigation.evaluate(
      (element) => getComputedStyle(element).scrollbarGutter,
    ),
  ).toBe("stable both-edges");
});

test("keeps centered content fixed while vertical overflow changes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?panel=search");
  await expect(page.locator("#global-search-title")).toBeVisible();
  await page.waitForTimeout(400);

  const searchScroller = page.locator(
    '[role="dialog"] [class~="scrollbar-gutter-both"]',
  );
  await expect(searchScroller).toBeVisible();

  const measurements = await searchScroller.evaluate(async (scroller) => {
    const centered = scroller.firstElementChild;
    if (!(centered instanceof HTMLElement)) {
      throw new Error("Global search content container is missing.");
    }
    const nextFrame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const measure = () => {
      const contentRect = centered.getBoundingClientRect();
      return {
        clientWidth: scroller.clientWidth,
        contentLeft: contentRect.left,
        contentWidth: contentRect.width,
        overflowing: scroller.scrollHeight > scroller.clientHeight,
      };
    };

    await nextFrame();
    const before = measure();
    const filler = document.createElement("div");
    filler.style.height = `${scroller.clientHeight + 200}px`;
    centered.append(filler);
    await nextFrame();
    const during = measure();
    filler.remove();
    await nextFrame();
    const restored = measure();
    const gutter = getComputedStyle(scroller).scrollbarGutter;

    return { before, during, gutter, restored };
  });

  expect(measurements.gutter).toBe("stable both-edges");
  expect(measurements.before.overflowing).toBe(false);
  expect(measurements.during.overflowing).toBe(true);
  expect(measurements.restored.overflowing).toBe(false);
  for (const key of ["clientWidth", "contentLeft", "contentWidth"] as const) {
    expect(measurements.during[key]).toBeCloseTo(measurements.before[key], 5);
    expect(measurements.restored[key]).toBeCloseTo(measurements.before[key], 5);
  }
});

test("avoids page-level horizontal overflow on mobile panels", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });

  for (const path of [
    "/",
    "/?panel=search",
    "/?panel=assistants",
    "/?panel=skills",
    "/?panel=plugins",
    "/?panel=knowledge",
    "/?panel=settings&settingsTab=system",
  ]) {
    await page.goto(path);
    if (path === "/?panel=search") {
      await expect(page.getByRole("dialog")).toBeVisible();
    } else {
      await expect(page.getByRole("main")).toBeVisible();
    }
    await expectNoPageHorizontalOverflow(page);
  }

  const mobileSettingsNavigation = page.locator(
    '[class~="md:overflow-y-auto"]',
  );
  await expect(mobileSettingsNavigation).toBeVisible({ timeout: 15_000 });
  expect(
    await mobileSettingsNavigation.evaluate(
      (element) => getComputedStyle(element).scrollbarGutter,
    ),
  ).toBe("auto");
});

test("renders the destructive confirmation setting across themes and viewports", async ({
  page,
}) => {
  const controlledInputWarnings: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /changing an (?:un)?controlled input to be (?:un)?controlled/.test(
        message.text(),
      )
    ) {
      controlledInputWarnings.push(message.text());
    }
  });

  await page.goto("/manifest.webmanifest");
  await page.evaluate(
    (value) => localStorage.setItem("neo-chat-core-settings", value),
    persistedState({ theme: "light", language: "en" }),
  );
  await setIndexedDbValue(
    page,
    "neo-chat-settings",
    persistedState({
      system: { enableDestructiveToolConfirmation: false },
    }),
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?panel=settings&settingsTab=system");

  const confirmationToggle = page.getByLabel(
    "Require confirmation for destructive tool calls",
  );
  const autoScrollToggle = page.getByLabel(
    "Auto-scroll while messages are being generated",
  );
  const imageCompressionToggle = page.getByLabel(
    "Automatically compress conversation images",
  );
  const themeControl = page.getByRole("group", { name: "Appearance theme" });
  await expect(confirmationToggle).toBeVisible();
  await expect(confirmationToggle).not.toBeChecked();
  await expect(autoScrollToggle).toBeVisible();
  await expect(autoScrollToggle).not.toBeChecked();
  await expect(imageCompressionToggle).toBeChecked();
  await autoScrollToggle.press("Space");
  await expect(autoScrollToggle).toBeChecked();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await themeControl.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.setViewportSize({ width: 390, height: 844 });
  await confirmationToggle.scrollIntoViewIfNeeded();
  await expect(confirmationToggle).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await confirmationToggle.press("Space");
  await expect(confirmationToggle).toBeChecked();
  await themeControl.getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  expect(controlledInputWarnings).toEqual([]);
});

test("persists auto image compression settings and hides disabled controls", async ({
  page,
}) => {
  await page.goto("/manifest.webmanifest");
  await page.evaluate(
    (value) => localStorage.setItem("neo-chat-core-settings", value),
    persistedState({ theme: "light", language: "en" }),
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?panel=settings&settingsTab=system");

  const toggle = page.getByLabel("Automatically compress conversation images");
  const sizeSlider = page.getByLabel("Maximum compressed image file size");
  const dimensionSlider = page.getByLabel(
    "Maximum compressed image width or height",
  );
  const controls = page.getByTestId("image-compression-controls");

  await expect(toggle).toBeChecked();
  await expect(controls).toBeVisible();
  await expect(sizeSlider).toHaveValue("1");
  await expect(sizeSlider).toHaveAttribute("aria-valuetext", "1 MB");
  await expect(dimensionSlider).toHaveValue("1024");
  await expect(dimensionSlider).toHaveAttribute("aria-valuetext", "1024 px");
  await expectNoPageHorizontalOverflow(page);

  await sizeSlider.press("Home");
  for (let index = 0; index < 4; index += 1) {
    await sizeSlider.press("ArrowRight");
  }
  await dimensionSlider.press("Home");
  for (let index = 0; index < 6; index += 1) {
    await dimensionSlider.press("ArrowRight");
  }
  await expect(sizeSlider).toHaveValue("2.5");
  await expect(dimensionSlider).toHaveValue("2048");

  await expect
    .poll(async () => {
      const stored = await getIndexedDbValue(page, "neo-chat-settings");
      const parsed =
        typeof stored === "string"
          ? JSON.parse(stored)
          : (stored as { state?: { system?: Record<string, unknown> } });
      return [
        parsed?.state?.system?.imageCompressionMaxSizeMB,
        parsed?.state?.system?.imageCompressionMaxWidthOrHeight,
      ];
    })
    .toEqual([2.5, 2048]);

  await page.reload();
  await expect(toggle).toBeChecked();
  await expect(sizeSlider).toHaveValue("2.5");
  await expect(dimensionSlider).toHaveValue("2048");

  await toggle.press("Space");
  await expect(toggle).not.toBeChecked();
  await expect(controls).toHaveCount(0);
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await expect(controls).toHaveCount(0);

  await toggle.press("Space");
  await expect(controls).toBeVisible();
  await expect(sizeSlider).toHaveValue("2.5");
  await expect(dimensionSlider).toHaveValue("2048");
  await page.setViewportSize({ width: 390, height: 844 });
  await controls.scrollIntoViewIfNeeded();
  await expectNoPageHorizontalOverflow(page);
});

test("compresses normal oversized images but preserves both long-image directions", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sessionId = "image-compression-fixture";
  const model = "image-provider:vision-model";

  await page.goto("/manifest.webmanifest");
  await page.evaluate(
    (value) => localStorage.setItem("neo-chat-core-settings", value),
    persistedState({
      theme: "light",
      language: "en",
      providers: [
        {
          id: "image-provider",
          name: "Image Provider",
          type: "OpenAI Compatible",
          baseUrl: "https://images.example.test/v1",
          apiKey: "",
          enabled: true,
          models: ["vision-model"],
          modelsList: ["vision-model"],
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
        enableAutoImageCompression: true,
        imageCompressionMaxSizeMB: 1,
        imageCompressionMaxWidthOrHeight: 1024,
      },
      customModelMetadata: {
        "vision-model": {
          id: "vision-model",
          name: "Vision Model",
          attachment: true,
          modalities: {
            input: ["text", "image"],
            output: ["text"],
          },
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
          title: "Image compression fixture",
          messageCount: 0,
          updatedAt: Date.now(),
          model,
        },
      ],
      workspaces: [],
      currentSessionId: sessionId,
      selectedModel: model,
      chatConfig: {},
    }),
  );

  await page.goto("/");
  const imageSession = page.getByRole("button", {
    name: "Image compression fixture",
    exact: true,
  });
  await imageSession.click();
  await expect(imageSession).toHaveAttribute("aria-current", "page");
  await expect(page.locator('textarea[name="message"]')).toBeVisible();
  await expect(page.locator('textarea[name="message"]')).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Attach files" }),
  ).toBeEnabled();

  const sourceSizes = await attachCanvasImages(page, [
    {
      name: "normal-oversized.jpg",
      width: 1600,
      height: 900,
      patterned: true,
    },
    {
      name: "horizontal-long.jpg",
      width: 3000,
      height: 500,
    },
    {
      name: "vertical-long.jpg",
      width: 500,
      height: 3000,
    },
  ]);
  expect(sourceSizes["horizontal-long.jpg"]).toBeLessThan(1024 * 1024);
  expect(sourceSizes["vertical-long.jpg"]).toBeLessThan(1024 * 1024);

  const normal = page.getByAltText("normal-oversized.jpg");
  const horizontal = page.getByAltText("horizontal-long.jpg");
  const vertical = page.getByAltText("vertical-long.jpg");
  await expect(normal).toBeVisible({ timeout: 30_000 });
  await expect(horizontal).toBeVisible({ timeout: 30_000 });
  await expect(vertical).toBeVisible({ timeout: 30_000 });

  await expect
    .poll(() =>
      normal.evaluate((image) => ({
        width: (image as HTMLImageElement).naturalWidth,
        height: (image as HTMLImageElement).naturalHeight,
      })),
    )
    .toEqual({ width: 1024, height: 576 });
  await expect
    .poll(() =>
      horizontal.evaluate((image) => ({
        width: (image as HTMLImageElement).naturalWidth,
        height: (image as HTMLImageElement).naturalHeight,
      })),
    )
    .toEqual({ width: 3000, height: 500 });
  await expect
    .poll(() =>
      vertical.evaluate((image) => ({
        width: (image as HTMLImageElement).naturalWidth,
        height: (image as HTMLImageElement).naturalHeight,
      })),
    )
    .toEqual({ width: 500, height: 3000 });
});

test("opens and closes the global search center with the keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.locator(".glass-shell").first()).toHaveCSS(
    "width",
    "288px",
  );
  const searchLauncher = page.getByRole("button", { name: "Open search" });
  await searchLauncher.focus();
  await expect(searchLauncher).toBeFocused();
  await openSearchWithKeyboard(page);
  const searchDialog = page.getByRole("dialog", { name: "Search" });
  const searchInput = page.locator(
    'input[aria-controls="global-search-results"]',
  );
  await expect(searchDialog).toBeVisible();
  await expect(searchDialog).toHaveAttribute("aria-modal", "true");
  await expect(searchInput).toBeFocused();
  await expect(page.locator("[data-chat-app-shell]")).toHaveAttribute(
    "inert",
    "",
  );
  await expect(page.locator('textarea[name="message"]')).toHaveCount(1);
  await expect(page).toHaveURL(/(?:\?|&)panel=search(?:&|$)/);

  await page.keyboard.press("Escape");
  await expect(page.locator('textarea[name="message"]')).toBeVisible();
  await expect(page).not.toHaveURL(/(?:\?|&)panel=search(?:&|$)/);
  await expect(searchLauncher).toBeFocused();
});

test("navigates settings search results from the keyboard", async ({
  page,
}) => {
  await page.goto("/?panel=settings&settingsTab=system");

  const settingsSearch = page.getByRole("combobox", {
    name: "Search settings",
  });
  await settingsSearch.fill("webdav");
  await expect(
    page.getByRole("option", { name: /Encrypted Sync/ }),
  ).toHaveAttribute("aria-selected", "true");
  await settingsSearch.press("Enter");

  await expect(page).toHaveURL(/settingsTab=sync/);
  await expect(page.getByRole("tabpanel")).toHaveAttribute(
    "aria-labelledby",
    "settings-tab-sync",
  );
});

test("renders the new workstation controls in all supported locales", async ({
  page,
  context,
}) => {
  for (const [locale, searchLabel] of [
    ["en", "Search settings"],
    ["zh", "搜索设置"],
    ["ja", "設定を検索"],
  ] as const) {
    await context.addCookies([
      {
        name: "NEXT_LOCALE",
        value: locale,
        url: "http://127.0.0.1:3100",
      },
    ]);
    await page.goto("/?panel=settings&settingsTab=system");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(
      page.getByRole("combobox", { name: searchLabel }),
    ).toBeVisible();
  }
});

test("guides a first-run user without models to Provider settings", async ({
  page,
}) => {
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as {
      modelProvider: {
        available: boolean;
        models: string[];
        modelMetadata: Record<string, unknown>;
        defaultModels: Record<string, unknown>;
      };
    };
    config.modelProvider = {
      ...config.modelProvider,
      available: false,
      models: [],
      modelMetadata: {},
      defaultModels: {},
    };
    await route.fulfill({ response, json: config });
  });
  await page.goto("/");

  const providerSettings = page.getByRole("button", {
    name: "Provider settings",
  });
  await expect(providerSettings).toBeVisible();
  await expect(page.locator('textarea[name="message"]')).toBeDisabled();

  await providerSettings.click();
  await expect(page).toHaveURL(
    /(?:\?|&)panel=settings(?:&|$).*settingsTab=providers/,
  );
});

test("opens global search from the sidebar and exposes compact controls", async ({
  page,
}) => {
  await page.goto("/");

  await openPanel(page, "Open search", "search");

  const sourceGroup = page.getByRole("group", { name: "Source" });
  const knowledgeSource = sourceGroup.getByRole("button", {
    name: "Knowledge",
  });
  await knowledgeSource.click();
  await expect(knowledgeSource).toHaveAttribute("aria-pressed", "true");

  const filtersButton = page.getByRole("button", {
    name: "Filters and sort",
  });
  await filtersButton.click();
  const roleFilter = page.getByRole("combobox", {
    name: "Role",
    exact: true,
  });
  await expect(roleFilter).toBeVisible();
  await roleFilter.press("End");
  await roleFilter.press("Enter");
  await expect(
    page.getByRole("button", { name: /1 active option/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore defaults" }).click();
  await expect(roleFilter).toContainText("All roles");

  const searchInput = page.locator(
    'input[aria-controls="global-search-results"]',
  );
  await searchInput.fill("temporary query");
  await page.getByRole("button", { name: "Clear search query" }).click();
  await expect(searchInput).toHaveValue("");
});

test("keeps global search usable in the mobile sidebar flow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await page
    .getByRole("main")
    .getByRole("button", { name: "Open sidebar" })
    .click();
  await page.getByRole("button", { name: "Open search" }).click();
  await expect(page.locator("#global-search-title")).toBeVisible();
  await expect(page).toHaveURL(/(?:\?|&)panel=search(?:&|$)/);
  await expect(page.getByRole("button", { name: "Open search" })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.getByRole("button", { name: "Filters and sort" }).click();
  await expect(
    page.getByRole("combobox", { name: "Sort", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("global search indexes only the active chat branch", async ({ page }) => {
  await page.goto("/manifest.webmanifest");
  const sessionId = "search-fixture";
  await setIndexedDbValue(
    page,
    "neo-chat-storage",
    JSON.stringify({
      state: {
        sessions: [
          {
            id: sessionId,
            title: "Branch search fixture",
            messageCount: 2,
            updatedAt: Date.now(),
            model: "",
          },
        ],
        workspaces: [],
        currentSessionId: sessionId,
        selectedModel: "",
        chatConfig: {},
      },
      version: 5,
    }),
  );
  await setIndexedDbValue(page, `session_messages_${sessionId}`, {
    nodesById: {
      root: {
        id: "root",
        message: {
          id: "root",
          role: "user",
          content: "active-branch-query-root",
          timestamp: Date.now() - 2,
        },
        childMessageIds: ["hidden", "active"],
        activeChildMessageId: "active",
      },
      hidden: {
        id: "hidden",
        message: {
          id: "hidden",
          role: "model",
          content: "hidden-branch-never-index",
          timestamp: Date.now() - 1,
        },
        parentMessageId: "root",
        childMessageIds: [],
      },
      active: {
        id: "active",
        message: {
          id: "active",
          role: "model",
          content: "active-branch-visible-result",
          timestamp: Date.now(),
        },
        parentMessageId: "root",
        childMessageIds: [],
      },
    },
    rootMessageIds: ["root"],
    activeRootMessageId: "root",
  });
  await page.goto("/");

  await openSearchWithKeyboard(page);
  const searchInput = page.locator(
    'input[aria-controls="global-search-results"]',
  );
  await searchInput.fill("active-branch-visible-result");
  await expect(page.locator('[id^="global-search-result-"]')).toHaveCount(1);

  await searchInput.fill("hidden-branch-never-index");
  await expect(page.locator('[id^="global-search-result-"]')).toHaveCount(0);

  await searchInput.fill("active-branch-visible-result");
  const activeResult = page.locator('[id^="global-search-result-"]');
  await expect(activeResult).toHaveCount(1);
  await searchInput.press("ArrowDown");
  await expect(activeResult).toHaveAttribute("aria-selected", "true");
  await searchInput.press("Enter");
  await expect(page).not.toHaveURL(/(?:\?|&)panel=search(?:&|$)/);
  await expect(page.getByText("active-branch-visible-result")).toBeVisible();
});

test("a failed plugin market request is not rendered as an empty market", async ({
  page,
}) => {
  await page.route("**/api/plugins/list", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "market unavailable" }),
    });
  });

  await page.goto("/");
  await openPanel(page, "Open Plugins", "plugins");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("plugin-market-empty")).toHaveCount(0);
});

test("preserves a PDF original and extracted text across cancel and retry", async ({
  page,
}) => {
  let parseStarts = 0;
  let cancelledJobs = 0;
  await page.route("**/api/doc-parse**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());

    if (request.method() === "DELETE") {
      cancelledJobs += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    if (request.method() === "GET" && pathname.includes("/jobs/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "pending" }),
      });
      return;
    }

    if (request.method() === "POST" && pathname === "/api/doc-parse") {
      parseStarts += 1;
      if (parseStarts === 1) {
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({
            jobId: "cancel-job",
            jobSecret: "cancel-secret",
            status: "pending",
          }),
        });
        return;
      }
      if (parseStarts === 2) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "parser unavailable" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ markdown: "Extracted retry PDF text" }),
      });
      return;
    }

    await route.abort();
  });

  await page.goto("/manifest.webmanifest");
  await setIndexedDbValue(
    page,
    "neo-chat-settings",
    persistedState({
      rag: {
        enabled: false,
        url: "",
        token: "",
        topK: 10,
        chunkSize: 512,
        documentParseProvider: "mineru",
        mineruApiToken: "",
        llamaParseApiKey: "",
        useDefaultVectorStore: false,
        useDefaultDocumentProcessing: false,
      },
    }),
  );
  await page.goto("/");
  await openPanel(page, "Open Knowledge Base", "knowledge");
  await page.getByRole("button", { name: "Create New Collection" }).click();
  const collectionDialog = page.getByRole("dialog");
  await collectionDialog.getByLabel("Name").fill("E2E Knowledge");
  await collectionDialog.getByRole("button", { name: "Save" }).click();
  await page
    .getByRole("button", { name: "Open collection E2E Knowledge" })
    .click();

  const fileInput = page.getByLabel("Knowledge files");
  const pendingParseResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/doc-parse" &&
      response.request().method() === "POST",
  );
  await fileInput.setInputFiles({
    name: "cancel.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 cancel fixture"),
  });
  await pendingParseResponse;
  await expect.poll(() => parseStarts).toBe(1);
  await page.waitForTimeout(100);
  await page
    .getByRole("button", { name: "Cancel processing cancel.pdf" })
    .click();
  await expect(page.getByText("cancel.pdf")).toHaveCount(0);
  await expect.poll(() => cancelledJobs).toBe(1);

  await fileInput.setInputFiles({
    name: "retry.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 retry fixture"),
  });
  const retryButton = page.getByRole("button", {
    name: "Retry processing retry.pdf",
  });
  await expect(retryButton).toBeVisible();
  await retryButton.click();

  const downloadOriginal = page.getByRole("button", {
    name: "Download the original retry.pdf",
  });
  await expect(downloadOriginal).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await downloadOriginal.click();
  const originalDownload = await downloadPromise;
  expect(originalDownload.suggestedFilename()).toBe("retry.pdf");

  await page.getByRole("button", { name: "Open retry.pdf" }).click();
  await expect(page.getByLabel("File content")).toHaveValue(
    "Extracted retry PDF text",
  );

  await expect
    .poll(async () => {
      const raw = await getIndexedDbValue(page, "knowledge-storage");
      const persisted =
        typeof raw === "string" ? JSON.parse(raw) : (raw as any);
      const file = persisted?.state?.collections?.[0]?.files?.[0];
      return file
        ? {
            contentKind: file.contentKind,
            distinctPaths: file.sourcePath !== file.contentPath,
            indexStatus: file.indexStatus,
            storageStatus: file.storageStatus,
          }
        : null;
    })
    .toEqual({
      contentKind: "extracted_text",
      distinctPaths: true,
      indexStatus: "not_indexed",
      storageStatus: "saved",
    });
  expect(parseStarts).toBe(3);
});

test("requires one-time approval for destructive tools", async ({ page }) => {
  const sessionId = "tool-permission-session";
  const sensitiveToolArg = "tool-auth-secret-never-render";
  await page.goto("/manifest.webmanifest");
  await page.evaluate(
    (value) => {
      localStorage.setItem("neo-chat-core-settings", value);
    },
    persistedState({
      theme: "light",
      language: "en",
      providers: [
        {
          id: "e2e-provider",
          name: "E2E Provider",
          type: "OpenAI Compatible",
          baseUrl: "https://model.example.test/v1",
          apiKey: "",
          enabled: true,
          models: ["e2e-model"],
          modelsList: ["e2e-model"],
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
        enableDestructiveToolConfirmation: true,
      },
      customModelMetadata: {
        "e2e-model": {
          id: "e2e-model",
          name: "E2E Model",
          tool_call: true,
        },
      },
      activePlugins: ["e2e-deleter"],
      installedPlugins: [
        {
          id: "e2e-deleter",
          title: "E2E Deleter",
          description: "Deletes a test record.",
          logoUrl: "",
          manifestUrl: "https://plugins.example.test/writer.json",
          baseUrl: "https://plugins.example.test",
          source: "openapi",
          auth: { type: "none" },
          functions: [
            {
              name: "delete_record",
              description: "Delete a record.",
              method: "DELETE",
              path: "/records/{id}",
              risk: "destructive",
              parameters: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  auth_token: { type: "string" },
                },
              },
            },
          ],
        },
      ],
      pluginConfigs: {
        "e2e-deleter": { enabledFunctions: ["delete_record"] },
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
          title: "Tool permission fixture",
          messageCount: 0,
          updatedAt: Date.now(),
          model: "e2e-provider:e2e-model",
          config: {
            activePlugins: ["e2e-deleter"],
            toolApprovals: [],
          },
        },
      ],
      workspaces: [],
      currentSessionId: sessionId,
      selectedModel: "e2e-provider:e2e-model",
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
  await setIndexedDbValue(
    page,
    "neo-chat-memory",
    persistedState({
      settings: {
        enabled: false,
        searchEnabled: false,
        autoRecordEnabled: false,
        dreamEnabled: false,
      },
      memories: [],
      dreamStatus: { isRunning: false },
    }),
  );

  let initialRequests = 0;
  let executionRequests = 0;
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON() as { newMessage?: string };
    if (body.newMessage?.startsWith("Use the tool results above")) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sseBody([
          { type: "content", content: `completed-${initialRequests}` },
          { type: "done" },
        ]),
      });
      return;
    }

    initialRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseBody([
        {
          type: "tool_call",
          toolCall: {
            id: `delete-call-${initialRequests}`,
            name: "delete_record",
            args: {
              id: `record-${initialRequests}`,
              auth_token: sensitiveToolArg,
            },
            status: "pending",
          },
        },
        { type: "done" },
      ]),
    });
  });
  await page.route("**/api/plugins/execute", async (route) => {
    executionRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: { ok: true } }),
    });
  });

  await page.goto("/");
  await expect(page.locator('textarea[name="message"]')).toBeEnabled();

  await sendChatMessage(page, "deny this deletion");
  await expect(page.getByRole("button", { name: "Allow once" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(sensitiveToolArg);
  await expect(page.locator("body")).toContainText("[REDACTED]");
  await page.getByRole("button", { name: "Deny" }).click();
  await expect(page.getByText("completed-1", { exact: true })).toBeVisible();
  expect(executionRequests).toBe(0);

  await sendChatMessage(page, "allow this deletion once");
  await page.getByRole("button", { name: "Allow once" }).click();
  await expect(page.getByText("completed-2", { exact: true })).toBeVisible();
  expect(executionRequests).toBe(1);
  await expect(page.getByText("Allowed once", { exact: true })).toBeVisible();

  await sendChatMessage(page, "ask again before deleting");
  await expect(page.getByRole("button", { name: "Allow once" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Allow for this chat" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Deny" }).click();
  await expect(page.getByText("completed-3", { exact: true })).toBeVisible();
  expect(executionRequests).toBe(1);
  expect(initialRequests).toBe(3);
});

test("exports and restores a ZIP v3 backup without local credentials", async ({
  page,
}) => {
  const now = Date.now();
  const sessionId = "backup-session";
  const collectionId = "backup-knowledge";
  const sourceUrl =
    "opfs://knowledge-base/backup-knowledge/source/original.pdf";
  const contentUrl =
    "opfs://knowledge-base/backup-knowledge/content/extracted.txt";
  const providerSecret = "backup-provider-secret-never-export";

  await page.goto("/manifest.webmanifest");
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: "neo-chat-core-settings",
    value: persistedState({
      theme: "light",
      language: "en",
      providers: [
        {
          id: "backup-provider",
          name: "Backup Provider",
          type: "OpenAI Compatible",
          baseUrl: "https://backup-model.example.test/v1",
          apiKey: providerSecret,
          enabled: true,
          models: ["backup-model"],
          modelsList: ["backup-model"],
        },
      ],
      defaultModels: {},
    }),
  });
  await setIndexedDbValue(
    page,
    "neo-chat-settings",
    persistedState({
      system: {
        enableAutoTitle: false,
        enableRelatedQuestions: false,
      },
      rag: {
        enabled: false,
        url: "",
        token: "",
        topK: 10,
        chunkSize: 512,
        documentParseProvider: "mineru",
        mineruApiToken: "",
        llamaParseApiKey: "",
        useDefaultVectorStore: false,
        useDefaultDocumentProcessing: false,
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
          title: "Backup Session",
          messageCount: 2,
          updatedAt: now,
          model: "backup-provider:backup-model",
          workspaceId: "backup-workspace",
        },
      ],
      workspaces: [
        {
          id: "backup-workspace",
          name: "Backup Workspace",
          systemPrompt: "Keep the restored workspace prompt.",
          knowledgeCollectionIds: [collectionId],
          files: [],
          createdAt: now - 1_000,
        },
      ],
      currentSessionId: sessionId,
      selectedModel: "backup-provider:backup-model",
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
    nodesById: {
      root: {
        id: "root",
        message: {
          id: "root",
          role: "user",
          content: "active backup message",
          timestamp: now - 2,
        },
        childMessageIds: ["active", "alternate"],
        activeChildMessageId: "active",
      },
      active: {
        id: "active",
        message: {
          id: "active",
          role: "model",
          content: "active restored answer",
          timestamp: now - 1,
        },
        parentMessageId: "root",
        childMessageIds: [],
      },
      alternate: {
        id: "alternate",
        message: {
          id: "alternate",
          role: "model",
          content: "non-active branch retained in backup",
          timestamp: now,
        },
        parentMessageId: "root",
        childMessageIds: [],
      },
    },
    rootMessageIds: ["root"],
    activeRootMessageId: "root",
  });
  await setIndexedDbValue(
    page,
    "knowledge-storage",
    persistedState({
      collections: [
        {
          id: collectionId,
          name: "Backup Knowledge",
          description: "Knowledge restored from ZIP.",
          icon: "BookOpen",
          color: "blue",
          updatedAt: now,
          files: [
            {
              id: "backup-pdf",
              name: "original.pdf",
              size: 23,
              type: "application/pdf",
              uploadedAt: now,
              status: "saved",
              sourcePath: sourceUrl,
              contentPath: contentUrl,
              path: contentUrl,
              contentKind: "extracted_text",
              contentSize: 30,
              storageStatus: "saved",
              indexStatus: "not_indexed",
            },
          ],
        },
      ],
    }),
  );
  await setIndexedDbValue(
    page,
    "neo-chat-memory",
    persistedState({
      settings: {
        enabled: false,
        searchEnabled: false,
        autoRecordEnabled: false,
        dreamEnabled: false,
      },
      memories: [],
      dreamStatus: { isRunning: false },
    }),
  );
  await writeOpfsFile(
    page,
    "knowledge-base/backup-knowledge/source/original.pdf",
    "%PDF-1.4 bundled original",
  );
  await writeOpfsFile(
    page,
    "knowledge-base/backup-knowledge/content/extracted.txt",
    "Bundled extracted knowledge text",
  );

  await page.goto("/?panel=settings&settingsTab=system");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export all local data" }).click();
  const backupDownload = await downloadPromise;
  const backupPath = await backupDownload.path();
  if (!backupPath) throw new Error("The generated backup was not persisted.");

  const archive = unzipSync(new Uint8Array(await readFile(backupPath)));
  const manifest = JSON.parse(strFromU8(archive["manifest.json"]));
  const exportedDataText = strFromU8(archive["data.json"]);
  expect(manifest).toMatchObject({
    format: "neo-chat-backup",
    exportVersion: 3,
    storageVersion: 6,
  });
  expect(manifest.files).toHaveLength(2);
  expect(exportedDataText).toContain("non-active branch retained in backup");
  expect(exportedDataText).not.toContain(providerSecret);

  await clearBrowserAppData(page);
  await page.goto("/?panel=settings&settingsTab=system");
  await expect(page.getByText("Backup Session", { exact: true })).toHaveCount(
    0,
  );

  await page
    .getByLabel("Select a neo-chat backup to restore")
    .setInputFiles(backupPath);
  const restoreButton = page.getByRole("button", {
    name: "Replace and Restore",
  });
  await expect(restoreButton).toBeVisible();
  await Promise.all([
    page.waitForEvent("framenavigated", { timeout: 30_000 }),
    restoreButton.click(),
  ]);
  await expect(page.getByText("Credential setup required")).toBeVisible({
    timeout: 30_000,
  });

  const restoredChatRaw = await getIndexedDbValue(page, "neo-chat-storage");
  const restoredChat =
    typeof restoredChatRaw === "string"
      ? JSON.parse(restoredChatRaw)
      : restoredChatRaw;
  expect(restoredChat).toMatchObject({
    state: {
      sessions: [{ id: sessionId, title: "Backup Session" }],
      workspaces: [{ id: "backup-workspace", name: "Backup Workspace" }],
    },
  });

  const restoredTree = (await getIndexedDbValue(
    page,
    `session_messages_${sessionId}`,
  )) as any;
  expect(restoredTree.nodesById.alternate.message.content).toBe(
    "non-active branch retained in backup",
  );

  const restoredKnowledgeRaw = await getIndexedDbValue(
    page,
    "knowledge-storage",
  );
  const restoredKnowledge =
    typeof restoredKnowledgeRaw === "string"
      ? JSON.parse(restoredKnowledgeRaw)
      : (restoredKnowledgeRaw as any);
  const restoredFile = restoredKnowledge.state.collections[0].files[0];
  expect(restoredKnowledge.state.collections[0].name).toBe("Backup Knowledge");
  expect(restoredFile.sourcePath).not.toBe(sourceUrl);
  expect(restoredFile.contentPath).not.toBe(contentUrl);
  expect(await readOpfsFile(page, restoredFile.sourcePath)).toBe(
    "%PDF-1.4 bundled original",
  );
  expect(await readOpfsFile(page, restoredFile.contentPath)).toBe(
    "Bundled extracted knowledge text",
  );

  const restoredCore = await page.evaluate(() =>
    localStorage.getItem("neo-chat-core-settings"),
  );
  expect(restoredCore).not.toContain(providerSecret);
  expect(restoredCore).not.toContain("apiKeySecret");
});
