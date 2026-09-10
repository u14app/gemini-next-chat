"use client";

import { useEffect, useSyncExternalStore } from "react";

type Snapshot<T> = { value: T | null; error: unknown };

/** One shared import per capability; only its consumers subscribe to changes. */
export function createExtensionResource<T>(importModule: () => Promise<T>) {
  const initial: Snapshot<T> = { value: null, error: null };
  let snapshot = initial;
  let promise: Promise<T> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: Snapshot<T>) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const load = (): Promise<T> => {
    promise ??= importModule().then(
      (value) => {
        publish({ value, error: null });
        return value;
      },
      (error: unknown) => {
        publish({ value: null, error });
        throw error;
      },
    );
    return promise;
  };
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    retry: () => {
      promise = null;
      publish(initial);
      void load().catch(() => {});
    },
  };
}

export function useExtension<T>(
  resource: ReturnType<typeof createExtensionResource<T>>,
  enabled = true,
) {
  const state = useSyncExternalStore(
    enabled ? resource.subscribe : () => () => {},
    enabled ? resource.getSnapshot : resource.getServerSnapshot,
    resource.getServerSnapshot,
  );
  useEffect(() => {
    if (enabled) void resource.load().catch(() => {});
  }, [enabled, resource]);
  return state;
}

export const gfmResource = createExtensionResource(
  () => import("./gfmExtension"),
);
export const mathSyntaxResource = createExtensionResource(
  () => import("remark-math"),
);
export const htmlResource = createExtensionResource(
  () => import("./htmlExtension"),
);
export const mathRenderResource = createExtensionResource(
  () => import("./mathExtension"),
);
export const highlightResource = createExtensionResource(
  () => import("./highlightExtension"),
);
export const artifactResource = createExtensionResource(
  () => import("./ArtifactBlock"),
);
export const diagramResource = createExtensionResource(
  () => import("./DiagramBlock"),
);
export const chartResource = createExtensionResource(
  () => import("./ChartBlock"),
);
export const fileResource = createExtensionResource(() => import("./FileCard"));
export const citationResource = createExtensionResource(
  () => import("./CitationLink"),
);
export const imageResource = createExtensionResource(
  () => import("./MarkdownImage"),
);

export const readOnlyCodeResource = createExtensionResource(
  () => import("./ReadOnlyCodeBlock"),
);
