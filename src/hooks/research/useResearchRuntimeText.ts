import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";

import type {
  ResearchRuntimeErrorText,
  ResearchTranslate,
} from "@/lib/research/runtime/executionContext";
import type { ResearchDependencyText } from "@/lib/research/runtime/taskContext";

/**
 * The localized strings the runtime needs outside React: one translator shared
 * by every runtime hook, plus the two lookup helpers threaded into the modules
 * under `runtime/`.
 */
export function useResearchRuntimeText(): {
  t: ResearchTranslate;
  localizedRuntimeError: ResearchRuntimeErrorText;
  dependencyText: ResearchDependencyText;
} {
  const t = useTranslations("Research");
  const localizedRuntimeError = useCallback<ResearchRuntimeErrorText>(
    (error, fallbackKey) =>
      error instanceof Error && error.message === t("runtime.error.persistence")
        ? error.message
        : t(`runtime.error.${fallbackKey}`),
    [t],
  );
  const dependencyText = useMemo(
    () => ({
      offline: t("runtime.dependency.offline"),
      modelUnavailable: t("runtime.dependency.modelUnavailable"),
      toolCallingUnavailable: t("runtime.dependency.toolCallingUnavailable"),
      searchUnavailable: t("runtime.dependency.searchUnavailable"),
      searchDisabled: t("runtime.dependency.searchDisabled"),
      checkpointUnavailable: t("runtime.dependency.checkpointUnavailable"),
      sourceUnavailable: (source: string) =>
        t("runtime.dependency.sourceUnavailable", { source }),
    }),
    [t],
  );
  return { t, localizedRuntimeError, dependencyText };
}
