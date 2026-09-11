import { readFile } from "node:fs/promises";

import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  CHART_PROMPT_EXAMPLE,
  MINDMAP_PROMPT_EXAMPLE,
} from "../src/lib/chat/diagramPrompt";

const STORAGE_VERSION = 6;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

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

function fenced(language: string, source: string) {
  return ["```" + language, source, "```"].join("\n");
}

async function seedVisualizationSession(
  page: Page,
  {
    sessionId,
    title,
    content,
  }: {
    sessionId: string;
    title: string;
    content: string;
  },
) {
  // Establish the origin before writing browser storage; the app must not
  // make a provider request to render this fixture.
  await page.goto("/manifest.webmanifest");
  await page.evaluate(
    (value) => localStorage.setItem("neo-chat-core-settings", value),
    persistedState({
      theme: "light",
      language: "en",
      providers: [],
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
      customModelMetadata: {},
    }),
  );

  const messageId = `${sessionId}-message`;
  const now = Date.now();
  await setIndexedDbValue(
    page,
    "neo-chat-storage",
    persistedState({
      sessions: [
        {
          id: sessionId,
          title,
          messageCount: 1,
          updatedAt: now,
          model: "",
        },
      ],
      workspaces: [],
      currentSessionId: sessionId,
      selectedModel: "",
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
      [messageId]: {
        id: messageId,
        message: {
          id: messageId,
          role: "model",
          content,
          timestamp: now,
        },
        childMessageIds: [],
      },
    },
    rootMessageIds: [messageId],
    activeRootMessageId: messageId,
  });

  await page.goto("/");
  const session = page.getByRole("button", { name: title, exact: true });
  await expect(session).toBeVisible();
  // Hydration restores the session list, but selecting the fixture is what
  // loads its message tree and establishes the active session in the UI.
  await session.click();
  await expect(session).toHaveAttribute("aria-current", "page");
  await expect(page.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(page.locator(`[data-message-id="${messageId}"]`)).toBeVisible();
}

async function setDarkTheme(page: Page) {
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(page.locator("html")).toHaveClass(/dark/);
}

async function setLightTheme(page: Page) {
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await expect(page.locator("html")).not.toHaveClass(/dark/);
}

async function expectVisibleCanvas(chart: Locator) {
  const canvas = chart.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await expect
    .poll(() =>
      canvas.evaluate((element) => {
        if (!(element instanceof HTMLCanvasElement)) return false;
        const rect = element.getBoundingClientRect();
        return (
          element.width > 0 &&
          element.height > 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      }),
    )
    .toBe(true);
}

async function canvasFingerprint(chart: Locator) {
  return chart
    .locator("canvas")
    .first()
    .evaluate(async (canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("Expected a chart canvas");
      }
      const bytes = new TextEncoder().encode(canvas.toDataURL());
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    });
}

async function expectVisibleSvg(diagram: Locator) {
  const svg = diagram.locator(".markdown-diagram-svg > svg").first();
  await expect(svg).toBeVisible();
  await expect
    .poll(() =>
      svg.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }),
    )
    .toBe(true);
  return svg;
}

async function expectPngDownload(
  page: Page,
  button: Locator,
  filename: string,
) {
  const downloadPromise = page.waitForEvent("download");
  await button.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(filename);
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const bytes = await readFile(downloadPath!);
  expect(bytes.length).toBeGreaterThan(PNG_SIGNATURE.length);
  expect([...bytes.subarray(0, PNG_SIGNATURE.length)]).toEqual(PNG_SIGNATURE);
}

