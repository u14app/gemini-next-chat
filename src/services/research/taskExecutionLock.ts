/** Explicit leases permit owned continuations, never unrelated same-tab actions. */
export interface ResearchTaskExecutionLease {
  readonly taskId: string;
  readonly protectedByWebLock: boolean;
}
const activeLeases = new WeakSet<ResearchTaskExecutionLease>();
const localOwners = new Map<string, ResearchTaskExecutionLease>();
const completions = new WeakMap<ResearchTaskExecutionLease, Promise<void>>();

/** Call after stopping an owned operation, never from inside that lease. */
export async function waitForLocalResearchTaskExecution(
  taskId: string,
): Promise<void> {
  const owner = localOwners.get(taskId);
  if (owner) await completions.get(owner);
}

export function supportsResearchExecutionLock(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.locks?.request === "function"
  );
}
export function isResearchTaskLocallyLocked(taskId: string): boolean {
  return localOwners.has(taskId);
}
export function isResearchTaskExecutionLease(
  lease: ResearchTaskExecutionLease | undefined,
  taskId: string,
): lease is ResearchTaskExecutionLease {
  return Boolean(
    lease &&
    lease.taskId === taskId &&
    activeLeases.has(lease) &&
    localOwners.get(taskId) === lease,
  );
}
export async function withResearchTaskExecutionLock<T>(
  taskId: string,
  operation: (lease: ResearchTaskExecutionLease) => Promise<T>,
  ownedLease?: ResearchTaskExecutionLease,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  if (ownedLease) {
    if (!isResearchTaskExecutionLease(ownedLease, taskId))
      throw new Error("Research execution lease is no longer valid.");
    return { acquired: true, value: await operation(ownedLease) };
  }
  if (localOwners.has(taskId)) return { acquired: false };
  let acquiredLease: ResearchTaskExecutionLease | undefined;
  let released: (() => void) | undefined;
  const execute = async (protectedByWebLock: boolean) => {
    const lease: ResearchTaskExecutionLease = { taskId, protectedByWebLock };
    acquiredLease = lease;
    completions.set(
      lease,
      new Promise<void>((resolve) => {
        released = resolve;
      }),
    );
    localOwners.set(taskId, lease);
    activeLeases.add(lease);
    return { acquired: true as const, value: await operation(lease) };
  };
  try {
    if (!supportsResearchExecutionLock()) return await execute(false);
    return await navigator.locks.request(
      `research-execution:${taskId}`,
      { ifAvailable: true },
      async (lock) => (lock ? execute(true) : { acquired: false as const }),
    );
  } finally {
    // The browser request must settle before stop/delete callers are released.
    // Finishing the callback alone does not prove its native lock was released.
    if (acquiredLease) {
      activeLeases.delete(acquiredLease);
      if (localOwners.get(taskId) === acquiredLease) localOwners.delete(taskId);
      released?.();
    }
  }
}
