"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  BUILTIN_RESEARCH_TEMPLATES,
  createResearchTemplateFromPlan,
  type ResearchTemplate,
} from "@/lib/research/templates";
import {
  createResearchTemplate,
  deleteResearchTemplate,
  duplicateResearchTemplate,
  getResearchTemplate,
  listResearchTemplates,
  updateResearchTemplate,
  type CreateResearchTemplateInput,
  type UpdateResearchTemplateInput,
} from "@/services/research/templates";
import { subscribeResearchExtensions } from "@/services/research/extensionRepository";
import type { ResearchPlanDraftV2 } from "@/lib/research/prompts/types";

export interface UseResearchTemplatesResult {
  templates: ResearchTemplate[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (input: CreateResearchTemplateInput) => Promise<ResearchTemplate>;
  update: (
    id: string,
    patch: UpdateResearchTemplateInput,
  ) => Promise<ResearchTemplate>;
  duplicate: (
    id: string,
    overrides?: Partial<CreateResearchTemplateInput>,
  ) => Promise<ResearchTemplate>;
  remove: (id: string) => Promise<void>;
  saveFromPlan: (
    plan: Pick<ResearchPlanDraftV2, "deliverable" | "strategy" | "steps">,
    input: Pick<CreateResearchTemplateInput, "name" | "description">,
  ) => Promise<ResearchTemplate>;
  get: (id: string) => Promise<ResearchTemplate | null>;
}

function cloneBuiltins(): ResearchTemplate[] {
  return BUILTIN_RESEARCH_TEMPLATES.map((template) => ({
    ...template,
    requiredSections: [...template.requiredSections],
    sourcePriorities: template.sourcePriorities.map((priority) => ({
      ...priority,
    })),
    strategy: { ...template.strategy },
  }));
}

export function useResearchTemplates(): UseResearchTemplatesResult {
  const [templates, setTemplates] = useState<ResearchTemplate[]>(cloneBuiltins);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (mountedRef.current) setIsLoading(true);
    try {
      const next = await listResearchTemplates();
      if (mountedRef.current) {
        setTemplates(next);
        setError(null);
      }
    } catch (reason) {
      if (mountedRef.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const unsubscribe = subscribeResearchExtensions(() => {
      if (mountedRef.current) void refresh();
    });
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [refresh, mountedRef]);

  const runMutation = useCallback(
    async <T>(mutation: () => Promise<T>): Promise<T> => {
      try {
        const result = await mutation();
        if (mountedRef.current) setError(null);
        await refresh();
        return result;
      } catch (reason) {
        const message =
          reason instanceof Error ? reason.message : String(reason);
        if (mountedRef.current) setError(message);
        throw reason;
      }
    },
    [refresh],
  );

  const create = useCallback(
    (input: CreateResearchTemplateInput) =>
      runMutation(() => createResearchTemplate(input)),
    [runMutation],
  );
  const update = useCallback(
    (id: string, patch: UpdateResearchTemplateInput) =>
      runMutation(() => updateResearchTemplate(id, patch)),
    [runMutation],
  );
  const duplicate = useCallback(
    (id: string, overrides?: Partial<CreateResearchTemplateInput>) =>
      runMutation(() => duplicateResearchTemplate(id, overrides)),
    [runMutation],
  );
  const remove = useCallback(
    (id: string) => runMutation(() => deleteResearchTemplate(id)),
    [runMutation],
  );
  const saveFromPlan = useCallback(
    (
      plan: Pick<ResearchPlanDraftV2, "deliverable" | "strategy" | "steps">,
      input: Pick<CreateResearchTemplateInput, "name" | "description">,
    ) =>
      runMutation(() =>
        createResearchTemplate(createResearchTemplateFromPlan(plan, input)),
      ),
    [runMutation],
  );
  const get = useCallback((id: string) => getResearchTemplate(id), []);

  return {
    templates,
    isLoading,
    error,
    refresh,
    create,
    update,
    duplicate,
    remove,
    saveFromPlan,
    get,
  };
}

export default useResearchTemplates;
