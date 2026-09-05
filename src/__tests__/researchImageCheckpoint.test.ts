import { beforeEach, describe, expect, it, vi } from "vitest";
import { readCheckpoint } from "@/lib/research/runtime/checkpointStorage";
import type { ResearchTask } from "@/lib/research/types";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/research/runtime/readLocalResearchJson", () => ({
  readResearchCheckpointJson: read,
}));

const task = {
  id: "task",
  sessionId: "session",
  checkpoint: { historyPath: "research/checkpoints/wave.json" },
} as ResearchTask;
const checkpoint = { version: 1, taskId: task.id, savedAt: 1, toolCalls: [] };

beforeEach(() => vi.clearAllMocks());

describe("research image checkpoint recovery", () => {
  it("retains images accumulated across more than one search page", async () => {
    const images = Array.from({ length: 45 }, (_, index) => ({
      id: `image-${index}`,
      url: `https://example.com/image-${index}.png`,
      sourceUrl: `https://example.com/source-${index}`,
      retrievedAt: index,
      researchRunId: "run",
    }));
    read.mockResolvedValue({
      ok: true,
      value: { ...checkpoint, imageSources: images },
    });
    const restored = await readCheckpoint(task);
    expect(restored?.imageSources).toEqual(images);
    expect(restored?.toolCalls).toEqual([]);
    expect(restored?.outputBlocks).toEqual([]);
  });

  it("reads older checkpoints with an empty image collection", async () => {
    read.mockResolvedValue({ ok: true, value: checkpoint });
    expect((await readCheckpoint(task))?.imageSources).toEqual([]);
  });

  it("drops unsafe or malformed image records during recovery", async () => {
    read.mockResolvedValue({
      ok: true,
      value: {
        ...checkpoint,
        imageSources: [
          {
            id: "unsafe",
            url: "javascript:alert(1)",
            retrievedAt: 1,
            researchRunId: "run",
          },
          {
            id: " ",
            url: "https://example.com/image.png",
            retrievedAt: 1,
            researchRunId: "run",
          },
          {
            id: "bad-time",
            url: "https://example.com/image.png",
            retrievedAt: -1,
            researchRunId: "run",
          },
        ],
      },
    });
    expect((await readCheckpoint(task))?.imageSources).toEqual([]);
  });
});
