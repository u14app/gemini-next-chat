import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSuppressedMemoryIds } from "../lib/memory/compression";
import { CONTEXT_COMPRESSION_LIMITS } from "../config/limits";
import type { Message, Session } from "../types";

const message = (
  id: string,
  role: Message["role"],
  memoryIds: string[] = [],
): Message => ({
  id,
  role,
  content: id,
  timestamp: 1,
  ...(memoryIds.length
    ? {
        memoryContext: {
          injectedMemoryIds: memoryIds,
          promptContext: `memory for ${id}`,
        },
      }
    : {}),
});

describe("memory suppression across compression", () => {
  it("uses the legacy session set before compression exists", () => {
    const session = {
      memoryContext: { injectedMemoryIds: ["legacy"] },
    } as Session;

    expect(getSuppressedMemoryIds(session, [])).toEqual(["legacy"]);
  });

  it("keeps only ids represented by the summary, first user message, and raw tail", () => {
    const messages = [
      message("first", "user", ["first-memory"]),
      message("compressed-end", "model"),
      message("tail", "user", ["tail-memory"]),
    ];
    const session = {
      compression: {
        compressedContent: "summary",
        lastCompressedMessageId: "compressed-end",
        includedMemoryIds: ["summary-memory"],
      },
      memoryContext: {
        injectedMemoryIds: ["stale-memory", "first-memory", "tail-memory"],
      },
    } as Session;

    expect(getSuppressedMemoryIds(session, messages)).toEqual([
      "summary-memory",
      "first-memory",
      "tail-memory",
    ]);
  });

  it("does not suppress ids from oversized legacy summary content that is trimmed away", () => {
    const messages = [
      message("first", "user"),
      message("compressed-end", "model"),
    ];
    const session = {
      compression: {
        compressedContent: "x".repeat(
          CONTEXT_COMPRESSION_LIMITS.maxCompressedContentChars + 1,
        ),
        lastCompressedMessageId: "compressed-end",
        includedMemoryIds: ["trimmed-summary-memory"],
      },
    } as Session;

    expect(getSuppressedMemoryIds(session, messages)).toEqual([]);
  });

  it("wires represented memory ids into persisted compression state", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/services/api/chat/compression.ts"),
      "utf8",
    );

    expect(source).toContain("buildCompressionSource(messagesToCompress)");
    expect(source).toContain("normalizeCompressedContentWithMemoryIds({");
    expect(source).toContain(
      "oldIncludedMemoryIds = normalizedPrevious.representedMemoryIds",
    );
    expect(source).toContain(
      "includedMemoryIds: mergedCompression.representedMemoryIds",
    );
  });
});
