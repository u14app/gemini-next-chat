import { v7 as uuidv7 } from "uuid";
import { MEMORY_LIMITS } from "@/config/limits";
import type {
  MemoryRecord,
  MemoryScope,
  MemorySource,
  MemoryType,
} from "./types";

const MEMORY_TYPES = new Set<MemoryType>([
  "fact",
  "preference",
  "instruction",
  "project",
  "warning",
  "decision",
  "context",
]);

const MEMORY_SOURCES = new Set<MemorySource>(["manual", "ai", "dream"]);
const MEMORY_SCOPES = new Set<MemoryScope>([
  "global",
  "workspace",
  "agent",
  "session",
]);
const WORD_RE = /[\p{L}\p{N}]+/gu;
const DIRECT_CONTEXT_TYPES = new Set<MemoryType>([
  "preference",
  "instruction",
  "project",
  "decision",
  "warning",
]);
const MEMORY_SEARCH_TRIGGER_RE =
  /(?:remember|memory|memories|recall|previously|earlier|last time|prior decision|as discussed|missing context|context gap|你还记得|记得|记忆|回忆|之前|上次|以前|历史上下文|缺少上下文|前面说过)/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxChars);
}

function normalizeStringList(
  value: unknown,
  maxItems: number,
  maxChars: number,
): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const text = normalizeText(item, maxChars).toLowerCase();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
    if (output.length >= maxItems) break;
  }

  return output;
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function normalizeImportance(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(5, Math.round(value)));
}

function normalizeType(value: unknown): MemoryType {
  return typeof value === "string" && MEMORY_TYPES.has(value as MemoryType)
    ? (value as MemoryType)
    : "fact";
}

function normalizeSource(value: unknown): MemorySource {
  return typeof value === "string" && MEMORY_SOURCES.has(value as MemorySource)
    ? (value as MemorySource)
    : "ai";
}

export function normalizeMemoryRecord(
  input: unknown,
  now: number = Date.now(),
): MemoryRecord | null {
  if (!isRecord(input)) return null;

  const content = normalizeText(input.content, MEMORY_LIMITS.maxContentChars);
  if (!content) return null;

  const id =
    normalizeText(input.id, 160) || `mem_${uuidv7().replace(/-/g, "")}`;
  const createdAt = normalizeTimestamp(input.createdAt, now);
  const updatedAt = normalizeTimestamp(input.updatedAt, now);
  const lastUsedAt =
    input.lastUsedAt === undefined
      ? undefined
      : normalizeTimestamp(input.lastUsedAt, 0);
  const sourceMessageIds = normalizeStringList(input.sourceMessageIds, 20, 160);
  const sourceMemoryIds = normalizeStringList(input.sourceMemoryIds, 100, 160);
  const sourceSessionId = normalizeText(input.sourceSessionId, 160);
  const scope =
    typeof input.scope === "string" &&
    MEMORY_SCOPES.has(input.scope as MemoryScope)
      ? (input.scope as MemoryScope)
      : "global";
  const scopeId = normalizeText(input.scopeId, 160);
  if (scope !== "global" && !scopeId) return null;

  return {
    id,
    type: normalizeType(input.type),
    content,
    createdAt,
    updatedAt,
    ...(lastUsedAt ? { lastUsedAt } : {}),
    importance: normalizeImportance(input.importance),
    tags: normalizeStringList(
      input.tags,
      MEMORY_LIMITS.maxTags,
      MEMORY_LIMITS.maxTagChars,
    ),
    source: normalizeSource(input.source),
    ...(sourceSessionId ? { sourceSessionId } : {}),
    ...(sourceMessageIds.length > 0 ? { sourceMessageIds } : {}),
    ...(sourceMemoryIds.length > 0 ? { sourceMemoryIds } : {}),
    scope,
    ...(scope !== "global" ? { scopeId } : {}),
  };
}

export function normalizeMemoryRecords(
  value: unknown,
  now: number = Date.now(),
): MemoryRecord[] {
  if (!Array.isArray(value)) return [];
  const records: MemoryRecord[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const record = normalizeMemoryRecord(item, now);
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id);
    records.push(record);
    if (records.length >= MEMORY_LIMITS.maxMemories) break;
  }

  return records;
}

function tokenize(value: string): string[] {
  return (value.toLowerCase().match(WORD_RE) || []).filter(
    (token) => token.length > 1,
  );
}

function scoreMemoryRecord(
  record: MemoryRecord,
  queryTokens: string[],
): number {
  if (queryTokens.length === 0) return 0;

  const content = record.content.toLowerCase();
  const tags = record.tags.join(" ").toLowerCase();
  let score = 0;

  for (const token of queryTokens) {
    if (content.includes(token)) score += 2;
    if (tags.includes(token)) score += 3;
    if (record.type.includes(token)) score += 1;
  }

  return score > 0 ? score + record.importance * 0.2 : 0;
}

