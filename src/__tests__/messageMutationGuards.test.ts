import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("message mutation guards", () => {
  it("disables message-tree mutation controls during local generation", () => {
    const shell = readFileSync(
      resolve(process.cwd(), "src/components/app/ChatAppShell.tsx"),
      "utf8",
    );
    const messageItem = readFileSync(
      resolve(process.cwd(), "src/components/chat/MessageItem.tsx"),
      "utf8",
    );

    expect(shell).toMatch(
      /mutationsDisabled=\{\s*isGenerating \|\|\s*isActiveSessionLoading/,
    );
    expect(messageItem).toContain(
      "mutationActionsDisabled || currentBranchIndex === 0",
    );
    expect(messageItem).toContain(
      "mutationActionsDisabled ||\n                          currentBranchIndex === branchCount - 1",
    );
  });

  // The handler-level guards are asserted behaviorally in
  // messageMutationFlows.test.tsx.
});
