const MARKDOWN_CHART_SELECTOR = "[data-markdown-chart-ready]";
const DEFAULT_CHART_RENDER_TIMEOUT_MS = 8000;

function chartsAreSettled(root: HTMLElement): boolean {
  const charts = Array.from(
    root.querySelectorAll<HTMLElement>(MARKDOWN_CHART_SELECTOR),
  );

  return charts.every((chart) => {
    const state = chart.dataset.markdownChartReady;
    return state === "true" || state === "error";
  });
}

export function waitForMarkdownCharts(
  root: HTMLElement,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<void> {
  if (options.signal?.aborted || chartsAreSettled(root)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const observer = new MutationObserver(() => {
      if (chartsAreSettled(root)) finish();
    });
    const timeout = window.setTimeout(
      finish,
      options.timeoutMs ?? DEFAULT_CHART_RENDER_TIMEOUT_MS,
    );

    function finish() {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      observer.disconnect();
      options.signal?.removeEventListener("abort", finish);
      resolve();
    }

    options.signal?.addEventListener("abort", finish, { once: true });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-markdown-chart-ready"],
      childList: true,
      subtree: true,
    });

    if (chartsAreSettled(root)) finish();
  });
}
