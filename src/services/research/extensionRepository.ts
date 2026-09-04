/** Research additions live separately from the strict, versioned task database. */
export type ResearchExtensionKind =
  | "template"
  | "task_template"
  | "source_contracts"
  | "steering"
  | "evidence_snapshot"
  | "evidence_thread";

export interface ResearchExtensionScope {
  taskId?: string;
  sessionId?: string;
  reportId?: string;
}

export interface ResearchExtensionRecord<
  T = unknown,
> extends ResearchExtensionScope {
  id: string;
  kind: ResearchExtensionKind;
  value: T;
}

export interface ResearchExtensionRepository {
  getStatus(): { durable: boolean };
  get<T>(kind: ResearchExtensionKind, id: string): Promise<T | null>;
  list<T>(
    kind: ResearchExtensionKind,
    scope?: ResearchExtensionScope,
  ): Promise<ResearchExtensionRecord<T>[]>;
  put<T>(
    kind: ResearchExtensionKind,
    id: string,
    value: T,
    scope?: ResearchExtensionScope,
  ): Promise<void>;
  update<T>(
    kind: ResearchExtensionKind,
    id: string,
    updater: (current: T | null) => T | null,
    scope?: ResearchExtensionScope,
  ): Promise<T | null>;
  remove(kind: ResearchExtensionKind, id: string): Promise<void>;
  removeTask(taskId: string): Promise<void>;
  close(): void;
}

const DB_NAME = "neo-chat-research-extensions";
const STORE = "records";
const CHANNEL = "neo-chat-research-extensions-changed";
const listeners = new Set<() => void>();
let channel: BroadcastChannel | undefined;

function notifyChange() {
  listeners.forEach((listener) => listener());
  if (channel) channel.postMessage("changed");
  else if (
    typeof window !== "undefined" &&
    typeof BroadcastChannel !== "undefined"
  ) {
    const notification = new BroadcastChannel(CHANNEL);
    notification.postMessage("changed");
    notification.close();
  }
}

export function subscribeResearchExtensions(listener: () => void): () => void {
  listeners.add(listener);
  if (
    !channel &&
    typeof window !== "undefined" &&
    typeof BroadcastChannel !== "undefined"
  ) {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => listeners.forEach((callback) => callback());
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      channel?.close();
      channel = undefined;
    }
  };
}

function matches(
  record: ResearchExtensionRecord,
  scope: ResearchExtensionScope,
) {
  return (
    (!scope.taskId || record.taskId === scope.taskId) &&
    (!scope.sessionId || record.sessionId === scope.sessionId) &&
    (!scope.reportId || record.reportId === scope.reportId)
  );
}

function isRecord(value: unknown): value is ResearchExtensionRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ResearchExtensionRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.kind === "string" &&
    Object.prototype.hasOwnProperty.call(record, "value")
  );
}

class BrowserResearchExtensionRepository implements ResearchExtensionRepository {
  private databasePromise: Promise<IDBDatabase> | null = null;
  private durable: boolean;

  constructor(
    private factory: IDBFactory | null,
    private dbName: string,
  ) {
    this.durable = Boolean(factory);
  }

  getStatus() {
    return { durable: this.durable };
  }

