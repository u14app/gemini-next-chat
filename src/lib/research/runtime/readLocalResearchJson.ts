import { AGENT_WORKSPACE_LIMITS } from "@/config/limits";
import type { AgentRun, ToolResultReference } from "@/lib/agent/run";
import { resolveWorkspaceUrl } from "@/lib/agent/workspace";
import { resolveOPFSBlob } from "@/utils/opfs";
import { hashWorkspaceBlob } from "@/services/workspace/workspaceManifest";

export type ResearchLocalJsonResult =
  | { ok: true; value: unknown }
  | {
      ok: false;
      reason:
        | "scope_denied"
        | "missing"
        | "too_large"
        | "hash_mismatch"
        | "invalid_json";
    };

async function readLocalJson(
  sessionId: string,
  path: string,
  contentHash?: string,
  signal?: AbortSignal,
): Promise<ResearchLocalJsonResult> {
  signal?.throwIfAborted();
  const resolved = resolveWorkspaceUrl(sessionId, path);
  if (!resolved.ok || resolved.value.path !== path)
    return { ok: false, reason: "scope_denied" };
  try {
    const blob = await resolveOPFSBlob(resolved.value.url);
    signal?.throwIfAborted();
    if (!blob) return { ok: false, reason: "missing" };
    if (blob.size > AGENT_WORKSPACE_LIMITS.maxFileBytes)
      return { ok: false, reason: "too_large" };
    if (contentHash && (await hashWorkspaceBlob(blob)) !== contentHash)
      return { ok: false, reason: "hash_mismatch" };
    const text = await blob.text();
    signal?.throwIfAborted();
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    signal?.throwIfAborted();
    return { ok: false, reason: "invalid_json" };
  }
}

export function readResearchCheckpointJson(
  sessionId: string,
  path: string,
): Promise<ResearchLocalJsonResult> {
  if (!path.startsWith("research/checkpoints/"))
    return Promise.resolve({ ok: false, reason: "scope_denied" });
  return readLocalJson(sessionId, path);
}

/** The execution ledger, not a model-returned workspacePath, authorizes this read. */
export function readCommittedResearchToolResult({
  sessionId,
  run,
  callId,
  reference,
  signal,
}: {
  sessionId: string;
  run: AgentRun;
  callId: string;
  reference: ToolResultReference;
  signal?: AbortSignal;
}): Promise<ResearchLocalJsonResult> {
  const execution = run.toolExecutions.find(
    (item) => item.callId === callId && item.status === "committed",
  );
  if (
    run.sessionId !== sessionId ||
    reference.kind !== "workspace_file" ||
    !reference.contentHash ||
    !/^tool-results\/[a-zA-Z0-9_-]+\.json$/.test(reference.id) ||
    !execution?.resultRefs?.some(
      (item) =>
        item.kind === reference.kind &&
        item.id === reference.id &&
        item.contentHash === reference.contentHash,
    )
  ) {
    return Promise.resolve({ ok: false, reason: "scope_denied" });
  }
  return readLocalJson(sessionId, reference.id, reference.contentHash, signal);
}
