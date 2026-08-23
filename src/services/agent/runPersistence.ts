import { z } from "zod";

import {
  AGENT_RUN_SCHEMA_VERSION,
  type AgentRun,
  type AgentRunError,
} from "@/lib/agent/run";

export const AGENT_RUN_STORAGE_VERSION = 1 as const;

const DEFAULT_DB_NAME = "neo-chat-agent-runs";
const STORE_NAME = "runs";
const SESSION_INDEX = "sessionId";
const MAX_PERSISTED_ERROR_CHARS = 240;

export type AgentRunPersistenceFallbackReason =
  "indexeddb_unavailable" | "indexeddb_operation_failed";

export interface AgentRunPersistenceStatus {
  mode: "persistent" | "memory";
  durable: boolean;
  fallbackReason?: AgentRunPersistenceFallbackReason;
}

export interface AgentRunPersistence {
  getStatus(): AgentRunPersistenceStatus;
  save(run: AgentRun): Promise<void>;
  get(runId: string): Promise<AgentRun | null>;
  list(sessionId?: string): Promise<AgentRun[]>;
  remove(runId: string): Promise<void>;
  clearSession(sessionId: string): Promise<void>;
  close(): void;
}

export interface CreateAgentRunPersistenceOptions {
  indexedDb?: IDBFactory | null;
  dbName?: string;
}

interface StoredAgentRunRecord {
  storageVersion: typeof AGENT_RUN_STORAGE_VERSION;
  runId: string;
  sessionId: string;
  updatedAt: number;
  run: AgentRun;
}

interface AgentRunRecordBackend {
  put(record: StoredAgentRunRecord): Promise<void>;
  get(runId: string): Promise<unknown>;
  getAll(): Promise<unknown[]>;
  remove(runId: string): Promise<void>;
  clearSession(sessionId: string): Promise<void>;
  close(): void;
}

const runStatusSchema = z.enum([
  "running",
  "awaiting_input",
  "awaiting_approval",
  "interrupted",
  "completed",
  "failed",
  "cancelled",
]);

const stopReasonSchema = z.enum([
  "completed",
  "user_stopped",
  "budget_exhausted",
  "offline",
  "page_interrupted",
  "effect_unknown",
  "runtime_error",
]);

const budgetDimensionSchema = z.enum([
  "tool_rounds",
  "tool_calls",
  "tokens",
  "wall_time",
]);

const errorSchema = z
  .object({
    code: z.string().max(160).optional(),
    message: z.string().max(MAX_PERSISTED_ERROR_CHARS),
    recoverable: z.boolean().optional(),
  })
  .strict();

const activitySchema = z
  .object({
    id: z.string().min(1).max(240),
    runId: z.string().min(1).max(240),
    sequence: z.number().int().positive(),
    kind: z.enum([
      "run_started",
      "status_changed",
      "model_round_completed",
      "tool_prepared",
      "tool_running",
      "tool_committed",
      "tool_failed",
      "tool_effect_unknown",
      "checkpoint",
    ]),
    at: z.number().finite().nonnegative(),
    status: runStatusSchema.optional(),
    toolExecutionId: z.string().min(1).max(240).optional(),
    round: z.number().int().positive().optional(),
  })
  .strict();

const invocationPolicySchema = z
  .object({
    effects: z.array(
      z.enum([
        "local_read",
        "local_write",
        "local_destructive",
        "network_read",
        "external_write",
        "external_destructive",
      ]),
    ),
    idempotency: z.enum(["idempotent", "non_idempotent", "unknown"]),
    sensitivity: z.enum(["none", "user_data", "credentials", "unknown"]),
    origin: z.enum(["builtin", "plugin", "mcp"]),
  })
  .strict();

const resultReferenceSchema = z
  .object({
    kind: z.enum(["artifact", "workspace_file", "tool_cache"]),
    id: z.string().min(1).max(512),
    contentHash: z.string().min(1).max(256).optional(),
  })
  .strict();

const effectReceiptSchema = z
  .object({
    committedAt: z.number().finite().nonnegative(),
    effectId: z.string().min(1).max(512).optional(),
    targetHash: z.string().min(1).max(256).optional(),
    resultHash: z.string().min(1).max(256).optional(),
    reversible: z.boolean().optional(),
  })
  .strict();

