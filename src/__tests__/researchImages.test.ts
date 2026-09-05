import { describe, expect, it } from "vitest";

import {
  formatResearchImageCatalog,
  getResearchImageSourceId,
  mergeResearchImageSources,
  normalizeResearchImageSources,
  type ResearchImageSource,
} from "@/lib/research";

const firstImage: ResearchImageSource = {
  id: "research-image-first",
  url: "https://cdn.example.com/figure.png?b=2&a=1",
  description: "A figure [with] a caption",
  sourceUrl: "https://example.com/article",
  retrievedAt: 100,
  researchRunId: "run-1",
};

describe("research image materials", () => {
  it("normalizes provider images into stable, run-associated records", () => {
    const images = normalizeResearchImageSources(
      [
        {
          url: "https://cdn.example.com/figure.png?a=1&b=2",
          description: "Figure",
          source_url: "https://example.com/article",
        },
        {
          url: "https://cdn.example.com/figure.png?b=2&a=1",
          description: "Duplicate",
        },
        { url: "http://cdn.example.com/insecure.png" },
      ],
      "run-1",
      123,
    );

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      id: getResearchImageSourceId({
        url: "https://cdn.example.com/figure.png?a=1&b=2",
      }),
      url: "https://cdn.example.com/figure.png?a=1&b=2",
      description: "Figure",
      sourceUrl: "https://example.com/article",
      retrievedAt: 123,
      researchRunId: "run-1",
    });
  });

  it("merges by canonical URL while preserving discovery provenance", () => {
    expect(
      mergeResearchImageSources(
        [firstImage],
        [
          {
            ...firstImage,
            id: "research-image-new-run",
            description: "Updated caption",
            sourceUrl: undefined,
            retrievedAt: 200,
            researchRunId: "run-2",
          },
          {
            ...firstImage,
            id: "research-image-second",
            url: "https://cdn.example.com/second.png",
            retrievedAt: 201,
            researchRunId: "run-2",
          },
        ],
      ),
    ).toEqual([
      {
        ...firstImage,
        description: "Updated caption",
        retrievedAt: 200,
      },
      {
        ...firstImage,
        id: "research-image-second",
        url: "https://cdn.example.com/second.png",
        retrievedAt: 201,
        researchRunId: "run-2",
      },
    ]);
  });

  it("serializes an allow-listed catalog for report prompts", () => {
    const catalog = formatResearchImageCatalog([firstImage]);
    expect(JSON.parse(catalog)).toEqual([
      {
        id: firstImage.id,
        url: firstImage.url,
        description: firstImage.description,
        sourceUrl: firstImage.sourceUrl,
        retrievedAt: firstImage.retrievedAt,
        researchRunId: firstImage.researchRunId,
      },
    ]);
  });
});
