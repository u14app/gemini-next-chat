// @vitest-environment jsdom

import React, { createContext, useContext, useEffect, useRef } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
  echartsInstances: [] as Array<{
    setOption: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    getDataURL: ReturnType<typeof vi.fn>;
  }>,
  fail: false,
  lastRegistry: null as {
    renderer: {
      parse: (...args: unknown[]) => unknown;
      mount: (...args: unknown[]) => unknown;
    };
  } | null,
  lastOption: null as Record<string, unknown> | null,
  providerProps: null as Record<string, unknown> | null,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("echarts", () => ({
  init: vi.fn(() => {
    const instance = {
      setOption: vi.fn((option: Record<string, unknown>) => {
        controls.lastOption = option;
      }),
      resize: vi.fn(),
      dispose: vi.fn(),
      getDataURL: vi.fn(() => "data:image/png;base64,chart"),
    };
    controls.echartsInstances.push(instance);
    return instance;
  }),
}));

vi.mock("@datafe-open/markdown-chart", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@datafe-open/markdown-chart")>();
  class ChartRendererRegistry {
    renderer!: {
      parse: (...args: unknown[]) => unknown;
      mount: (...args: unknown[]) => unknown;
    };

    register(renderer: typeof this.renderer) {
      this.renderer = renderer;
      controls.lastRegistry = this;
      return this;
    }

    has() {
      return true;
    }
  }

  return { ...actual, ChartRendererRegistry };
});

vi.mock("@datafe-open/markdown-chart-echarts", () => ({
  applyEChartsDefaultStyle: (option: Record<string, unknown>) =>
    structuredClone(option),
  createEChartsRenderer: vi.fn(
    (options: { loadECharts: () => Promise<unknown> }) => ({
      id: "echarts",
      aliases: ["echarts-fulldata"],
      parse: vi.fn(() => ({ option: {}, data: undefined })),
      mount: vi.fn(
        async (
          container: HTMLElement,
          parsed: { option: Record<string, unknown> },
          context: { theme: unknown },
        ) => {
          const runtime = (await options.loadECharts()) as {
            init: (
              target: HTMLElement,
              theme?: unknown,
            ) => {
              setOption: (option: Record<string, unknown>) => void;
              dispose: () => void;
            };
          };
          const instance = runtime.init(container, context.theme);
          instance.setOption(parsed.option);
          return {
            dispose: () => instance.dispose(),
          };
        },
      ),
    }),
  ),
}));

interface ProviderConfig {
  registry: {
    renderer: {
      parse: (...args: unknown[]) => unknown;
      mount: (...args: unknown[]) => unknown;
    };
  };
  theme?: unknown;
  onError?: (error: unknown) => void;
}

const ChartContext = createContext<ProviderConfig | null>(null);

vi.mock("@datafe-open/markdown-chart-react", () => ({
  MarkdownChartProvider({
    children,
    ...props
  }: ProviderConfig & { children: React.ReactNode }) {
    controls.providerProps = props as unknown as Record<string, unknown>;
    const value = React.useMemo(
      () => ({
        registry: props.registry,
        theme: props.theme,
        onError: props.onError,
      }),
      [props.registry, props.theme, props.onError],
    );
    return (
      <ChartContext.Provider value={value}>{children}</ChartContext.Provider>
    );
  },
  MarkdownChartBlock({ source }: { language: string; source: string }) {
    const config = useContext(ChartContext);
    const hostRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const host = hostRef.current;
      if (!host || !config) return;

      if (controls.fail) {
        host.classList.add("markdown-chart-error");
        config.onError?.(new Error("render failed"));
        return;
      }

      const toolbar = document.createElement("div");
      toolbar.className = "markdown-chart-toolbar";
      const title = document.createElement("span");
      title.className = "markdown-chart-title";
      title.textContent = "Demo";
      const toggle = document.createElement("div");
      toggle.className = "markdown-chart-toggle";
      toolbar.append(title, toggle);

      const chart = document.createElement("div");
      chart.className = "markdown-chart-chart-view";
      host.replaceChildren(toolbar, chart);

      let handle: { dispose: () => void } | undefined;
      let disposed = false;
      void Promise.resolve(
        config.registry.renderer.parse(
          {},
          {
            language: "markdown-chart",
            rendererId: "echarts",
            data: { kind: "inline", source: [] },
          },
        ),
      )
        .then((parsed) => {
          if (disposed) return undefined;
          return config.registry.renderer.mount(chart, parsed, {
            theme: config.theme,
            signal: new AbortController().signal,
          });
        })
        .then((nextHandle) => {
          handle = nextHandle as typeof handle;
        })
        .catch((error: unknown) => config.onError?.(error));

      return () => {
        disposed = true;
        handle?.dispose();
        host.replaceChildren();
      };
    }, [config, source]);

    return (
      <div
        ref={hostRef}
        className="markdown-chart-placeholder"
        data-testid="chart-placeholder"
      />
    );
  },
}));

