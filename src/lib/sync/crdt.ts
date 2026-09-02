import type * as AutomergeModule from "@automerge/automerge";
import type {
  SyncConflict,
  SyncCrdtDocument,
  SyncDocumentKind,
  SyncJsonValue,
} from "./types";
import { SYNC_FORMAT_VERSION } from "./types";

const CONTAINER_MARKER = "__neo_chat_sync_container_v1__";
const GENESIS_ACTOR = "00000000000000000000000000000000";

type AutomergeApi = typeof AutomergeModule;
type SyncDoc = AutomergeModule.Doc<SyncCrdtDocument>;
type MutableRecord = Record<string, unknown>;

let automergePromise: Promise<AutomergeApi> | undefined;

export function loadAutomerge(): Promise<AutomergeApi> {
  // The slim entrypoint retains a generated URL fallback which Turbopack may
  // emit as an unused asset. Supplying embedded bytes here keeps that fallback
  // dormant, so sync initialization never fetches a deployment-suffixed URL.
  automergePromise ||= Promise.all([
    import("@automerge/automerge/slim"),
    import("@automerge/automerge/automerge.wasm.base64"),
  ]).then(async ([api, { automergeWasmBase64 }]) => {
    await api.initializeBase64Wasm(automergeWasmBase64);
    return api;
  });
  return automergePromise;
}

export async function deriveAutomergeActorId(
  deviceId: string,
): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto is required to derive a sync actor ID.");
  }
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`neo-chat-sync-actor-v1:${deviceId}`),
    ),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function toSyncJson(value: unknown): SyncJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => toSyncJson(item));
  if (isRecord(value)) {
    const output: Record<string, SyncJsonValue> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested !== undefined && typeof nested !== "function") {
        output[key] = toSyncJson(nested);
      }
    }
    return output;
  }
  return null;
}

function encodeValue(value: SyncJsonValue): SyncJsonValue {
  if (!Array.isArray(value)) {
    if (!isRecord(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        encodeValue(nested as SyncJsonValue),
      ]),
    ) as Record<string, SyncJsonValue>;
  }

  const idItems = value.every(
    (item) =>
      isRecord(item) && typeof item.id === "string" && item.id.length > 0,
  );
  if (idItems) {
    const items: Record<string, SyncJsonValue> = {};
    const order: Record<string, SyncJsonValue> = {};
    value.forEach((item, index) => {
      const id = String((item as Record<string, unknown>).id);
      items[id] = encodeValue(item);
      order[id] = index;
    });
    return { [CONTAINER_MARKER]: "id-list", items, order };
  }

  const uniqueStrings =
    value.every((item) => typeof item === "string" && item.length > 0) &&
    new Set(value).size === value.length;
  if (uniqueStrings) {
    const items: Record<string, SyncJsonValue> = {};
    const order: Record<string, SyncJsonValue> = {};
    value.forEach((item, index) => {
      const id = String(item);
      items[id] = true;
      order[id] = index;
    });
    return { [CONTAINER_MARKER]: "string-set", items, order };
  }

  const items: Record<string, SyncJsonValue> = {};
  value.forEach((item, index) => {
    items[String(index)] = encodeValue(item);
  });
  return { [CONTAINER_MARKER]: "list", items, length: value.length };
}

function decodeValue(value: SyncJsonValue): SyncJsonValue {
  if (!isRecord(value)) {
    return Array.isArray(value) ? value.map(decodeValue) : value;
  }
  if (value[CONTAINER_MARKER] === "id-list" && isRecord(value.items)) {
    const order = isRecord(value.order) ? value.order : {};
    return Object.entries(value.items)
      .sort(([left], [right]) => {
        const leftOrder = Number(order[left]);
        const rightOrder = Number(order[right]);
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return left.localeCompare(right);
      })
      .map(([, item]) => decodeValue(toSyncJson(item)));
  }
  const stringItems = value.items;
  if (value[CONTAINER_MARKER] === "string-set" && isRecord(stringItems)) {
    const order = isRecord(value.order) ? value.order : {};
    return Object.keys(stringItems)
      .filter((item) => stringItems[item] === true)
      .sort((left, right) => {
        const leftOrder = Number(order[left]);
        const rightOrder = Number(order[right]);
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return left.localeCompare(right);
      });
  }
  if (value[CONTAINER_MARKER] === "list" && isRecord(value.items)) {
    return Object.entries(value.items)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([, item]) => decodeValue(toSyncJson(item)));
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== CONTAINER_MARKER)
      .map(([key, nested]) => [key, decodeValue(toSyncJson(nested))]),
  ) as Record<string, SyncJsonValue>;
}

function sameScalar(left: unknown, right: unknown): boolean {
  return (
    left === right ||
    (typeof left === "number" &&
      typeof right === "number" &&
      Number.isNaN(left) &&
      Number.isNaN(right))
  );
}

function reconcileRecord(
  target: MutableRecord,
  source: Record<string, unknown>,
): void {
  for (const key of Object.keys(target)) {
    if (!(key in source)) delete target[key];
  }
  for (const [key, next] of Object.entries(source)) {
    const current = target[key];
    if (isRecord(current) && isRecord(next)) {
      reconcileRecord(current as MutableRecord, next);
    } else if (!sameScalar(current, next)) {
      target[key] = next;
    }
  }
}

