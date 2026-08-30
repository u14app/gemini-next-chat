import type { ResearchTask } from "@/lib/research/types";

import { DEFAULT_DB_NAME } from "./constants";
import { IndexedDbResearchTaskBackend } from "./indexedDbBackend";
import { MemoryResearchTaskBackend } from "./memoryBackend";
import { createStoredRecord, parseStoredResearchTask } from "./persistedTask";
import type {
  CreateResearchTaskRepositoryOptions,
  ResearchTaskBackend,
  ResearchTaskRepository,
  ResearchTaskRepositoryFallbackReason,
  ResearchTaskRepositoryStatus,
} from "./types";

class BrowserResearchTaskRepository implements ResearchTaskRepository {
  private readonly memory = new MemoryResearchTaskBackend();
  private persistent: ResearchTaskBackend | null;
  private status: ResearchTaskRepositoryStatus;

  constructor(factory: IDBFactory | null, dbName: string) {
    this.persistent = factory
      ? new IndexedDbResearchTaskBackend(factory, dbName)
      : null;
    this.status = factory
      ? { mode: "persistent", durable: true }
      : {
          mode: "memory",
          durable: false,
          fallbackReason: "indexeddb_unavailable",
        };
  }

  getStatus(): ResearchTaskRepositoryStatus {
    return { ...this.status };
  }

  private downgrade(reason: ResearchTaskRepositoryFallbackReason): void {
    this.persistent?.close();
    this.persistent = null;
    this.status = { mode: "memory", durable: false, fallbackReason: reason };
  }

  async save(task: ResearchTask): Promise<void> {
    const record = createStoredRecord(task);
    await this.memory.put(record);
    if (!this.persistent) return;
    try {
      await this.persistent.put(record);
    } catch {
      this.downgrade("indexeddb_operation_failed");
    }
  }

  async get(taskId: string): Promise<ResearchTask | null> {
    if (this.persistent) {
      try {
        const stored = await this.persistent.get(taskId);
        const task = parseStoredResearchTask(stored);
        if (task) await this.memory.put(createStoredRecord(task));
        else if (stored !== undefined && stored !== null) {
          await this.persistent.remove(taskId);
        }
        return task;
      } catch {
        this.downgrade("indexeddb_operation_failed");
      }
    }
    return parseStoredResearchTask(await this.memory.get(taskId));
  }

  async list(sessionId?: string): Promise<ResearchTask[]> {
    let values: unknown[];
    if (this.persistent) {
      try {
        values = await this.persistent.getAll();
        const tasks = values
          .map(parseStoredResearchTask)
          .filter((task): task is ResearchTask => Boolean(task));
        const invalidTaskIds = values.flatMap((value) => {
          if (parseStoredResearchTask(value)) return [];
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            return [];
          }
          const taskId = (value as { taskId?: unknown }).taskId;
          return typeof taskId === "string" && taskId ? [taskId] : [];
        });
        await Promise.all(
          invalidTaskIds.map((taskId) => this.persistent!.remove(taskId)),
        );
        await Promise.all(
          tasks.map((task) => this.memory.put(createStoredRecord(task))),
        );
      } catch {
        this.downgrade("indexeddb_operation_failed");
        values = await this.memory.getAll();
      }
    } else {
      values = await this.memory.getAll();
    }
    return values
      .map(parseStoredResearchTask)
      .filter((task): task is ResearchTask => Boolean(task))
      .filter((task) => !sessionId || task.sessionId === sessionId)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async remove(taskId: string): Promise<void> {
    await this.memory.remove(taskId);
    if (!this.persistent) return;
    try {
      await this.persistent.remove(taskId);
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

  async clear(): Promise<void> {
    await this.memory.clear();
    if (!this.persistent) return;
    try {
      await this.persistent.clear();
    } catch {
      this.downgrade("indexeddb_operation_failed");
    }
  }

  close(): void {
    this.persistent?.close();
  }
}

function resolveIndexedDbFactory(
  options: CreateResearchTaskRepositoryOptions,
): IDBFactory | null {
  if (Object.prototype.hasOwnProperty.call(options, "indexedDb")) {
    return options.indexedDb ?? null;
  }
  return typeof indexedDB === "undefined" ? null : indexedDB;
}

export function createResearchTaskRepository(
  options: CreateResearchTaskRepositoryOptions = {},
): ResearchTaskRepository {
  return new BrowserResearchTaskRepository(
    resolveIndexedDbFactory(options),
    options.dbName ?? DEFAULT_DB_NAME,
  );
}
