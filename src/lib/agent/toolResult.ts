import type { ToolEffectReceipt } from "./run";

export type ToolResultTrust = "internal" | "user" | "external_untrusted";

export interface ToolResultProvenance {
  origin: "runtime" | "builtin" | "plugin" | "mcp";
  toolName: string;
  sourceUris?: string[];
  retrievedAt?: number;
}

export interface ToolResultArtifactReference {
  kind: "artifact" | "workspace_file";
  id: string;
  title?: string;
  contentHash?: string;
}

export interface ToolResultError {
  code: string;
  message: string;
  recoverable: boolean;
  effectUnknown?: boolean;
}

interface ToolResultEnvelopeBase {
  trust: ToolResultTrust;
  provenance: ToolResultProvenance;
  summary?: string;
  artifacts?: ToolResultArtifactReference[];
}

export type ToolResultEnvelope<T = unknown> =
  | (ToolResultEnvelopeBase & {
      ok: true;
      data: T;
      receipt?: ToolEffectReceipt;
    })
  | (ToolResultEnvelopeBase & {
      ok: false;
      error: ToolResultError;
    });

export interface NormalizeToolResultOptions {
  trust: ToolResultTrust;
  provenance: ToolResultProvenance;
  summary?: string;
  receipt?: ToolEffectReceipt;
  artifacts?: ToolResultArtifactReference[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeError(value: unknown): ToolResultError {
  if (typeof value === "string") {
    return {
      code: "TOOL_EXECUTION_FAILED",
      message: value.slice(0, 4_000),
      recoverable: false,
    };
  }
  if (isRecord(value)) {
    return {
      code:
        typeof value.code === "string" && value.code.trim()
          ? value.code.trim().slice(0, 160)
          : "TOOL_EXECUTION_FAILED",
      message:
        typeof value.message === "string" && value.message.trim()
          ? value.message.trim().slice(0, 4_000)
          : "The tool returned an error.",
      recoverable: value.recoverable === true,
      ...(value.effectUnknown === true ? { effectUnknown: true } : {}),
    };
  }
  return {
    code: "TOOL_EXECUTION_FAILED",
    message: "The tool returned an error.",
    recoverable: false,
  };
}

export function isToolResultEnvelope(
  value: unknown,
): value is ToolResultEnvelope {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  if (!isRecord(value.provenance) || typeof value.trust !== "string") {
    return false;
  }
  return value.ok ? "data" in value : isRecord(value.error);
}

/** Adds trust and provenance to explicitly discriminated execution results. */
export function normalizeToolResultEnvelope<T = unknown>(
  value: T,
  options: NormalizeToolResultOptions,
): ToolResultEnvelope<unknown> {
  const base: ToolResultEnvelopeBase = {
    trust: options.trust,
    provenance: { ...options.provenance },
    ...(options.summary ? { summary: options.summary } : {}),
    ...(options.artifacts?.length
      ? { artifacts: options.artifacts.map((artifact) => ({ ...artifact })) }
      : {}),
  };

  if (isToolResultEnvelope(value)) {
    return value.ok
      ? {
          ...base,
          ok: true,
          data: value.data,
          ...(options.receipt ? { receipt: { ...options.receipt } } : {}),
        }
      : { ...base, ok: false, error: normalizeError(value.error) };
  }

  if (isRecord(value) && value.ok === false && "error" in value) {
    return { ...base, ok: false, error: normalizeError(value.error) };
  }

  const data =
    isRecord(value) && value.ok === true
      ? Object.fromEntries(
          Object.entries(value).filter(([key]) => key !== "ok"),
        )
      : value;

  return {
    ...base,
    ok: true,
    data,
    ...(options.receipt ? { receipt: { ...options.receipt } } : {}),
  };
}

export function isToolResultFailure(
  value: unknown,
): value is Extract<ToolResultEnvelope, { ok: false }> {
  return isToolResultEnvelope(value) && !value.ok;
}
