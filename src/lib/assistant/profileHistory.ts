import type { AgentProfileV2 } from "./types";
import { normalizeAgentProfile } from "./profile";

export interface AgentProfileDiffEntry {
  path: string;
  before?: unknown;
  after?: unknown;
}

export interface AgentProfileRevision {
  id: string;
  profileId: string;
  sequence: number;
  createdAt: number;
  profile: AgentProfileV2;
  changes: AgentProfileDiffEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function walkDiff(
  before: unknown,
  after: unknown,
  path: string,
  output: AgentProfileDiffEntry[],
): void {
  if (same(before, after) || output.length >= 100) return;
  if (isRecord(before) && isRecord(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    keys.forEach((key) =>
      walkDiff(before[key], after[key], path ? `${path}.${key}` : key, output),
    );
    return;
  }
  output.push({
    path: path || "profile",
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
  });
}

export function diffAgentProfiles(
  before: AgentProfileV2 | undefined,
  after: AgentProfileV2,
): AgentProfileDiffEntry[] {
  const output: AgentProfileDiffEntry[] = [];
  walkDiff(before, after, "", output);
  return output;
}

export function normalizeAgentProfileRevision(
  value: unknown,
): AgentProfileRevision | null {
  if (!isRecord(value)) return null;
  const profile = normalizeAgentProfile(value.profile);
  if (
    !profile ||
    typeof value.id !== "string" ||
    typeof value.profileId !== "string" ||
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    typeof value.createdAt !== "number" ||
    !Number.isFinite(value.createdAt)
  ) {
    return null;
  }
  const changes = Array.isArray(value.changes)
    ? value.changes.flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.path !== "string") return [];
        return [
          {
            path: entry.path.slice(0, 240),
            ...(entry.before !== undefined ? { before: entry.before } : {}),
            ...(entry.after !== undefined ? { after: entry.after } : {}),
          },
        ];
      })
    : [];
  return {
    id: value.id.slice(0, 200),
    profileId: value.profileId.slice(0, 160),
    sequence: value.sequence,
    createdAt: value.createdAt,
    profile,
    changes: changes.slice(0, 100),
  };
}