test.describe("browser-rendered Markdown visualizations", () => {
  test.setTimeout(90_000);
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("renders the canonical ECharts chart in light and dark themes", async ({
    page,
    context,
  }, testInfo) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await seedVisualizationSession(page, {
      sessionId: "markdown-chart-browser-fixture",
      title: "Markdown chart browser fixture",
      content: fenced("chart", CHART_PROMPT_EXAMPLE),
    });

    const chart = page.locator("[data-markdown-chart-ready]").first();
    await expect(chart).toHaveAttribute("data-markdown-chart-ready", "true", {
      timeout: 30_000,
    });
    await expect(chart.locator(".markdown-chart-caption")).toHaveText(
      "Quarterly sign-ups",
    );
    await expectVisibleCanvas(chart);
    const lightFingerprint = await canvasFingerprint(chart);

    await setDarkTheme(page);
    await expect(chart).toHaveAttribute("data-markdown-chart-ready", "true");
    await expectVisibleCanvas(chart);
    await expect
      .poll(() => canvasFingerprint(chart))
      .not.toBe(lightFingerprint);
    const darkFingerprint = await canvasFingerprint(chart);
    await page.screenshot({ path: testInfo.outputPath("chart-dark.png") });

    await setLightTheme(page);
    await expect(chart).toHaveAttribute("data-markdown-chart-ready", "true");
    await expectVisibleCanvas(chart);
    await expect.poll(() => canvasFingerprint(chart)).not.toBe(darkFingerprint);

    await chart
      .getByRole("button", {
        name: "Copy chart data as a Markdown table",
      })
      .click();
    await expect(
      chart.getByRole("button", {
        name: "Chart data table copied",
      }),
    ).toBeVisible();
    const table = await page.evaluate(() => navigator.clipboard.readText());
    expect(table).toContain("Q1");
    expect(table).toContain("184");
    await page.screenshot({ path: testInfo.outputPath("chart-light.png") });
  });

  test("downloads a real chart PNG and closes chart fullscreen with Escape", async ({
    page,
  }) => {
    await seedVisualizationSession(page, {
      sessionId: "markdown-chart-export-fixture",
      title: "Markdown chart export fixture",
      content: fenced("chart", CHART_PROMPT_EXAMPLE),
    });

    const chart = page.locator("[data-markdown-chart-ready]").first();
    await expect(chart).toHaveAttribute("data-markdown-chart-ready", "true", {
      timeout: 30_000,
    });
    await expectVisibleCanvas(chart);

    await expectPngDownload(
      page,
      chart.getByRole("button", { name: "Save chart image" }),
      "chart.png",
    );

    await chart.getByRole("button", { name: "Open chart fullscreen" }).click();
    const dialog = page.getByRole("dialog", { name: "Chart" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("canvas").first()).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: "Close fullscreen chart",
      }),
    ).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("renders Mermaid and mindmap SVGs in both themes and exports them", async ({
    page,
  }, testInfo) => {
    await seedVisualizationSession(page, {
      sessionId: "markdown-diagrams-browser-fixture",
      title: "Markdown diagrams browser fixture",
      content: [
        fenced(
          "mermaid",
          "flowchart LR\n  Start[Start] --> Review[Review]\n  Review --> Done[Done]",
        ),
        fenced("mindmap", MINDMAP_PROMPT_EXAMPLE),
      ].join("\n\n"),
    });

    const mermaid = page.locator('[data-markdown-diagram="mermaid"]');
    const mindmap = page.locator('[data-markdown-diagram="mindmap"]');
    await expect(mermaid).toBeVisible();
    await expect(mindmap).toBeVisible();

    const lightMermaidSvg = await expectVisibleSvg(mermaid);
    const lightMermaidMarkup = await lightMermaidSvg.evaluate(
      (element) => element.outerHTML,
    );
    const lightMindmapSvg = await expectVisibleSvg(mindmap);
    const lightMindmapMarkup = await lightMindmapSvg.evaluate(
      (element) => element.outerHTML,
    );

    await setDarkTheme(page);
    const darkMermaidSvg = await expectVisibleSvg(mermaid);
    await expect
      .poll(() => darkMermaidSvg.evaluate((element) => element.outerHTML))
      .not.toBe(lightMermaidMarkup);
    const darkMindmapSvg = await expectVisibleSvg(mindmap);
    await expect
      .poll(() => darkMindmapSvg.evaluate((element) => element.outerHTML))
      .not.toBe(lightMindmapMarkup);
    await page.screenshot({ path: testInfo.outputPath("diagrams-dark.png") });

    await setLightTheme(page);
    await expectVisibleSvg(mermaid);
    await expectVisibleSvg(mindmap);

    await expectPngDownload(
      page,
      mermaid.getByRole("button", { name: "Save diagram image" }),
      "diagram-mermaid.png",
    );
    await expectPngDownload(
      page,
      mindmap.getByRole("button", { name: "Save diagram image" }),
      "diagram-mindmap.png",
    );
    await page.screenshot({ path: testInfo.outputPath("diagrams-light.png") });
  });

  test("loads the remaining Markdown extensions and their controls in the browser", async ({
    page,
    context,
  }, testInfo) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const png = await readFile("public/logo.png");
    await page.route("https://images.example.test/fixture.png", (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: png }),
    );
    await seedVisualizationSession(page, {
      sessionId: "markdown-extensions-browser-fixture",
      title: "Markdown extensions browser fixture",
      content: [
        "## Browser extensions",
        "| Feature | Result |\n| --- | --- |\n| GFM | Ready |",
        "Formula $x^2 + y^2$ stays beside this text.",
        fenced("typescript", "const answer: number = 42;"),
        "<section><strong>Sanitized HTML</strong><script>window.__markdownUnsafeRan = true</script></section>",
        "![Preview fixture](https://images.example.test/fixture.png)",
        '<file name="browser-note.txt" type="text/plain">\nA generated note.\n</file>',
      ].join("\n\n"),
    });

    const message = page.locator(
      '[data-message-id="markdown-extensions-browser-fixture-message"]',
    );
    await expect(message.getByRole("table")).toContainText("GFM");
    await expect(message.locator(".katex")).toBeVisible();
    await expect(message.locator(".hljs-keyword")).toContainText("const");
    await expect(message.locator("section strong")).toHaveText(
      "Sanitized HTML",
    );
    expect(await page.evaluate(() => "__markdownUnsafeRan" in window)).toBe(
      false,
    );
    await expect(message.locator("script")).toHaveCount(0);
    const image = message.getByAltText("Preview fixture");
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate(
          (element) =>
            element instanceof HTMLImageElement && element.naturalWidth > 0,
        ),
      )
      .toBe(true);
    await expect(message.locator(".markdown-file-card")).toContainText(
      "browser-note.txt",
    );

    await message
      .getByRole("button", { name: "Copy code", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("const answer: number = 42;");
    await page.screenshot({
      path: testInfo.outputPath("markdown-extensions.png"),
    });
  });
});
