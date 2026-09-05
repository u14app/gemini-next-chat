import { describe, expect, it } from "vitest";

import {
  formatResearchDateTime,
  formatResearchTime,
  formatResearchTokens,
} from "@/components/research/formatters";

describe("research locale formatters", () => {
  const date = new Date(2026, 0, 2, 13, 4, 5);

  it("formats dates and times using the selected Chinese locale", () => {
    expect(formatResearchDateTime(date, "zh")).toBe("2026/1/2 13:04:05");
    expect(formatResearchTime(date, "zh")).toBe("13:04:05");
    expect(formatResearchTokens(12_300, "zh")).toBe("1.2万");
  });

  it("formats dates and times using the selected Japanese locale", () => {
    expect(formatResearchDateTime(date, "ja")).toBe("2026/1/2 13:04:05");
    expect(formatResearchTime(date, "ja")).toBe("13:04:05");
    expect(formatResearchTokens(12_300, "ja")).toBe("1.2万");
  });

  it("keeps English compact token notation locale-specific", () => {
    expect(formatResearchDateTime(date, "en")).toBe("1/2/2026, 1:04:05 PM");
    expect(formatResearchTime(date, "en")).toBe("1:04:05 PM");
    expect(formatResearchTokens(12_300, "en")).toBe("12.3K");
  });
});
