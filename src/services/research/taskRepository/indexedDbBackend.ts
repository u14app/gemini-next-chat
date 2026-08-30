import {
  RESEARCH_TASK_STORAGE_VERSION,
  SESSION_INDEX,
  STORE_NAME,
} from "./constants";
import type { ResearchTaskBackend, StoredResearchTaskRecord } from "./types";

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

export class IndexedDbResearchTaskBackend implements ResearchTaskBackend {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory,
    private readonly dbName: string,
  ) {}

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.factory.open(
        this.dbName,
        RESEARCH_TASK_STORAGE_VERSION,
      );
      request.onupgradeneeded = (event) => {
        const database = request.result;
        const store = database.objectStoreNames.contains(STORE_NAME)
          ? request.transaction!.objectStore(STORE_NAME)
          : database.createObjectStore(STORE_NAME, { keyPath: "taskId" });
        const { oldVersion } = event as IDBVersionChangeEvent;
        if (oldVersion > 0 && oldVersion < RESEARCH_TASK_STORAGE_VERSION) {
          store.clear();
        }
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

  async put(record: StoredResearchTaskRecord): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record);
    await transactionToPromise(transaction);
  }

  async get(taskId: string): Promise<unknown> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readonly");
    return requestToPromise(transaction.objectStore(STORE_NAME).get(taskId));
  }

  async getAll(): Promise<unknown[]> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readonly");
    return requestToPromise(transaction.objectStore(STORE_NAME).getAll());
  }

  async remove(taskId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(taskId);
    await transactionToPromise(transaction);
  }

  async clearSession(sessionId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.index(SESSION_INDEX).openKeyCursor(sessionId);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    await transactionToPromise(transaction);
  }

  async clear(): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    await transactionToPromise(transaction);
  }

  close(): void {
    void this.databasePromise
      ?.then((database) => database.close())
      .catch(() => undefined);
    this.databasePromise = null;
  }
}
