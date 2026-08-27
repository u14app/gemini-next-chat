import { describe, expect, it } from "vitest";
import { TOOL_DISPLAY_LIMITS } from "../config/limits";
import {
  formatToolDisplayName,
  formatToolDisplayValue,
  getBuiltinToolLabelKey,
} from "../lib/utils/toolDisplay";
import enContent from "../i18n/locales/en/Content.json";
import jaContent from "../i18n/locales/ja/Content.json";
import zhContent from "../i18n/locales/zh/Content.json";

describe("tool display serialization", () => {
  it("serializes circular values without throwing", () => {
    const value: Record<string, unknown> = { name: "root" };
    value.self = value;

    const display = formatToolDisplayValue(value);

    expect(display.truncated).toBe(true);
    expect(display.text).toContain("[Circular]");
  });

  it("caps deep and wide structures", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let index = 0; index < TOOL_DISPLAY_LIMITS.maxDepth + 2; index += 1) {
      deep = { child: deep };
    }
    const wide = Object.fromEntries(
      Array.from(
        { length: TOOL_DISPLAY_LIMITS.maxObjectEntries + 3 },
        (_, index) => [`key-${index}`, index],
      ),
    );

    const deepDisplay = formatToolDisplayValue(deep);
    const wideDisplay = formatToolDisplayValue(wide);

    expect(deepDisplay.truncated).toBe(true);
    expect(deepDisplay.text).toContain("Max depth");
    expect(wideDisplay.truncated).toBe(true);
    expect(wideDisplay.text).toContain("__omitted_keys__");
  });

  it("caps long strings and final rendered output", () => {
    const display = formatToolDisplayValue({
      text: "x".repeat(TOOL_DISPLAY_LIMITS.maxRenderedChars * 2),
    });

    expect(display.truncated).toBe(true);
    expect(display.text.length).toBeLessThanOrEqual(
      TOOL_DISPLAY_LIMITS.maxRenderedChars,
    );
    expect(display.text).toContain("...");
  });

  it("formats and caps display names", () => {
    const name = formatToolDisplayName(
      `very_long_tool_name_${"x".repeat(TOOL_DISPLAY_LIMITS.maxToolNameChars)}`,
    );

    expect(name).toContain("Very Long Tool Name");
    expect(name.length).toBeLessThanOrEqual(
      TOOL_DISPLAY_LIMITS.maxToolNameChars,
    );
  });

  it("resolves the Research workspace reader in every supported locale", () => {
    const labelKey = getBuiltinToolLabelKey("read_workspace_file");
    expect(labelKey).toBe("toolReadWorkspaceFile");
    expect(labelKey && enContent[labelKey]).toBe("Read workspace file");
    expect(labelKey && zhContent[labelKey]).toBe("读取工作区文件");
    expect(labelKey && jaContent[labelKey]).toBe(
      "ワークスペースファイルを読む",
    );
    expect(formatToolDisplayName("mcp_custom_lookup")).toBe(
      "Mcp Custom Lookup",
    );
  });
});