const toolExecutionSchema = z
  .object({
    id: z.string().min(1).max(240),
    runId: z.string().min(1).max(240),
    callId: z.string().min(1).max(240),
    toolName: z.string().min(1).max(240),
    pluginId: z.string().min(1).max(240).optional(),
    definitionFingerprint: z.string().min(1).max(512),
    argumentsHash: z.string().min(1).max(512),
    targetSummary: z.string().min(1).max(512).optional(),
    round: z.number().int().positive().optional(),
    policy: invocationPolicySchema,
    status: z.enum([
      "prepared",
      "running",
      "committed",
      "failed",
      "effect_unknown",
    ]),
    attempt: z.number().int().nonnegative(),
    preparedAt: z.number().finite().nonnegative(),
    startedAt: z.number().finite().nonnegative().optional(),
    endedAt: z.number().finite().nonnegative().optional(),
    resultRefs: z.array(resultReferenceSchema).max(64).optional(),
    receipt: effectReceiptSchema.optional(),
    error: errorSchema.optional(),
  })
  .strict();

const evidenceRecordSchema = z
  .object({
    sourceId: z.string().min(1).max(240),
    url: z.string().min(1).max(2_048),
    title: z.string().max(500).optional(),
    retrievedAt: z.number().finite().nonnegative(),
    contentHash: z.string().min(1).max(256),
    retrievalKind: z.enum(["search", "fetch", "attachment", "mcp"]),
    toolCallId: z.string().min(1).max(240),
  })
  .strict();

const agentRunSchema = z
  .object({
    schemaVersion: z.literal(AGENT_RUN_SCHEMA_VERSION),
    id: z.string().min(1).max(240),
    sessionId: z.string().min(1).max(240),
    userMessageId: z.string().min(1).max(240).optional(),
    modelMessageId: z.string().min(1).max(240).optional(),
    model: z.string().min(1).max(240).optional(),
    status: runStatusSchema,
    createdAt: z.number().finite().nonnegative(),
    startedAt: z.number().finite().nonnegative(),
    updatedAt: z.number().finite().nonnegative(),
    endedAt: z.number().finite().nonnegative().optional(),
    budget: z
      .object({
        maxToolRounds: z.number().int().positive(),
        maxToolCalls: z.number().int().positive(),
        maxTotalTokens: z.number().int().positive().optional(),
        maxDurationMs: z.number().int().positive().optional(),
      })
      .strict(),
    usage: z
      .object({
        modelRounds: z.number().int().nonnegative(),
        toolRounds: z.number().int().nonnegative(),
        toolCalls: z.number().int().nonnegative(),
        promptTokens: z.number().int().nonnegative(),
        completionTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
        wallTimeMs: z.number().int().nonnegative(),
      })
      .strict(),
    stop: z
      .object({
        reason: stopReasonSchema,
        at: z.number().finite().nonnegative(),
        budgetDimension: budgetDimensionSchema.optional(),
        error: errorSchema.optional(),
      })
      .strict()
      .optional(),
    activities: z.array(activitySchema).max(10_000),
    toolExecutions: z.array(toolExecutionSchema).max(1_000),
    evidence: z.array(evidenceRecordSchema).max(500).optional().default([]),
  })
  .strict()
  .superRefine((run, context) => {
    if (run.updatedAt < run.createdAt || run.startedAt < run.createdAt) {
      context.addIssue({
        code: "custom",
        message: "Agent run timestamps are inconsistent.",
      });
    }
    if (
      run.usage.totalTokens <
      run.usage.promptTokens + run.usage.completionTokens
    ) {
      context.addIssue({
        code: "custom",
        message: "Agent run token totals are inconsistent.",
      });
    }
    if (run.usage.toolCalls !== run.toolExecutions.length) {
      context.addIssue({
        code: "custom",
        message: "Agent run tool-call totals are inconsistent.",
      });
    }
    run.activities.forEach((activity, index) => {
      if (activity.runId !== run.id || activity.sequence !== index + 1) {
        context.addIssue({
          code: "custom",
          message: "Agent activity ordering is inconsistent.",
        });
      }
    });
    run.toolExecutions.forEach((record) => {
      if (record.runId !== run.id) {
        context.addIssue({
          code: "custom",
          message: "Tool execution belongs to a different agent run.",
        });
      }
    });
  });

const storedRecordSchema = z
  .object({
    storageVersion: z.literal(AGENT_RUN_STORAGE_VERSION),
    runId: z.string().min(1).max(240),
    sessionId: z.string().min(1).max(240),
    updatedAt: z.number().finite().nonnegative(),
    run: agentRunSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.runId !== record.run.id ||
      record.sessionId !== record.run.sessionId ||
      record.updatedAt !== record.run.updatedAt
    ) {
      context.addIssue({
        code: "custom",
        message: "Stored agent run metadata is inconsistent.",
      });
    }
  });

