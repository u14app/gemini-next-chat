import { createResearchTaskRepository } from "./taskRepository";
import type { BuiltinResearchEmitters } from "@/services/api/chat/builtinTools/types";

let repository: ReturnType<typeof createResearchTaskRepository> | null = null;
let toolEmitters: BuiltinResearchEmitters | null = null;

export function getResearchTaskRepository() {
  if (!repository) repository = createResearchTaskRepository();
  return repository;
}

export function registerResearchToolEmitters(
  emitters: BuiltinResearchEmitters,
): () => void {
  if (toolEmitters) {
    throw new Error("Deep Research tool emitters are already registered.");
  }
  toolEmitters = emitters;
  return () => {
    if (toolEmitters === emitters) toolEmitters = null;
  };
}

export function getResearchToolEmitters(): BuiltinResearchEmitters | undefined {
  return toolEmitters || undefined;
}
