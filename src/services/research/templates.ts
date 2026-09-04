import { v7 as uuidv7 } from "uuid";

import {
  cloneResearchTemplate,
  createResearchTemplateFromPlan,
  getBuiltinResearchTemplate,
  getBuiltinResearchTemplates,
  isResearchTemplateId,
  localizeResearchTemplate,
  normalizeResearchTemplate,
  normalizeResearchTemplateId,
  RESEARCH_TEMPLATE_SCHEMA_VERSION,
  type CreateResearchTemplateInput,
  type ResearchTaskTemplateSnapshot,
  type ResearchTemplate,
  type ResearchTemplateSelection,
  type UpdateResearchTemplateInput,
} from "@/lib/research/templates";
import { resolveResearchStrategy } from "@/lib/research/orchestration";
import {
  getResearchExtensionRepository,
  type ResearchExtensionRecord,
} from "./extensionRepository";

export type {
  CreateResearchTemplateInput,
  ResearchTaskTemplateSnapshot,
  ResearchTemplate,
  ResearchTemplateId,
  ResearchTemplateSelection,
  UpdateResearchTemplateInput,
} from "@/lib/research/templates";

function normalizedTemplateForWrite(value: ResearchTemplate): ResearchTemplate {
  const normalized = normalizeResearchTemplate(value);
  if (!normalized) throw new Error("The research template is invalid.");
  if (normalized.builtIn || isResearchTemplateId(normalized.id)) {
    throw new Error(
      "Built-in research templates must be copied before editing.",
    );
  }
  return normalized;
}

function templateRecordToValue(
  record: ResearchExtensionRecord<unknown>,
): ResearchTemplate | null {
  return normalizeResearchTemplate(record.value);
}

export async function listResearchTemplates(): Promise<ResearchTemplate[]> {
  const repository = getResearchExtensionRepository();
  let records: ResearchExtensionRecord<unknown>[] = [];
  try {
    records = await repository.list<unknown>("template");
  } catch {
    // Reads may be unavailable. Built-ins remain usable without persistence.
  }
  const templates = new Map<string, ResearchTemplate>(
    getBuiltinResearchTemplates().map((template) => [template.id, template]),
  );
  for (const record of records) {
    const template = templateRecordToValue(record);
    if (!template || template.builtIn || isResearchTemplateId(template.id)) {
      continue;
    }
    templates.set(template.id, template);
  }
  return [...templates.values()].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}

export async function getResearchTemplate(
  id: string,
): Promise<ResearchTemplate | null> {
  const builtin = getBuiltinResearchTemplate(id);
  if (builtin) return builtin;
  try {
    const value = await getResearchExtensionRepository().get<unknown>(
      "template",
      id,
    );
    return normalizeResearchTemplate(value);
  } catch {
    return null;
  }
}