function redactPersistenceText(value: string): string {
  return value
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(
      /((?:api[_-]?key|access[_-]?token|token|password|secret)["']?\s*[:=]\s*["']?)[^"',\s;}]+/gi,
      "$1[REDACTED]",
    )
    .replace(/([?&](?:key|token|secret|password)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^/@\s]+:[^/@\s]+@/gi, "https://[REDACTED]@")
    .slice(0, MAX_PERSISTED_ERROR_CHARS);
}

function sanitizeError(
  error: AgentRunError | undefined,
): AgentRunError | undefined {
  if (!error) return undefined;
  return {
    ...(error.code
      ? { code: redactPersistenceText(error.code).slice(0, 160) }
      : {}),
    message: redactPersistenceText(error.message),
    ...(error.recoverable !== undefined
      ? { recoverable: error.recoverable }
      : {}),
  };
}

function sanitizeEvidenceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (
        /(?:key|token|secret|password|signature|credential|auth)/i.test(key)
      ) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }
    return url.toString().slice(0, 2_048);
  } catch {
    return redactPersistenceText(value).slice(0, 2_048);
  }
}

/** Returns the minimal, secret-redacted form that may be persisted locally. */
export function toPersistedAgentRun(run: AgentRun): AgentRun {
  return {
    ...run,
    budget: { ...run.budget },
    usage: { ...run.usage },
    ...(run.stop
      ? {
          stop: {
            ...run.stop,
            error: sanitizeError(run.stop.error),
          },
        }
      : {}),
    activities: run.activities.map((activity) => ({ ...activity })),
    toolExecutions: run.toolExecutions.map((record) => ({
      ...record,
      policy: { ...record.policy, effects: [...record.policy.effects] },
      resultRefs: record.resultRefs?.map((reference) => ({ ...reference })),
      receipt: record.receipt ? { ...record.receipt } : undefined,
      error: sanitizeError(record.error),
    })),
    evidence: run.evidence.map((record) => ({
      ...record,
      url: sanitizeEvidenceUrl(record.url),
      title: record.title?.slice(0, 500),
    })),
  };
}

function createStoredRecord(run: AgentRun): StoredAgentRunRecord {
  const persistedRun = toPersistedAgentRun(run);
  const record = {
    storageVersion: AGENT_RUN_STORAGE_VERSION,
    runId: persistedRun.id,
    sessionId: persistedRun.sessionId,
    updatedAt: persistedRun.updatedAt,
    run: persistedRun,
  };
  const parsed = storedRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new Error("Agent run is not valid for local persistence.");
  }
  return parsed.data as StoredAgentRunRecord;
}

export function parseStoredAgentRun(value: unknown): AgentRun | null {
  const parsed = storedRecordSchema.safeParse(value);
  return parsed.success ? (parsed.data.run as AgentRun) : null;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error || new Error("IndexedDB transaction aborted."));
  });
}

class IndexedDbAgentRunBackend implements AgentRunRecordBackend {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory,
    private readonly dbName: string,
  ) {}

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;

    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.factory.open(this.dbName, AGENT_RUN_STORAGE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        const store = database.objectStoreNames.contains(STORE_NAME)
          ? request.transaction!.objectStore(STORE_NAME)
          : database.createObjectStore(STORE_NAME, { keyPath: "runId" });
        if (!store.indexNames.contains(SESSION_INDEX)) {
          store.createIndex(SESSION_INDEX, SESSION_INDEX, { unique: false });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          this.databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => {
        this.databasePromise = null;
        reject(request.error || new Error("IndexedDB open failed."));
      };
      request.onblocked = () => {
        this.databasePromise = null;
        reject(new Error("IndexedDB open was blocked."));
      };
    });
    return this.databasePromise;
  }

  async put(record: StoredAgentRunRecord): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record);
    await transactionToPromise(transaction);
  }

  async get(runId: string): Promise<unknown> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readonly");
    return requestToPromise(transaction.objectStore(STORE_NAME).get(runId));
  }

  async getAll(): Promise<unknown[]> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readonly");
    return requestToPromise(transaction.objectStore(STORE_NAME).getAll());
  }

  async remove(runId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(runId);
    await transactionToPromise(transaction);
  }

  async clearSession(sessionId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const index = transaction.objectStore(STORE_NAME).index(SESSION_INDEX);
    const request = index.openKeyCursor(sessionId);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      transaction.objectStore(STORE_NAME).delete(cursor.primaryKey);
      cursor.continue();
    };
    await transactionToPromise(transaction);
  }

  close(): void {
    void this.databasePromise
      ?.then((database) => database.close())
      .catch(() => undefined);
    this.databasePromise = null;
  }
}

