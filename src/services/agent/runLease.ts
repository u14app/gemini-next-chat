const LEASE_VERSION = 1 as const;
const LEASE_PREFIX = "neo-chat:agent-run-lease:";
const OWNER_KEY = "neo-chat:agent-tab-owner";
const DEFAULT_TTL_MS = 2 * 60 * 1_000;

export interface AgentRunLease {
  version: typeof LEASE_VERSION;
  sessionId: string;
  runId: string;
  ownerId: string;
  acquiredAt: number;
  checkpointAt: number;
  expiresAt: number;
}

export type AgentRunLeaseAcquisition =
  | { acquired: true; durable: boolean; lease: AgentRunLease }
  | { acquired: false; durable: true; holder: AgentRunLease };

export class AgentRunLeaseConflictError extends Error {
  readonly holder: AgentRunLease;

  constructor(holder: AgentRunLease) {
    super("Another browser tab currently owns this Agent session.");
    this.name = "AgentRunLeaseConflictError";
    this.holder = holder;
  }
}

function createOwnerId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

let memoryOwnerId: string | undefined;

export function getAgentTabOwnerId(): string {
  if (typeof window === "undefined") return (memoryOwnerId ||= createOwnerId());
  try {
    const existing = window.sessionStorage.getItem(OWNER_KEY);
    if (existing) return existing;
    const owner = createOwnerId();
    window.sessionStorage.setItem(OWNER_KEY, owner);
    return owner;
  } catch {
    return (memoryOwnerId ||= createOwnerId());
  }
}

function getLeaseStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function leaseKey(sessionId: string): string {
  return `${LEASE_PREFIX}${encodeURIComponent(sessionId)}`;
}

function parseLease(value: string | null): AgentRunLease | null {
  if (!value) return null;
  try {
    const lease = JSON.parse(value) as Partial<AgentRunLease>;
    if (
      lease.version !== LEASE_VERSION ||
      typeof lease.sessionId !== "string" ||
      typeof lease.runId !== "string" ||
      typeof lease.ownerId !== "string" ||
      typeof lease.acquiredAt !== "number" ||
      typeof lease.checkpointAt !== "number" ||
      typeof lease.expiresAt !== "number"
    ) {
      return null;
    }
    return lease as AgentRunLease;
  } catch {
    return null;
  }
}

export function acquireAgentRunLease({
  sessionId,
  runId,
  ownerId = getAgentTabOwnerId(),
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
  storage = getLeaseStorage(),
}: {
  sessionId: string;
  runId: string;
  ownerId?: string;
  now?: number;
  ttlMs?: number;
  storage?: Storage | null;
}): AgentRunLeaseAcquisition {
  const lease: AgentRunLease = {
    version: LEASE_VERSION,
    sessionId,
    runId,
    ownerId,
    acquiredAt: now,
    checkpointAt: now,
    expiresAt: now + ttlMs,
  };
  if (!storage) return { acquired: true, durable: false, lease };

  const key = leaseKey(sessionId);
  const current = parseLease(storage.getItem(key));
  if (
    current &&
    current.expiresAt > now &&
    (current.ownerId !== ownerId || current.runId !== runId)
  ) {
    return { acquired: false, durable: true, holder: current };
  }
  storage.setItem(key, JSON.stringify(lease));
  const verified = parseLease(storage.getItem(key));
  if (!verified || verified.ownerId !== ownerId || verified.runId !== runId) {
    return {
      acquired: false,
      durable: true,
      holder: verified || current || lease,
    };
  }
  return { acquired: true, durable: true, lease: verified };
}

export function checkpointAgentRunLease(
  lease: AgentRunLease,
  {
    now = Date.now(),
    ttlMs = DEFAULT_TTL_MS,
    storage = getLeaseStorage(),
  }: { now?: number; ttlMs?: number; storage?: Storage | null } = {},
): AgentRunLease {
  if (!storage) {
    return { ...lease, checkpointAt: now, expiresAt: now + ttlMs };
  }
  const key = leaseKey(lease.sessionId);
  const current = parseLease(storage.getItem(key));
  if (
    !current ||
    current.ownerId !== lease.ownerId ||
    current.runId !== lease.runId
  ) {
    throw new AgentRunLeaseConflictError(current || lease);
  }
  const next = { ...lease, checkpointAt: now, expiresAt: now + ttlMs };
  storage.setItem(key, JSON.stringify(next));
  return next;
}

export function releaseAgentRunLease(
  lease: AgentRunLease,
  storage: Storage | null = getLeaseStorage(),
): void {
  if (!storage) return;
  const key = leaseKey(lease.sessionId);
  const current = parseLease(storage.getItem(key));
  if (current?.ownerId === lease.ownerId && current.runId === lease.runId) {
    storage.removeItem(key);
  }
}
