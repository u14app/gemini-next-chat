import { createAgentRunPersistence } from "./runPersistence";

let persistence: ReturnType<typeof createAgentRunPersistence> | null = null;

export function getAgentRunPersistence() {
  if (!persistence) persistence = createAgentRunPersistence();
  return persistence;
}

export function closeAgentRunPersistence(): void {
  persistence?.close();
  persistence = null;
}