class MemoryAgentRunBackend implements AgentRunRecordBackend {
  private readonly records = new Map<string, StoredAgentRunRecord>();

  async put(record: StoredAgentRunRecord): Promise<void> {
    this.records.set(record.runId, createStoredRecord(record.run));
  }

  async get(runId: string): Promise<unknown> {
    return this.records.get(runId) ?? null;
  }

  async getAll(): Promise<unknown[]> {
    return [...this.records.values()];
  }

  async remove(runId: string): Promise<void> {
    this.records.delete(runId);
  }

  async clearSession(sessionId: string): Promise<void> {
    for (const [runId, record] of this.records) {
      if (record.sessionId === sessionId) this.records.delete(runId);
    }
  }

  close(): void {}
}

class BrowserAgentRunPersistence implements AgentRunPersistence {
  private readonly memory = new MemoryAgentRunBackend();
  private persistent: AgentRunRecordBackend | null;
  private status: AgentRunPersistenceStatus;

  constructor(factory: IDBFactory | null, dbName: string) {
    this.persistent = factory
      ? new IndexedDbAgentRunBackend(factory, dbName)
      : null;
    this.status = factory
      ? { mode: "persistent", durable: true }
      : {
          mode: "memory",
          durable: false,
          fallbackReason: "indexeddb_unavailable",
        };
  }

  getStatus(): AgentRunPersistenceStatus {
    return { ...this.status };
  }

  private downgrade(reason: AgentRunPersistenceFallbackReason): void {
    this.persistent?.close();
    this.persistent = null;
    this.status = { mode: "memory", durable: false, fallbackReason: reason };
  }

  async save(run: AgentRun): Promise<void> {
    const record = createStoredRecord(run);
    await this.memory.put(record);
    if (!this.persistent) return;
    try {
      await this.persistent.put(record);
    } catch {
      this.downgrade("indexeddb_operation_failed");
    }
  }

  async get(runId: string): Promise<AgentRun | null> {
    if (this.persistent) {
      try {
        const value = await this.persistent.get(runId);
        const run = parseStoredAgentRun(value);
        if (run) await this.memory.put(createStoredRecord(run));
        return run;
      } catch {
        this.downgrade("indexeddb_operation_failed");
      }
    }
    return parseStoredAgentRun(await this.memory.get(runId));
  }

  async list(sessionId?: string): Promise<AgentRun[]> {
    let values: unknown[];
    if (this.persistent) {
      try {
        values = await this.persistent.getAll();
        const validRecords = values
          .map(parseStoredAgentRun)
          .filter((run): run is AgentRun => Boolean(run));
        await Promise.all(
          validRecords.map((run) => this.memory.put(createStoredRecord(run))),
        );
      } catch {
        this.downgrade("indexeddb_operation_failed");
        values = await this.memory.getAll();
      }
    } else {
      values = await this.memory.getAll();
    }

    return values
      .map(parseStoredAgentRun)
      .filter((run): run is AgentRun => Boolean(run))
      .filter((run) => !sessionId || run.sessionId === sessionId)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async remove(runId: string): Promise<void> {
    await this.memory.remove(runId);
    if (!this.persistent) return;
    try {
      await this.persistent.remove(runId);
    } catch {
      this.downgrade("indexeddb_operation_failed");
    }
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.memory.clearSession(sessionId);
    if (!this.persistent) return;
    try {
      await this.persistent.clearSession(sessionId);
    } catch {
      this.downgrade("indexeddb_operation_failed");
    }
  }

  close(): void {
    this.persistent?.close();
  }
}

function resolveIndexedDbFactory(
  options: CreateAgentRunPersistenceOptions,
): IDBFactory | null {
  if (Object.prototype.hasOwnProperty.call(options, "indexedDb")) {
    return options.indexedDb ?? null;
  }
  return typeof indexedDB === "undefined" ? null : indexedDB;
}

/**
 * Creates a browser-local run store. When IndexedDB is unavailable or fails,
 * the adapter transparently keeps the current page functional in memory and
 * exposes the loss of durability through getStatus().
 */
export function createAgentRunPersistence(
  options: CreateAgentRunPersistenceOptions = {},
): AgentRunPersistence {
  return new BrowserAgentRunPersistence(
    resolveIndexedDbFactory(options),
    options.dbName ?? DEFAULT_DB_NAME,
  );
}
