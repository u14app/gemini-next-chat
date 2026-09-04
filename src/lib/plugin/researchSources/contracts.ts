import type { Plugin, PluginConfig } from "@/types";
import type {
  ResearchSourceSnapshot,
  ResearchTask,
} from "@/lib/research/types";
import { createPluginFunctionFingerprint } from "../confirmation";
import { getEnabledPluginFunctions } from "../resolve";
import { getResearchExtensionRepository } from "@/services/research/extensionRepository";
import { isResearchSourceProvider, RESEARCH_SOURCE_FUNCTIONS } from "./catalog";

export type ResearchSourceContracts = Record<
  string,
  { pluginId: string; functionFingerprint: string }
>;
export async function freezeResearchSourceContracts(
  task: ResearchTask,
  snapshot: ResearchSourceSnapshot,
  plugins: Plugin[],
  configs: Record<string, PluginConfig>,
): Promise<void> {
  const providers = plugins.filter(
    (plugin) =>
      isResearchSourceProvider(plugin.id) &&
      snapshot.pluginIds.includes(plugin.id),
  );
  if (!providers.length) return;
  const repository = getResearchExtensionRepository();
  if (!repository.getStatus().durable)
    throw new Error(
      "Specialized research sources require persistent browser storage.",
    );
  const next: ResearchSourceContracts = {};
  for (const plugin of providers)
    for (const fn of getEnabledPluginFunctions(plugin, configs[plugin.id])) {
      if (snapshot.toolIds.includes(fn.name))
        next[fn.name] = {
          pluginId: plugin.id,
          functionFingerprint: await createPluginFunctionFingerprint(
            plugin,
            fn,
          ),
        };
    }
  const running = [
    "researching",
    "verifying",
    "synthesizing",
    "paused",
  ].includes(task.status);
  await repository.update<ResearchSourceContracts>(
    "source_contracts",
    task.id,
    (current) => (running ? { ...next, ...current } : next),
    { taskId: task.id, sessionId: task.sessionId },
  );
}
export async function getFrozenResearchSourceContracts(
  taskId: string,
  snapshot: ResearchSourceSnapshot,
): Promise<ResearchSourceContracts> {
  if (!snapshot.pluginIds.some(isResearchSourceProvider)) return {};
  const repository = getResearchExtensionRepository();
  if (!repository.getStatus().durable)
    throw new Error(
      "Specialized research sources require persistent browser storage.",
    );
  const contracts = await repository.get<ResearchSourceContracts>(
    "source_contracts",
    taskId,
  );
  if (!contracts)
    throw new Error(
      "Frozen source definitions are missing. Create a new approved research plan.",
    );
  for (const provider of snapshot.pluginIds.filter(isResearchSourceProvider)) {
    for (const name of Object.values(RESEARCH_SOURCE_FUNCTIONS[provider])) {
      if (
        snapshot.toolIds.includes(name) &&
        (!contracts[name]?.functionFingerprint ||
          contracts[name].pluginId !== provider)
      )
        throw new Error("Frozen source definition is missing.");
    }
  }
  return contracts;
}
export async function assertFrozenResearchSourceContracts(
  taskId: string,
  snapshot: ResearchSourceSnapshot,
  plugins: Plugin[],
): Promise<void> {
  const contracts = await getFrozenResearchSourceContracts(taskId, snapshot);
  for (const [name, contract] of Object.entries(contracts)) {
    if (
      !snapshot.toolIds.includes(name) ||
      !snapshot.pluginIds.includes(contract.pluginId)
    )
      continue;
    const plugin = plugins.find((p) => p.id === contract.pluginId);
    const fn = plugin?.functions.find((f) => f.name === name);
    if (
      !plugin ||
      !fn ||
      (await createPluginFunctionFingerprint(plugin, fn)) !==
        contract.functionFingerprint
    )
      throw new Error(
        `Source definition changed: ${name}. Create a new approved research plan.`,
      );
  }
}
