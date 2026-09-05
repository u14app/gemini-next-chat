import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createResearchTask } from "@/lib/research";
import { getOriginalResearchGenerationModel } from "@/lib/research/runtime/sourceSnapshot";

describe("Research model routing composition", () => {
  it("persists the request model before the first planning round", () => {
    const toolBridge = readFileSync(
      resolve(process.cwd(), "src/hooks/research/useResearchToolBridge.ts"),
      "utf8",
    );
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/research/runtime/preparePlan.ts"),
      "utf8",
    );

    expect(source).toContain("requestModel?: string");
    expect(source).toMatch(
      /resolveTaskContext\(\{\s*\.\.\.initial,\s*sourceSnapshot: provisionalSnapshot,?\s*\}\)/u,
    );
    expect(source).toMatch(
      /createSourceSnapshot\(\s*initial,\s*requestModel,?\s*\)/u,
    );
    expect(source).toContain("sourceSnapshot: provisionalSnapshot");
    expect(toolBridge.indexOf("requestModel: context.model")).toBeLessThan(
      toolBridge.indexOf("upsertTask(withRun)"),
    );
    expect(toolBridge).toContain(
      "void preparePlan(withRun.id, undefined, context.model)",
    );
  });

  it("recovers a legacy task model only from its linked original generation", () => {
    const task = createResearchTask({
      id: "legacy-task",
      sessionId: "session",
      cardMessageId: "model-message",
      goal: "Legacy research",
    });

    expect(
      getOriginalResearchGenerationModel(task, [
        {
          id: "other-model-message",
          role: "model",
          content: "",
          timestamp: 1,
          model: "Stale display label",
          generation: {
            status: "completed",
            requestId: "other-request",
            ownerDeviceId: "device",
            model: "provider:stale-session-model",
            attempt: 0,
            checkpointAt: 1,
          },
        },
        {
          id: "model-message",
          role: "model",
          content: "",
          timestamp: 2,
          model: "Original model display label",
          generation: {
            status: "interrupted",
            requestId: "original-request",
            ownerDeviceId: "device",
            model: "provider:original-request-model",
            attempt: 0,
            checkpointAt: 2,
          },
        },
      ]),
    ).toBe("provider:original-request-model");
    expect(getOriginalResearchGenerationModel(task, [])).toBeUndefined();
    expect(
      getOriginalResearchGenerationModel(task, [
        {
          id: "model-message",
          role: "model",
          content: "",
          timestamp: 3,
          model: "Display label is not a routing model",
        },
      ]),
    ).toBeUndefined();
  });

  it("archives after evidence commit, repairs once, and stops only after repeated degradation", () => {
    // The research pipeline, joined in the order it runs, so the ordering and
    // single-repair assertions below still describe one continuous flow.
    const source = [
      "src/lib/research/runtime/preparePlan.ts",
      "src/lib/research/runtime/prepareExecution.ts",
      "src/lib/research/runtime/wave/prepareWave.ts",
      "src/lib/research/runtime/wave/runWaveStream.ts",
      "src/lib/research/runtime/wave/archiveWave.ts",
      "src/lib/research/runtime/wave/integrateWave.ts",
      "src/lib/research/runtime/stages/verification.ts",
      "src/lib/research/runtime/stages/synthesis.ts",
    ]
      .map((path) => readFileSync(resolve(process.cwd(), path), "utf8"))
      .join("\n");

    // Prompt construction also estimates context size. Only these two call
    // sites dispatch archive/repair; researchWaveArchive exercises their runtime.
    expect(source.match(/await requestClosedBookArchive\(\{/gu)).toHaveLength(
      2,
    );
    expect(source).toMatch(
      /\.filter\(\s*isCommittedCheckpointToolCall,?\s*\)/u,
    );
    expect(source.indexOf("collectTaskEvidence({")).toBeLessThan(
      source.indexOf("buildResearchWaveArchivePrompt({"),
    );
    expect(source).toContain("const requestClosedBookArchive = async");
    expect(source).toContain("disableTools: true");
    expect(source).toContain("supportsStructuredOutput(modelMetadata)");
    expect(source).toContain("isStructuredOutputCapabilityError(error)");
    expect(source).toContain("nativeResponseFormatAvailable = false");
    expect(source).toContain("finalizeResearchWavePackets({");
    expect(source).toContain("packetStatus:");
    expect(source).toContain('code: "invalid_model_output"');
    expect(source).toContain("countTrailingDegradedWaves(ctx.run) >= 2");
    expect(source).toContain(
      'ctx.run.stopReason?.code !== "invalid_model_output"',
    );
  });

  it("uses the shared localized Tool-name resolver in Research activity", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/hooks/research/useResearchTaskViewModel.ts"),
      "utf8",
    );

    expect(source).toContain('useTranslations("Content")');
    expect(source).toContain("getBuiltinToolLabelKey(tool)");
    expect(source).toContain("contentT(labelKey)");
    expect(source).toContain("formatToolDisplayName(tool)");
  });
});