function addMissingRecord(
  target: MutableRecord,
  source: Record<string, unknown>,
): void {
  for (const [key, next] of Object.entries(source)) {
    const current = target[key];
    if (current === undefined) {
      target[key] = next;
    } else if (isRecord(current) && isRecord(next)) {
      addMissingRecord(current as MutableRecord, next);
    }
  }
}

async function createGenesis(
  logicalId: string,
  kind: SyncDocumentKind,
): Promise<{ api: AutomergeApi; bytes: Uint8Array }> {
  const api = await loadAutomerge();
  const genesis = api.from<SyncCrdtDocument>(
    {
      formatVersion: SYNC_FORMAT_VERSION,
      logicalId,
      kind,
      payload: {},
    },
    { actor: GENESIS_ACTOR },
  );
  return { api, bytes: api.save(genesis) };
}

export async function createSyncDocument(
  logicalId: string,
  kind: SyncDocumentKind,
  payload: unknown,
  deviceId: string,
): Promise<SyncDoc> {
  const { api, bytes } = await createGenesis(logicalId, kind);
  const base = api.load<SyncCrdtDocument>(bytes, {
    actor: await deriveAutomergeActorId(deviceId),
  });
  const encoded = encodeValue(toSyncJson(payload));
  return api.change(base, "initialize local sync document", (draft) => {
    draft.payload.value = encoded;
  });
}

export async function loadSyncDocument(
  bytes: Uint8Array,
  deviceId?: string,
): Promise<SyncDoc> {
  const api = await loadAutomerge();
  const doc = api.load<SyncCrdtDocument>(
    bytes,
    deviceId ? { actor: await deriveAutomergeActorId(deviceId) } : undefined,
  );
  if (
    doc.formatVersion !== SYNC_FORMAT_VERSION ||
    typeof doc.logicalId !== "string" ||
    !doc.payload
  ) {
    throw new Error("Unsupported encrypted sync document.");
  }
  return doc;
}

export async function saveSyncDocument(doc: SyncDoc): Promise<Uint8Array> {
  return (await loadAutomerge()).save(doc);
}

export async function mergeSyncDocuments(
  local: SyncDoc,
  remote: SyncDoc,
): Promise<SyncDoc> {
  if (local.logicalId !== remote.logicalId || local.kind !== remote.kind) {
    throw new Error("Cannot merge unrelated sync documents.");
  }
  const api = await loadAutomerge();
  return api.merge(local, api.clone(remote));
}

export async function applyLocalPayload(
  base: SyncDoc,
  payload: unknown,
): Promise<SyncDoc> {
  const encoded = encodeValue(toSyncJson(payload));
  return (await loadAutomerge()).change(
    base,
    "record local application changes",
    (draft) =>
      reconcileRecord(draft.payload as MutableRecord, { value: encoded }),
  );
}

export async function addInitialLocalPayload(
  base: SyncDoc,
  payload: unknown,
): Promise<SyncDoc> {
  const encoded = encodeValue(toSyncJson(payload));
  return (await loadAutomerge()).change(
    base,
    "merge first local application snapshot",
    (draft) =>
      addMissingRecord(draft.payload as MutableRecord, { value: encoded }),
  );
}

export function readSyncDocumentPayload(doc: SyncDoc): SyncJsonValue {
  return decodeValue(toSyncJson(doc.payload.value));
}

function collectConflictsAt(
  api: AutomergeApi,
  node: Record<string, unknown>,
  documentId: string,
  path: string[],
  output: SyncConflict[],
): void {
  for (const [key, value] of Object.entries(node)) {
    const conflicts = api.getConflicts(node, key);
    if (conflicts && Object.keys(conflicts).length > 1) {
      const values = Object.values(conflicts).map((item) => toSyncJson(item));
      output.push({
        id: `${documentId}:${[...path, key].join("/")}`,
        documentId,
        path: [...path, key],
        currentValue: toSyncJson(value),
        values,
      });
    }
    if (isRecord(value)) {
      collectConflictsAt(api, value, documentId, [...path, key], output);
    }
  }
}

export async function collectSyncConflicts(
  doc: SyncDoc,
): Promise<SyncConflict[]> {
  const output: SyncConflict[] = [];
  collectConflictsAt(
    await loadAutomerge(),
    doc.payload as Record<string, unknown>,
    doc.logicalId,
    [],
    output,
  );
  return output;
}

export async function resolveSyncDocumentConflict(
  doc: SyncDoc,
  path: string[],
  value: SyncJsonValue,
): Promise<SyncDoc> {
  if (path.length === 0) throw new Error("A conflict path is required.");
  return (await loadAutomerge()).change(
    doc,
    "resolve sync conflict",
    (draft) => {
      let target: MutableRecord = draft.payload as MutableRecord;
      for (const segment of path.slice(0, -1)) {
        const nested = target[segment];
        if (!isRecord(nested)) throw new Error("Sync conflict path is stale.");
        target = nested as MutableRecord;
      }
      target[path[path.length - 1]] = value;
    },
  );
}
