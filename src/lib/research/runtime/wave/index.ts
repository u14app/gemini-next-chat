import type { ResearchReportRun } from "@/lib/research";

import type { ResearchExecutionContext } from "../executionContext";
import { archiveWave } from "./archiveWave";
import { integrateWave } from "./integrateWave";
import { prepareWave } from "./prepareWave";
import { runWaveStream } from "./runWaveStream";
import { persistWaveCheckpoint } from "./waveCheckpoint";
import type { ResearchWaveInput } from "./waveContext";

export { refreshExpansionSources } from "./refreshExpansionSources";
export type { ResearchWaveContext, ResearchWaveInput } from "./waveContext";

/**
 * One research wave: stream with tools, archive the result closed-book, then
 * integrate it. Any failure flushes a resumable checkpoint before rethrowing.
 */
export async function executeWave(
  ctx: ResearchExecutionContext,
  input: ResearchWaveInput,
): Promise<ResearchReportRun> {
  const wave = await prepareWave(ctx, input);
  if (!wave) return input.run;
  try {
    const collected = await runWaveStream(wave);
    const finalizedPackets = await archiveWave(wave, collected);
    return await integrateWave(wave, collected, finalizedPackets);
  } catch (error) {
    await persistWaveCheckpoint(wave).catch(() => undefined);
    await wave.checkpointQueue.catch(() => undefined);
    throw error;
  }
}
