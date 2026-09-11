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

function rejectServerLoad(): Promise<never> {
  return Promise.reject(
    new Error("Markdown extensions are loaded in the browser."),
  );
}

// These extensions already load only after mount; SSR uses their source
// fallbacks. Keep each browser check beside its import so Next can also remove
// the dependency from the SSR bundle without changing client cache/retry state.
export const gfmResource = createExtensionResource(() =>
  typeof window === "undefined" ? rejectServerLoad() : import("./gfmExtension"),
);
export const mathSyntaxResource = createExtensionResource(() =>
  typeof window === "undefined" ? rejectServerLoad() : import("remark-math"),
);
export const htmlResource = createExtensionResource(() =>
  typeof window === "undefined"
    ? rejectServerLoad()
    : import("./htmlExtension"),
);
export const mathRenderResource = createExtensionResource(() =>
  typeof window === "undefined"
    ? rejectServerLoad()
    : import("./mathExtension"),
);
export const highlightResource = createExtensionResource(() =>
  typeof window === "undefined"
    ? rejectServerLoad()
    : import("./highlightExtension"),
);
export const artifactResource = createExtensionResource(() =>
  typeof window === "undefined"
    ? rejectServerLoad()
    : import("./ArtifactBlock"),
);
export const diagramResource = createExtensionResource(() =>
  typeof window === "undefined" ? rejectServerLoad() : import("./DiagramBlock"),
);
export const chartResource = createExtensionResource(() =>
  typeof window === "undefined" ? rejectServerLoad() : import("./ChartBlock"),
);
export const fileResource = createExtensionResource(() =>
  typeof window === "undefined" ? rejectServerLoad() : import("./FileCard"),
);
export const citationResource = createExtensionResource(() =>
  typeof window === "undefined" ? rejectServerLoad() : import("./CitationLink"),
);
export const imageResource = createExtensionResource(() =>
  typeof window === "undefined"
    ? rejectServerLoad()
    : import("./MarkdownImage"),
);
export const readOnlyCodeResource = createExtensionResource(() =>
  typeof window === "undefined"
    ? rejectServerLoad()
    : import("./ReadOnlyCodeBlock"),
);