  private open(): Promise<IDBDatabase> {
    if (!this.factory)
      return Promise.reject(
        new Error("Research extension storage is unavailable."),
      );
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.factory!.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        const records = database.createObjectStore(STORE, {
          keyPath: ["kind", "id"],
        });
        records.createIndex("kind", "kind");
        records.createIndex("taskId", "taskId");
      };
      request.onsuccess = () => {
        const database = request.result;
        this.durable = true;
        database.onversionchange = () => {
          database.close();
          this.databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => {
        this.durable = false;
        this.databasePromise = null;
        reject(
          request.error ||
            new Error("Research extension storage could not open."),
        );
      };
      request.onblocked = () => {
        this.durable = false;
        this.databasePromise = null;
        reject(
          new Error("Research extension storage is blocked by another tab."),
        );
      };
    });
    return this.databasePromise;
  }

  async get<T>(kind: ResearchExtensionKind, id: string): Promise<T | null> {
    if (!this.factory) return null;
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const request = database
        .transaction(STORE, "readonly")
        .objectStore(STORE)
        .get([kind, id]);
      request.onsuccess = () =>
        resolve(isRecord(request.result) ? (request.result.value as T) : null);
      request.onerror = () => reject(request.error);
    });
  }

  async list<T>(
    kind: ResearchExtensionKind,
    scope: ResearchExtensionScope = {},
  ) {
    if (!this.factory) return [];
    const database = await this.open();
    return new Promise<ResearchExtensionRecord<T>[]>((resolve, reject) => {
      const store = database.transaction(STORE, "readonly").objectStore(STORE);
      const request = scope.taskId
        ? store.index("taskId").getAll(scope.taskId)
        : store.index("kind").getAll(kind);
      request.onsuccess = () =>
        resolve(
          request.result.filter(
            (record): record is ResearchExtensionRecord<T> =>
              isRecord(record) &&
              record.kind === kind &&
              matches(record, scope),
          ),
        );
      request.onerror = () => reject(request.error);
    });
  }

  async put<T>(
    kind: ResearchExtensionKind,
    id: string,
    value: T,
    scope: ResearchExtensionScope = {},
  ) {
    await this.update<T>(kind, id, () => value, scope);
  }

  async update<T>(
    kind: ResearchExtensionKind,
    id: string,
    updater: (current: T | null) => T | null,
    scope: ResearchExtensionScope = {},
  ): Promise<T | null> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const request = store.get([kind, id]);
      let result: T | null = null;
      let updaterError: unknown;
      request.onsuccess = () => {
        try {
          const current = isRecord(request.result) ? request.result : null;
          result = updater(current ? (current.value as T) : null);
          if (result === null) store.delete([kind, id]);
          else store.put({ ...current, ...scope, kind, id, value: result });
        } catch (error) {
          updaterError = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => {
        this.durable = true;
        notifyChange();
        resolve(result);
      };
      transaction.onabort = transaction.onerror = () => {
        if (!updaterError) this.durable = false;
        reject(
          updaterError ||
            transaction.error ||
            new Error("Research extension write failed."),
        );
      };
    });
  }

  async remove(kind: ResearchExtensionKind, id: string) {
    await this.update(kind, id, () => null);
  }

  async removeTask(taskId: string) {
    if (!this.factory) return;
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const request = store.index("taskId").openCursor(taskId);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      transaction.oncomplete = () => {
        notifyChange();
        resolve();
      };
      transaction.onabort = transaction.onerror = () =>
        reject(transaction.error);
    });
  }

  close() {
    void this.databasePromise
      ?.then((database) => database.close())
      .catch(() => undefined);
    this.databasePromise = null;
  }
}

export function createResearchExtensionRepository({
  indexedDb = typeof indexedDB === "undefined" ? null : indexedDB,
  dbName = DB_NAME,
}: {
  indexedDb?: IDBFactory | null;
  dbName?: string;
} = {}): ResearchExtensionRepository {
  return new BrowserResearchExtensionRepository(indexedDb, dbName);
}

/** In-memory adapter for deterministic tests; production never silently falls back. */
export function createMemoryResearchExtensionRepository(): ResearchExtensionRepository {
  const records = new Map<string, ResearchExtensionRecord>();
  const key = (kind: ResearchExtensionKind, id: string) =>
    JSON.stringify([kind, id]);
  return {
    getStatus: () => ({ durable: false }),
    async get<T>(kind: ResearchExtensionKind, id: string) {
      return structuredClone(
        (records.get(key(kind, id))?.value ?? null) as T | null,
      );
    },
    async list<T>(
      kind: ResearchExtensionKind,
      scope: ResearchExtensionScope = {},
    ) {
      return structuredClone(
        [...records.values()].filter(
          (item) => item.kind === kind && matches(item, scope),
        ),
      ) as ResearchExtensionRecord<T>[];
    },
    async put(kind, id, value, scope = {}) {
      await this.update(kind, id, () => value, scope);
    },
    async update<T>(
      kind: ResearchExtensionKind,
      id: string,
      updater: (current: T | null) => T | null,
      scope: ResearchExtensionScope = {},
    ) {
      const current = records.get(key(kind, id));
      const next = updater(
        structuredClone((current?.value ?? null) as T | null),
      );
      if (next === null) records.delete(key(kind, id));
      else
        records.set(
          key(kind, id),
          structuredClone({ ...current, ...scope, id, kind, value: next }),
        );
      notifyChange();
      return structuredClone(next);
    },
    async remove(kind, id) {
      records.delete(key(kind, id));
      notifyChange();
    },
    async removeTask(taskId) {
      for (const [id, record] of records)
        if (record.taskId === taskId) records.delete(id);
      notifyChange();
    },
    close() {},
  };
}

let repository: ResearchExtensionRepository | undefined;
export function getResearchExtensionRepository(): ResearchExtensionRepository {
  return (repository ??= createResearchExtensionRepository());
}

export function setResearchExtensionRepositoryForTests(
  next: ResearchExtensionRepository | undefined,
) {
  repository?.close();
  repository = next;
}
