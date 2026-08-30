import type { ResearchTask } from "@/lib/research/types";

import type { RESEARCH_TASK_STORAGE_VERSION } from "./constants";

export type ResearchTaskRepositoryFallbackReason =
  "indexeddb_unavailable" | "indexeddb_operation_failed";

export interface ResearchTaskRepositoryStatus {
  mode: "persistent" | "memory";
  durable: boolean;
  fallbackReason?: ResearchTaskRepositoryFallbackReason;
}

export interface ResearchTaskRepository {
  getStatus(): ResearchTaskRepositoryStatus;
  save(task: ResearchTask): Promise<void>;
  get(taskId: string): Promise<ResearchTask | null>;
  list(sessionId?: string): Promise<ResearchTask[]>;
  remove(taskId: string): Promise<void>;
  clearSession(sessionId: string): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

export interface CreateResearchTaskRepositoryOptions {
  indexedDb?: IDBFactory | null;
  dbName?: string;
}

export interface StoredResearchTaskRecord {
  storageVersion: typeof RESEARCH_TASK_STORAGE_VERSION;
  taskId: string;
  sessionId: string;
  updatedAt: number;
  task: ResearchTask;
}

export interface ResearchTaskBackend {
  put(record: StoredResearchTaskRecord): Promise<void>;
  get(taskId: string): Promise<unknown>;
  getAll(): Promise<unknown[]>;
  remove(taskId: string): Promise<void>;
  clearSession(sessionId: string): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}
