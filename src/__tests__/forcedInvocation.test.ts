import { describe, expect, it } from "vitest";
import {
  buildForcedToolDirective,
  mergeForcedPluginIds,
} from "../lib/chat/forcedInvocation";
import type { PluginFunction } from "../lib/plugin/types";

const fn = (name: string) => ({ name }) as PluginFunction;

describe("buildForcedToolDirective", () => {
  it("names the single tool of a referenced plugin", () => {
    const directive = buildForcedToolDirective([
      { title: "Weather", functions: [fn("weather_get")] },
    ]);

    expect(directive).toContain("## Required tool calls");
    expect(directive).toContain("- Weather: you must call the `weather_get`");
  });

  it("lists every enabled tool when a plugin exposes several", () => {
    const directive = buildForcedToolDirective([
      { title: "Docs", functions: [fn("docs_search"), fn("docs_read")] },
    ]);

    expect(directive).toContain(
      "- Docs: you must call at least one of these tools: `docs_search`, `docs_read`.",
    );
  });

  it("covers multiple plugins in one directive", () => {
    const directive = buildForcedToolDirective([
      { title: "Weather", functions: [fn("weather_get")] },
      { title: "Docs", functions: [fn("docs_search")] },
    ]);

    expect(directive).toContain("- Weather:");
    expect(directive).toContain("- Docs:");
  });

  it("returns an empty string when no plugin has enabled functions", () => {
    expect(buildForcedToolDirective([])).toBe("");
    expect(
      buildForcedToolDirective([{ title: "Weather", functions: [] }]),
    ).toBe("");
    expect(
      buildForcedToolDirective([{ title: "Weather", functions: [fn("  ")] }]),
    ).toBe("");
  });

  it("falls back to the tool name when a plugin has no title", () => {
    expect(
      buildForcedToolDirective([
        { title: "  ", functions: [fn("weather_get")] },
      ]),
    ).toContain("- weather_get: you must call the `weather_get` tool.");
  });
});

describe("mergeForcedPluginIds", () => {
  it("registers a forced plugin that is toggled off for the session", () => {
    expect(mergeForcedPluginIds(["a"], ["b"])).toEqual(["a", "b"]);
  });

  it("does not duplicate a plugin that is already active", () => {
    expect(mergeForcedPluginIds(["a", "b"], ["b"])).toEqual(["a", "b"]);
  });

  it("drops empty ids and tolerates missing lists", () => {
    expect(mergeForcedPluginIds(undefined, undefined)).toEqual([]);
    expect(mergeForcedPluginIds(["a", ""], undefined)).toEqual(["a"]);
    expect(mergeForcedPluginIds(undefined, ["b", "b"])).toEqual(["b"]);
  });
});
