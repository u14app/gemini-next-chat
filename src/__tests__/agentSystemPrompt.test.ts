import { describe, expect, it } from "vitest";
import {
  appendAgentSystemInstruction,
  buildAgentSystemInstruction,
} from "../lib/agent/systemPrompt";

describe("Agent system instruction", () => {
  it("mentions only capabilities that are actually offered", () => {
    const instruction = buildAgentSystemInstruction({
      toolNames: ["web_search", "run_javascript"],
      skillCatalogContext: "id: hidden-skill",
    });

    expect(instruction).toContain("web_search");
    expect(instruction).toContain("run_javascript");
    expect(instruction).toContain("Search iteratively");
    expect(instruction).not.toContain("update_task_plan");
    expect(instruction).not.toContain("load_skill");
    expect(instruction).not.toContain("hidden-skill");
  });

  it("deduplicates tool names and bounds skill discovery context", () => {
    const instruction = buildAgentSystemInstruction({
      toolNames: [" load_skill ", "load_skill"],
      skillCatalogContext: "x".repeat(20_000),
    });

    expect(instruction.match(/Available tools: load_skill/g)).toHaveLength(1);
    expect(instruction).toContain("<installed-skills>");
    expect(instruction.length).toBeLessThan(14_000);
  });

  it("requires complete task-plan snapshots through the final answer", () => {
    const instruction = buildAgentSystemInstruction({
      toolNames: ["update_task_plan"],
    });

    expect(instruction).toContain("immediately call update_task_plan again");
    expect(instruction).toContain("complete current snapshot");
    expect(instruction).toContain("no plan step pending or in progress");
  });

  it("allows only tools that the host successfully loads at runtime", () => {
    const instruction = buildAgentSystemInstruction({
      toolNames: ["search_tools", "load_tools"],
    });

    expect(instruction).toContain(
      "tools the host successfully makes available after load_tools",
    );
    expect(instruction).toContain(
      "may be used in subsequent calls in this run",
    );
    expect(instruction).toContain("never guess a provider tool name");
  });

  it("does not append Agent instructions when no tools are offered", () => {
    const instruction = buildAgentSystemInstruction({ toolNames: [] });

    expect(instruction).toBe("");
    expect(appendAgentSystemInstruction("Base", instruction)).toBe("Base");
  });
});
