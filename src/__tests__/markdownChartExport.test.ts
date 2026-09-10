// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { waitForMarkdownCharts } from "@/lib/utils/markdownChartExport";

describe("waitForMarkdownCharts", () => {
  it("waits until every chart is ready or has a terminal error", async () => {
    const root = document.createElement("div");
    root.innerHTML = [
      '<div data-markdown-chart-ready="false"></div>',
      '<div data-markdown-chart-ready="false"></div>',
    ].join("");
    const charts = root.querySelectorAll<HTMLElement>(
      "[data-markdown-chart-ready]",
    );
    let resolved = false;
    const pending = waitForMarkdownCharts(root).then(() => {
      resolved = true;
    });

    charts[0].dataset.markdownChartReady = "true";
    await Promise.resolve();
    expect(resolved).toBe(false);

    charts[1].dataset.markdownChartReady = "error";
    await pending;
    expect(resolved).toBe(true);
  });

  it("does not delay exports without charts", async () => {
    await expect(
      waitForMarkdownCharts(document.createElement("div")),
    ).resolves.toBeUndefined();
  });

  it("settles on abort or the bounded timeout", async () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    root.innerHTML = '<div data-markdown-chart-ready="false"></div>';
    const controller = new AbortController();
    const aborted = waitForMarkdownCharts(root, {
      signal: controller.signal,
      timeoutMs: 100,
    });
    controller.abort();
    await expect(aborted).resolves.toBeUndefined();

    const timedOut = waitForMarkdownCharts(root, { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(timedOut).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
