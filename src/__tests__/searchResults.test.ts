import { describe, expect, it } from "vitest";
import { SEARCH_RESULT_LIMITS } from "../config/limits";
import {
  normalizeImageSources,
  normalizeSearchSources,
} from "../lib/search/results";

describe("search result normalization", () => {
  it("trims and caps source metadata", () => {
    const [source] = normalizeSearchSources([
      {
        title: ` ${"t".repeat(SEARCH_RESULT_LIMITS.maxTitleChars + 10)}`,
        url: "https://example.com/path?q=1",
        content: "c".repeat(SEARCH_RESULT_LIMITS.maxContentChars + 10),
      },
    ]);

    expect(source?.title).toHaveLength(SEARCH_RESULT_LIMITS.maxTitleChars);
    expect(source?.url).toBe("https://example.com/path?q=1");
    expect(source?.content).toHaveLength(SEARCH_RESULT_LIMITS.maxContentChars);
  });

  it("drops unsafe source URLs and deduplicates capped sources", () => {
    const sources = normalizeSearchSources([
      {
        title: "Local",
        url: "http://127.0.0.1/admin",
        content: "secret",
      },
      {
        title: "Good",
        url: "https://example.com/a",
        content: "same",
      },
      {
        title: "Good",
        url: "https://example.com/a",
        content: "same",
      },
      ...Array.from(
        { length: SEARCH_RESULT_LIMITS.maxSources + 5 },
        (_, i) => ({
          title: `Result ${i}`,
          url: `https://example.com/${i}`,
          content: "content",
        }),
      ),
    ]);

    expect(sources).toHaveLength(SEARCH_RESULT_LIMITS.maxSources);
    expect(sources.some((source) => source.url.includes("127.0.0.1"))).toBe(
      false,
    );
    expect(
      sources.filter((source) => source.url === "https://example.com/a"),
    ).toHaveLength(1);
  });

  it("allows placeholder URLs for knowledge results only when requested", () => {
    expect(
      normalizeSearchSources([
        { title: "Knowledge", url: "#", content: "chunk" },
      ]),
    ).toEqual([]);

    expect(
      normalizeSearchSources(
        [{ title: "Knowledge", url: "#", content: "chunk" }],
        { allowPlaceholderUrl: true },
      ),
    ).toEqual([{ title: "Knowledge", url: "#", content: "chunk" }]);
  });

  it("filters and caps image results to HTTPS remote images", () => {
    const images = normalizeImageSources([
      {
        url: "http://example.com/insecure.png",
        description: "insecure",
      },
      {
        url: "https://example.com/image.png",
        description: "d".repeat(
          SEARCH_RESULT_LIMITS.maxImageDescriptionChars + 10,
        ),
        sourceUrl: "https://example.com/article",
      },
      {
        url: "https://example.com/image.png",
        description: "duplicate",
      },
      {
        url: "https://127.0.0.1/private.png",
        description: "private",
      },
    ]);

    expect(images).toHaveLength(2);
    expect(images[0]?.url).toBe("https://example.com/image.png");
    expect(images[0]?.description).toHaveLength(
      SEARCH_RESULT_LIMITS.maxImageDescriptionChars,
    );
    expect(images[0]?.sourceUrl).toBe("https://example.com/article");
    expect(images[1]?.url).toBe("https://127.0.0.1/private.png");
  });

  it("accepts provider image URL strings and drops unsafe source pages", () => {
    expect(
      normalizeImageSources([
        "https://example.com/image.png",
        {
          url: "https://example.com/other.png",
          sourceUrl: "javascript:alert(1)",
        },
      ]),
    ).toEqual([
      { url: "https://example.com/image.png" },
      { url: "https://example.com/other.png" },
    ]);
  });
});
