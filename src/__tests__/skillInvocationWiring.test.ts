import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function countOccurrences(source: string, needle: string) {
  return source.split(needle).length - 1;
}

describe("skill invocation wiring", () => {
  it("passes skills context through every ChatApp response generation path", () => {
    // The generation paths live in ChatApp's extracted flow hooks; read them
    // together so the per-path counts below still cover every path.
    const chatApp = [
      "src/components/app/ChatApp.tsx",
      "src/hooks/useSendMessageFlow.ts",
      "src/hooks/useResponseBranchFlow.ts",
      "src/hooks/useMessageEditFlow.ts",
    ]
      .map((path) => readFileSync(resolve(process.cwd(), path), "utf8"))
      .join("\n");

    const streamCallCount = countOccurrences(chatApp, "streamChatResponse(");

    expect(streamCallCount).toBeGreaterThan(0);
    expect(countOccurrences(chatApp, "resolveSkillsForMessage({")).toBe(
      streamCallCount - 1,
    );
    expect(chatApp).toContain("continuationSkillContext");
    expect(countOccurrences(chatApp, "skillResolution.context")).toBe(
      streamCallCount - 1,
    );
    expect(
      chatApp.match(
        /autoSelect:\s*skillAutoSelect && !effectiveContext\.orchestratedModeEnabled/g,
      ) || [],
    ).toHaveLength(streamCallCount - 1);
    expect(
      countOccurrences(
        chatApp,
        "activeSkillIds: effectiveContext.orchestratedModeEnabled",
      ),
    ).toBe(streamCallCount - 1);
    expect(chatApp).toContain(
      "skillAutoSelect && !effectiveContext.orchestratedModeEnabled",
    );
    // Continuation has no new Skill resolution, but resumes the same AgentRun.
    expect(countOccurrences(chatApp, "createAgentToolStreamOptions({")).toBe(
      streamCallCount,
    );
    // The stream-option callbacks moved into the shared preparation hook.
    const requestPreparation = readFileSync(
      resolve(process.cwd(), "src/hooks/useChatRequestPreparation.ts"),
      "utf8",
    );
    expect(requestPreparation).toContain("onKnowledgeSources:");
    expect(requestPreparation).toContain("onSkillInvocation:");
    expect(requestPreparation).toContain(
      "skillAutoSelect || effectiveContext.orchestratedModeEnabled",
    );
    expect(chatApp).toContain("processedData.knowledgeScope");
  });
});
