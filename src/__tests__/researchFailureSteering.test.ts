import { expect, it, vi } from "vitest";
import type { ResearchExecutionContext } from "@/lib/research/runtime/executionContext";

const publish = vi.hoisted(() => vi.fn(async () => ["Interrupted"]));
vi.mock("@/lib/research/runtime/reportPublication", () => ({
  publishResearchReportVersion: publish,
}));
vi.mock("@/lib/research", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildDeterministicSalvageReport: () => "# Preserved findings",
  auditResearchReport: () => ({
    blocking: [],
    advisory: [],
    unknownCitationCount: 0,
    unsupportedFindingCount: 0,
    missingSectionCount: 0,
  }),
}));
import { handleExecutionFailure } from "@/lib/research/runtime/stages/failure";

it("keeps accepted unanswered questions in a salvage report's gaps", async () => {
  const ctx = {
    taskId: "task",
    store: {
      tasksById: { task: { status: "researching" } },
      setActiveTask: vi.fn(),
    },
    controller: new AbortController(),
    run: {
      nodes: [
        { id: "original", status: "completed", claimIds: ["verified"] },
        { id: "added", status: "pending", claimIds: [] },
      ],
    },
    evidence: [],
    steeringRecord: {
      commands: [
        {
          status: "applied",
          intent: {
            kind: "add",
            nodeId: "added",
            question: "What happens if storage fails?",
          },
        },
      ],
    },
    t: (key: string) => key,
    localizedRuntimeError: () => "Source unavailable",
  } as unknown as ResearchExecutionContext;
  await handleExecutionFailure(ctx, new Error("Source unavailable"));
  expect(publish).toHaveBeenCalledWith(
    expect.objectContaining({
      extraGaps: [
        "runtime.gaps.executionInterrupted",
        "Source unavailable",
        "What happens if storage fails?",
      ],
    }),
  );
});
