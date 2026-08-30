import { createStoredRecord } from "./persistedTask";
import type { ResearchTaskBackend, StoredResearchTaskRecord } from "./types";

export class MemoryResearchTaskBackend implements ResearchTaskBackend {
  private readonly records = new Map<string, StoredResearchTaskRecord>();

  async put(record: StoredResearchTaskRecord): Promise<void> {
    this.records.set(record.taskId, createStoredRecord(record.task));
  }
  async get(taskId: string): Promise<unknown> {
    return this.records.get(taskId) ?? null;
  }
  async getAll(): Promise<unknown[]> {
    return [...this.records.values()];
  }
  async remove(taskId: string): Promise<void> {
    this.records.delete(taskId);
  }
  async clearSession(sessionId: string): Promise<void> {
    for (const [taskId, record] of this.records) {
      if (record.sessionId === sessionId) this.records.delete(taskId);
    }
  }
  async clear(): Promise<void> {
    this.records.clear();
  }
  close(): void {}
}