import { ChartBlock } from "../components/content/markdown/ChartBlock";

const source = JSON.stringify({
  version: 1,
  renderer: "echarts",
  data: { kind: "inline", dimensions: ["Month", "Value"], source: [] },
  spec: { series: [{ type: "bar" }] },
});

afterEach(() => {
  cleanup();
  controls.echartsInstances.length = 0;
  controls.fail = false;
  controls.lastOption = null;
  controls.lastRegistry = null;
  controls.providerProps = null;
  vi.unstubAllGlobals();
});

function stubMotionPreference(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" && matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

describe("ChartBlock", () => {
  it("keeps incomplete chart source literal and does not load the renderer", () => {
    render(<ChartBlock source='{"partial":' incomplete />);

    expect(screen.getByText('{"partial":')).toBeTruthy();
    expect(screen.getByText('{"partial":').closest("pre")).toBeTruthy();
    expect(
      screen
        .getByText('{"partial":')
        .closest(".markdown-chart")
        ?.getAttribute("data-markdown-chart-ready"),
    ).toBe("false");
    expect(controls.providerProps).toBeNull();
    expect(controls.echartsInstances).toHaveLength(0);
  });

  it("adds a theme palette while preserving explicit series styles", async () => {
    stubMotionPreference(false);
    const view = render(
      <ChartBlock source={source} incomplete={false} forcedTheme="dark" />,
    );

    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "saveChartImage",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(
      screen
        .getByTestId("chart-placeholder")
        .closest(".markdown-chart")
        ?.getAttribute("data-markdown-chart-ready"),
    ).toBe("true");
    expect(controls.lastOption?.color).toEqual([
      "#22d3ee",
      "#34d399",
      "#a78bfa",
      "#fbbf24",
      "#fb7185",
    ]);
    expect(controls.lastOption?.backgroundColor).toBe("transparent");

    const registry = controls.lastRegistry;
    if (!registry) throw new Error("Expected a chart registry");
    const parsed = {
      option: {
        color: ["#123456"],
        backgroundColor: "#112233",
        series: [{ itemStyle: { color: { type: "linear" } } }],
      },
      data: undefined,
    };
    await registry.renderer.mount(document.createElement("div"), parsed, {
      theme: "dark",
      signal: new AbortController().signal,
    });
    expect(controls.lastOption?.color).toEqual(["#123456"]);
    expect(controls.lastOption?.backgroundColor).toBe("transparent");
    expect(
      (controls.lastOption?.series as Array<{ itemStyle: unknown }>)[0]
        .itemStyle,
    ).toEqual({ color: { type: "linear" } });

    const darkInstance = controls.echartsInstances[0];
    view.rerender(
      <ChartBlock source={source} incomplete={false} forcedTheme="light" />,
    );
    await waitFor(() =>
      expect(controls.lastOption?.color).toEqual([
        "#06b6d4",
        "#10b981",
        "#8b5cf6",
        "#f59e0b",
        "#f43f5e",
      ]),
    );
    expect(controls.lastOption?.backgroundColor).toBe("transparent");
    expect(darkInstance?.dispose).toHaveBeenCalled();
  });

  it("injects reduced-motion animation:false", async () => {
    stubMotionPreference(true);
    render(<ChartBlock source={source} incomplete={false} />);

    await waitFor(() => expect(controls.lastOption?.animation).toBe(false));
  });

  it("copies a Markdown table and downloads a 2x themed PNG", async () => {
    stubMotionPreference(false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const tableSource = JSON.stringify({
      ...JSON.parse(source),
      data: {
        kind: "inline",
        dimensions: ["Month", "Value"],
        source: [
          ["Jan|Feb\nTotal", 0],
          ["March", null],
        ],
      },
    });
    render(<ChartBlock source={tableSource} incomplete={false} />);

    await screen.findByRole("button", { name: "copyChartTableAria" });
    fireEvent.click(screen.getByRole("button", { name: "copyChartTableAria" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "| Month | Value |\n| --- | --- |\n| Jan\\|Feb<br>Total | 0 |\n| March | null |",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "saveChartImage" }));
    expect(controls.echartsInstances[0]?.getDataURL).toHaveBeenCalledWith({
      type: "png",
      pixelRatio: 2,
      backgroundColor: "#ffffff",
    });
    expect(click).toHaveBeenCalled();
    const download = screen.getByRole("button", {
      name: "saveChartImage",
    });
    const fullscreen = screen.getByRole("button", {
      name: "fullscreenChartAria",
    });
    expect(
      download.compareDocumentPosition(fullscreen) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("opens an independent fullscreen chart and restores focus on close", async () => {
    stubMotionPreference(false);
    render(<ChartBlock source={source} incomplete={false} />);

    const fullscreen = await screen.findByRole("button", {
      name: "fullscreenChartAria",
    });
    fullscreen.focus();
    fireEvent.click(fullscreen);

    const dialog = await screen.findByRole("dialog");
    expect(dialog.classList.contains("markdown-chart-dialog")).toBe(true);
    const close = screen.getByRole("button", {
      name: "closeChartFullscreenAria",
    });
    await waitFor(() => expect(document.activeElement).toBe(close));

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(fullscreen);
    expect(controls.echartsInstances).toHaveLength(2);
    expect(controls.echartsInstances[1]?.dispose).toHaveBeenCalled();
  });

  it("keeps source details and exposes retry after a render error", async () => {
    stubMotionPreference(false);
    controls.fail = true;
    render(<ChartBlock source={source} incomplete={false} />);

    await screen.findByRole("alert");
    expect(screen.getByText("chartSource")).toBeTruthy();
    expect(screen.getByText("chartRetry")).toBeTruthy();
    expect(
      screen
        .getByRole("alert")
        .closest(".markdown-chart")
        ?.getAttribute("data-markdown-chart-ready"),
    ).toBe("error");

    controls.fail = false;
    fireEvent.click(screen.getByRole("button", { name: "chartRetry" }));
    await waitFor(() =>
      expect(
        screen
          .getByTestId("chart-placeholder")
          .closest(".markdown-chart")
          ?.getAttribute("data-markdown-chart-ready"),
      ).toBe("true"),
    );
  });

  it("keeps simultaneous chart instances isolated and disposes each owner", async () => {
    stubMotionPreference(false);
    const view = render(
      <div>
        <ChartBlock key="first" source={source} incomplete={false} />
        <ChartBlock key="second" source={source} incomplete={false} />
      </div>,
    );

    await waitFor(() => expect(controls.echartsInstances).toHaveLength(2));
    const [first, second] = controls.echartsInstances;

    view.rerender(
      <div>
        <ChartBlock key="first" source={source} incomplete={false} />
      </div>,
    );
    await waitFor(() => expect(second?.dispose).toHaveBeenCalled());
    expect(first?.dispose).not.toHaveBeenCalled();

    view.unmount();
    expect(first?.dispose).toHaveBeenCalled();
  });
});
