// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChartBlock } from "@/components/content/markdown/ChartBlock";
import { CHART_PROMPT_EXAMPLE } from "@/lib/chat/diagramPrompt";

const echarts = vi.hoisted(() => ({
  instances: [] as Array<{
    setOption: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    getDataURL: ReturnType<typeof vi.fn>;
  }>,
}));

const translate = vi.hoisted(
  () => (key: string, values?: Record<string, number>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
);

vi.mock("next-intl", () => ({
  useTranslations: () => translate,
}));

vi.mock("echarts", () => ({
  init: vi.fn(() => {
    const instance = {
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
      getDataURL: vi.fn(() => "data:image/png;base64,chart"),
    };
    echarts.instances.push(instance);
    return instance;
  }),
}));

const validChart = JSON.parse(CHART_PROMPT_EXAMPLE) as {
  version: number;
  renderer: string;
  data: {
    kind: string;
    dimensions: string[];
    source: Array<Record<string, string | number>>;
  };
  spec: Record<string, unknown> & { series: unknown[] };
};

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  echarts.instances.length = 0;
  vi.unstubAllGlobals();
});

async function expectRejectedChart(source: string) {
  const view = render(<ChartBlock source={source} incomplete={false} />);
  await screen.findByRole("alert");
  expect(
    view.container
      .querySelector(".markdown-chart")
      ?.getAttribute("data-markdown-chart-ready"),
  ).toBe("error");
}

describe("markdown chart protocol", () => {
  it.each(["light", "dark"] as const)(
    "corrects unreadable text in the %s theme while retaining series colors",
    async (theme) => {
      const wrongColor = theme === "light" ? "#ffffff" : "#000000";
      const foreground = theme === "light" ? "#374151" : "#e5e7eb";
      render(
        <ChartBlock
          incomplete={false}
          forcedTheme={theme}
          source={JSON.stringify({
            ...validChart,
            spec: {
              ...validChart.spec,
              backgroundColor: wrongColor,
              legend: { textStyle: { color: wrongColor } },
              xAxis: { type: "category", axisLabel: { color: wrongColor } },
              series: [
                {
                  type: "pie",
                  itemStyle: { color: "#18B7C9" },
                  label: {
                    color: wrongColor,
                    rich: { value: { color: wrongColor } },
                  },
                },
              ],
            },
          })}
        />,
      );
      await waitFor(() =>
        expect(echarts.instances[0]?.setOption).toHaveBeenCalled(),
      );
      const option = echarts.instances[0].setOption.mock.calls[0][0];
      expect(option.backgroundColor).toBe("transparent");
      expect(option.legend.textStyle.color).toBe(foreground);
      expect(option.xAxis.axisLabel.color).toBe(foreground);
      expect(option.series[0].label.color).toBe(foreground);
      expect(option.series[0].label.rich.value.color).toBe(foreground);
      expect(option.series[0].itemStyle.color).toBe("#18B7C9");
    },
  );
  it("renders the canonical inline envelope with only the chart view", async () => {
    const view = render(
      <ChartBlock source={CHART_PROMPT_EXAMPLE} incomplete={false} />,
    );

    await waitFor(() =>
      expect(
        view.container
          .querySelector(".markdown-chart")
          ?.getAttribute("data-markdown-chart-ready"),
      ).toBe("true"),
    );
    expect(echarts.instances).toHaveLength(1);
    const header = view.container.querySelector(".markdown-chart-header");
    expect(header?.textContent).toContain("Chart");
    expect(header?.textContent).not.toContain("Quarterly sign-ups");
    const caption = view.container.querySelector(".markdown-chart-caption");
    expect(caption?.textContent).toBe("Quarterly sign-ups");
    const chart = view.container.querySelector(".markdown-chart-chart-view");
    expect(
      chart!.compareDocumentPosition(caption!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(screen.queryByRole("button", { name: "showChartData" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(view.container.querySelector(".markdown-chart-toggle")).toBeNull();
    expect(
      view.container.querySelector<HTMLElement>(".markdown-chart-chart-view")
        ?.hidden,
    ).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: "fullscreenChartAria" }),
    );
    await waitFor(() => expect(echarts.instances).toHaveLength(2));
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector(".markdown-chart-toggle")).toBeNull();
    expect(dialog.querySelector(".markdown-chart-data-view")).toBeNull();
    expect(dialog.querySelector(".markdown-chart-chart-view")).not.toBeNull();
    expect(dialog.querySelector(".markdown-chart-caption")?.textContent).toBe(
      "Quarterly sign-ups",
    );
  });

  it("rejects invalid JSON, unknown renderers, references, and unsafe options", async () => {
    await expectRejectedChart('{"version":1,');
    cleanup();

    await expectRejectedChart(
      JSON.stringify({ ...validChart, renderer: "unknown" }),
    );
    cleanup();

    await expectRejectedChart(
      JSON.stringify({
        ...validChart,
        data: { kind: "ref", ref: "https://example.com/data.json" },
      }),
    );
    cleanup();

    await expectRejectedChart(
      JSON.stringify({
        ...validChart,
        spec: { ...validChart.spec, toolbox: { show: true } },
      }),
    );
  });

  it("enforces the local series limit and upstream data limits", async () => {
    await expectRejectedChart(
      JSON.stringify({
        ...validChart,
        spec: {
          ...validChart.spec,
          series: Array.from({ length: 13 }, () => ({ type: "bar" })),
        },
      }),
    );
    cleanup();

    await expectRejectedChart(
      JSON.stringify({
        ...validChart,
        data: {
          ...validChart.data,
          source: Array.from({ length: 2001 }, (_, index) => ({
            Quarter: `Q${index + 1}`,
            "Sign-ups": index,
          })),
        },
      }),
    );
  });
});