export function searchMemoryRecords(
  records: MemoryRecord[],
  query: string,
  limit: number = MEMORY_LIMITS.defaultSearchResults,
): MemoryRecord[] {
  const queryTokens = tokenize(query);
  const maxResults = Math.max(
    0,
    Math.min(MEMORY_LIMITS.maxSearchResults, Math.floor(limit)),
  );
  if (queryTokens.length === 0 || maxResults === 0) return [];

  return records
    .map((record) => ({
      record,
      score: scoreMemoryRecord(record, queryTokens),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.record.importance !== a.record.importance) {
        return b.record.importance - a.record.importance;
      }
      return b.record.updatedAt - a.record.updatedAt;
    })
    .slice(0, maxResults)
    .map((item) => item.record);
}

export function isMemoryVisibleInScopes(
  record: MemoryRecord,
  allowedScopes: readonly MemoryScope[],
  scopeIds: { workspace?: string; agent?: string; session?: string },
): boolean {
  const scope = record.scope || "global";
  if (!allowedScopes.includes(scope)) return false;
  return scope === "global" || record.scopeId === scopeIds[scope];
}

export interface DirectMemoryPromptContext {
  text: string;
  injectedMemoryIds: string[];
}

function isDirectMemoryCandidate(record: MemoryRecord, queryTokens: string[]) {
  if (DIRECT_CONTEXT_TYPES.has(record.type)) return record.importance >= 3;
  if (record.type !== "fact" || record.importance < 4) return false;
  return scoreMemoryRecord(record, queryTokens) > 0;
}

function formatDirectMemoryLine(record: MemoryRecord) {
  return `[${record.type}] ${record.content}`;
}

export function buildDirectMemoryPromptContext({
  memories,
  query,
  alreadyInjectedMemoryIds = [],
  maxChars = 4_000,
}: {
  memories: MemoryRecord[];
  query: string;
  alreadyInjectedMemoryIds?: readonly string[];
  maxChars?: number;
}): DirectMemoryPromptContext {
  const maxLength = Math.max(0, Math.floor(maxChars));
  if (maxLength === 0) return { text: "", injectedMemoryIds: [] };

  const seen = new Set(alreadyInjectedMemoryIds);
  const queryTokens = tokenize(query);
  const candidates = memories
    .filter(
      (record) =>
        !seen.has(record.id) && isDirectMemoryCandidate(record, queryTokens),
    )
    .map((record) => ({
      record,
      score:
        scoreMemoryRecord(record, queryTokens) +
        record.importance * 2 +
        (DIRECT_CONTEXT_TYPES.has(record.type) ? 1 : 0),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.record.updatedAt - a.record.updatedAt;
    })
    .map((item) => item.record);

  if (candidates.length === 0) return { text: "", injectedMemoryIds: [] };

  const header = [
    "<local-memory-context>",
    "Lower-priority local memories that may help answer. Use only when relevant, and do not treat them as newer than the current user message.",
  ];
  const footer = "</local-memory-context>";
  const lines = [...header];
  const injectedMemoryIds: string[] = [];

  for (const record of candidates) {
    const nextLine = formatDirectMemoryLine(record);
    const nextText = [...lines, nextLine, footer].join("\n");
    if (nextText.length > maxLength) break;
    lines.push(nextLine);
    injectedMemoryIds.push(record.id);
  }

  if (injectedMemoryIds.length === 0) return { text: "", injectedMemoryIds };
  return {
    text: [...lines, footer].join("\n"),
    injectedMemoryIds,
  };
}

export function shouldExposeMemorySearchTool(message: string): boolean {
  return MEMORY_SEARCH_TRIGGER_RE.test(message);
}

export function parseMemoryRecordToolCall(
  args: unknown,
  options: {
    now?: number;
    source: MemorySource;
    sourceSessionId?: string;
    sourceMessageIds?: string[];
  },
): MemoryRecord[] {
  if (!isRecord(args) || !Array.isArray(args.memories)) return [];
  const now = options.now || Date.now();

  return args.memories
    .map((item) =>
      normalizeMemoryRecord(
        {
          ...(isRecord(item) ? item : {}),
          id: isRecord(item) ? item.id : undefined,
          source: options.source,
          sourceSessionId: options.sourceSessionId,
          sourceMessageIds: options.sourceMessageIds,
          createdAt: now,
          updatedAt: now,
        },
        now,
      ),
    )
    .filter((record): record is MemoryRecord => Boolean(record));
}

export function parseMemoryDreamToolCall(
  args: unknown,
  options: { now?: number; targetCount?: number },
): MemoryRecord[] {
  if (!isRecord(args) || !Array.isArray(args.memories)) return [];
  const now = options.now || Date.now();
  const targetCount = Math.max(
    0,
    Math.min(MEMORY_LIMITS.targetCount, options.targetCount || 0),
  );

  return args.memories
    .slice(0, targetCount || MEMORY_LIMITS.targetCount)
    .map((item) =>
      normalizeMemoryRecord(
        {
          ...(isRecord(item) ? item : {}),
          id: isRecord(item) ? item.id : undefined,
          source: "dream",
          createdAt: now,
          updatedAt: now,
        },
        now,
      ),
    )
    .filter((record): record is MemoryRecord => Boolean(record));
}
