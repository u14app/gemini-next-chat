import type { Source } from "@/types";
import type { AgentEvidenceRecord } from "./run";

export interface EvidenceMetadata {
  sourceId: string;
  retrievedAt: number;
  contentHash: string;
  retrievalKind: "search" | "fetch" | "attachment" | "mcp";
  query?: string;
  externalUntrusted: true;
}

function fallbackHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function hashText(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) return `fnv1a:${fallbackHash(value)}`;
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export async function createEvidenceSource(
  source: Source,
  {
    kind,
    query,
    retrievedAt = Date.now(),
  }: {
    kind: EvidenceMetadata["retrievalKind"];
    query?: string;
    retrievedAt?: number;
  },
): Promise<Source> {
  const contentHash = await hashText(source.content);
  const identityHash = await hashText(`${source.url}\n${contentHash}`);
  const sourceId = `source-${identityHash.replace(/^[^:]+:/, "").slice(0, 20)}`;
  return {
    ...source,
    metadata: {
      ...(source.metadata || {}),
      sourceId,
      retrievedAt,
      contentHash,
      retrievalKind: kind,
      ...(query ? { query } : {}),
      externalUntrusted: true,
    } satisfies Record<string, unknown>,
  };
}

export function getEvidenceMetadata(source: Source): EvidenceMetadata | null {
  const metadata = source.metadata as Partial<EvidenceMetadata> | undefined;
  return metadata?.externalUntrusted === true &&
    typeof metadata.sourceId === "string" &&
    typeof metadata.retrievedAt === "number" &&
    typeof metadata.contentHash === "string" &&
    typeof metadata.retrievalKind === "string"
    ? (metadata as EvidenceMetadata)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function collectAgentEvidenceRecords(
  value: unknown,
  {
    toolCallId,
    defaultKind,
  }: {
    toolCallId: string;
    defaultKind: EvidenceMetadata["retrievalKind"];
  },
): AgentEvidenceRecord[] {
  const records = new Map<string, AgentEvidenceRecord>();
  const seen = new WeakSet<object>();
  let visited = 0;
  const walk = (candidate: unknown) => {
    if (visited >= 2_000 || candidate === null || candidate === undefined)
      return;
    visited += 1;
    if (Array.isArray(candidate)) {
      if (seen.has(candidate)) return;
      seen.add(candidate);
      candidate.forEach(walk);
      return;
    }
    if (!isRecord(candidate) || seen.has(candidate)) return;
    seen.add(candidate);

    const metadata = isRecord(candidate.metadata)
      ? candidate.metadata
      : candidate;
    const sourceId =
      typeof metadata.sourceId === "string" ? metadata.sourceId : undefined;
    const url =
      typeof candidate.url === "string"
        ? candidate.url
        : typeof candidate.uri === "string"
          ? candidate.uri
          : undefined;
    const retrievedAt =
      typeof metadata.retrievedAt === "number"
        ? metadata.retrievedAt
        : undefined;
    const contentHash =
      typeof metadata.contentHash === "string"
        ? metadata.contentHash
        : undefined;
    const kind = ["search", "fetch", "attachment", "mcp"].includes(
      String(metadata.retrievalKind),
    )
      ? (metadata.retrievalKind as AgentEvidenceRecord["retrievalKind"])
      : defaultKind;
    if (sourceId && url && retrievedAt !== undefined && contentHash) {
      records.set(sourceId, {
        sourceId,
        url,
        ...(typeof candidate.title === "string"
          ? { title: candidate.title.slice(0, 500) }
          : {}),
        retrievedAt,
        contentHash,
        retrievalKind: kind,
        toolCallId,
      });
    }
    Object.values(candidate).forEach(walk);
  };
  walk(value);
  return [...records.values()].slice(0, 200);
}
