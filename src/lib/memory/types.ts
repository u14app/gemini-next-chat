export type MemoryType =
  | "fact"
  | "preference"
  | "instruction"
  | "project"
  | "warning"
  | "decision"
  | "context";

export type MemorySource = "manual" | "ai" | "dream";
export type MemoryScope = "global" | "workspace" | "agent" | "session";

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  content: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  importance: number;
  tags: string[];
  source: MemorySource;
  sourceSessionId?: string;
  sourceMessageIds?: string[];
  sourceMemoryIds?: string[];
  scope?: MemoryScope;
  scopeId?: string;
}

export interface MemorySettings {
  enabled: boolean;
  searchEnabled: boolean;
  autoRecordEnabled: boolean;
  dreamEnabled: boolean;
  triggerCount: number;
  targetCount: number;
}

export interface MemoryDreamStatus {
  isRunning: boolean;
  lastRunAt?: number;
  lastError?: string;
}
