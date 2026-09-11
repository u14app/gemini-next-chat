import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { formatCategoryName } from "@/components/skill/SkillMarket";

describe("skill category labels", () => {
  it("keeps localized labels and formats unknown categories without a missing-key error", () => {
    const onError = vi.fn();
    const translate = createTranslator<Record<string, any>>({
      locale: "zh-CN",
      messages: {
        categories: {
          analysis: "分析",
        },
      },
      onError,
    });

    expect(formatCategoryName("analysis", translate)).toBe("分析");
    expect(formatCategoryName("quality", translate)).toBe("Quality");
    expect(formatCategoryName("quality_checks", translate)).toBe(
      "Quality Checks",
    );
    expect(onError).not.toHaveBeenCalled();
  });
});
