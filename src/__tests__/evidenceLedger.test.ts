import { describe, expect, it } from "vitest";

import {
  createEvidenceSource,
  collectAgentEvidenceRecords,
  getEvidenceMetadata,
} from "../lib/agent/evidence";

describe("Evidence metadata", () => {
  it("uses stable source IDs for the same URL and content", async () => {
    const source = {
      title: "Specification",
      url: "https://example.com/spec",
      content: "Versioned source content",
    };
    const first = await createEvidenceSource(source, {
      kind: "fetch",
      retrievedAt: 100,
    });
    const second = await createEvidenceSource(source, {
      kind: "fetch",
      retrievedAt: 200,
    });

    expect(getEvidenceMetadata(first)).toMatchObject({
      sourceId: expect.stringMatching(/^source-/),
      retrievedAt: 100,
      retrievalKind: "fetch",
      externalUntrusted: true,
      contentHash: expect.stringMatching(/^(?:sha256|fnv1a):/),
    });
    expect(getEvidenceMetadata(second)?.sourceId).toBe(
      getEvidenceMetadata(first)?.sourceId,
    );
  });

  it("changes source identity when retrieved content changes", async () => {
    const first = await createEvidenceSource(
      { title: "Page", url: "https://example.com", content: "before" },
      { kind: "search" },
    );
    const second = await createEvidenceSource(
      { title: "Page", url: "https://example.com", content: "after" },
      { kind: "search" },
    );

    expect(getEvidenceMetadata(first)?.sourceId).not.toBe(
      getEvidenceMetadata(second)?.sourceId,
    );
  });

  it("collects only traceable sources from nested Tool results", async () => {
    const source = await createEvidenceSource(
      { title: "Page", url: "https://example.com", content: "evidence" },
      { kind: "search", retrievedAt: 100 },
    );

    expect(
      collectAgentEvidenceRecords(
        { sources: [source], ignored: { url: "https://unfetched.example" } },
        { toolCallId: "call-1", defaultKind: "search" },
      ),
    ).toEqual([
      expect.objectContaining({
        sourceId: expect.stringMatching(/^source-/),
        url: "https://example.com",
        retrievalKind: "search",
        toolCallId: "call-1",
      }),
    ]);
  });
});