export async function createResearchTemplate(
  input: CreateResearchTemplateInput,
): Promise<ResearchTemplate> {
  const now = input.now ?? Date.now();
  const id = normalizeResearchTemplateId(input.id) || uuidv7();
  if (isResearchTemplateId(id)) {
    throw new Error("A built-in research template cannot be replaced.");
  }
  const template = normalizedTemplateForWrite({
    schemaVersion: RESEARCH_TEMPLATE_SCHEMA_VERSION,
    id,
    name: input.name,
    description: input.description,
    deliverableKind: input.deliverableKind,
    requiredSections: input.requiredSections,
    sourcePriorities: input.sourcePriorities,
    strategy: resolveResearchStrategy("standard", input.strategy),
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
  await getResearchExtensionRepository().put("template", template.id, template);
  return cloneResearchTemplate(template);
}

export async function updateResearchTemplate(
  id: string,
  patch: UpdateResearchTemplateInput,
): Promise<ResearchTemplate> {
  if (isResearchTemplateId(id)) {
    throw new Error(
      "Built-in research templates must be copied before editing.",
    );
  }
  const repository = getResearchExtensionRepository();
  const next = await repository.update<unknown>("template", id, (value) => {
    const current = normalizeResearchTemplate(value);
    if (!current) throw new Error("The research template was not found.");
    if (current.builtIn) {
      throw new Error(
        "Built-in research templates must be copied before editing.",
      );
    }
    const next = normalizedTemplateForWrite({
      schemaVersion: RESEARCH_TEMPLATE_SCHEMA_VERSION,
      id: current.id,
      name: patch.name ?? current.name,
      description: patch.description ?? current.description,
      deliverableKind: patch.deliverableKind ?? current.deliverableKind,
      requiredSections: patch.requiredSections ?? current.requiredSections,
      sourcePriorities: patch.sourcePriorities ?? current.sourcePriorities,
      strategy: resolveResearchStrategy("standard", {
        ...current.strategy,
        ...(patch.strategy || {}),
      }),
      revision: current.revision + 1,
      ...(typeof current.createdAt === "number"
        ? { createdAt: current.createdAt }
        : {}),
      updatedAt: Date.now(),
    });
    return next;
  });
  const normalized = normalizeResearchTemplate(next);
  if (!normalized) throw new Error("The research template could not be saved.");
  return cloneResearchTemplate(normalized);
}

export async function deleteResearchTemplate(id: string): Promise<void> {
  const current = await getResearchTemplate(id);
  if (!current) return;
  if (current.builtIn) {
    throw new Error("Built-in research templates cannot be deleted.");
  }
  await getResearchExtensionRepository().remove("template", id);
}

export async function duplicateResearchTemplate(
  id: string,
  overrides: Partial<CreateResearchTemplateInput> = {},
): Promise<ResearchTemplate> {
  const current = await getResearchTemplate(id);
  if (!current) throw new Error("The research template was not found.");
  return createResearchTemplate({
    name: overrides.name || `${current.name} copy`,
    description: overrides.description || current.description,
    deliverableKind: overrides.deliverableKind || current.deliverableKind,
    requiredSections: overrides.requiredSections || current.requiredSections,
    sourcePriorities: overrides.sourcePriorities || current.sourcePriorities,
    strategy: overrides.strategy || current.strategy,
    now: overrides.now,
    id: overrides.id,
  });
}

export async function freezeResearchTaskTemplate(
  taskId: string,
  template: ResearchTemplateSelection,
  capturedAt = Date.now(),
  locale?: string,
): Promise<ResearchTaskTemplateSnapshot> {
  if (!taskId.trim()) throw new Error("taskId must not be empty.");
  const next =
    await getResearchExtensionRepository().update<ResearchTaskTemplateSnapshot>(
      "task_template",
      taskId,
      (current) => {
        const currentTemplate = current?.template
          ? normalizeResearchTemplate(current.template)
          : current?.template === null
            ? null
            : undefined;
        if (
          current &&
          typeof current === "object" &&
          typeof current.capturedAt === "number" &&
          Number.isFinite(current.capturedAt) &&
          currentTemplate !== undefined
        ) {
          return {
            template: currentTemplate
              ? cloneResearchTemplate(currentTemplate)
              : null,
            capturedAt: current.capturedAt,
          };
        }
        return {
          template: template
            ? localizeResearchTemplate(template, locale)
            : null,
          capturedAt,
        };
      },
      { taskId },
    );
  if (!next) throw new Error("The task template snapshot could not be saved.");
  return {
    template: next.template ? cloneResearchTemplate(next.template) : null,
    capturedAt: next.capturedAt,
  };
}

export async function getFrozenResearchTaskTemplate(
  taskId: string,
): Promise<ResearchTaskTemplateSnapshot | null> {
  try {
    const value = await getResearchExtensionRepository().get<unknown>(
      "task_template",
      taskId,
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const raw = value as Record<string, unknown>;
    if (
      typeof raw.capturedAt !== "number" ||
      !Number.isFinite(raw.capturedAt)
    ) {
      return null;
    }
    const template =
      raw.template === null ? null : normalizeResearchTemplate(raw.template);
    if (raw.template !== null && !template) return null;
    return { template, capturedAt: raw.capturedAt };
  } catch {
    return null;
  }
}

export {
  createResearchTemplateFromPlan,
  getBuiltinResearchTemplate,
  getBuiltinResearchTemplates,
};
