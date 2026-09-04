import { SearchRequestError } from "@/lib/search/errors";
import { RESEARCH_SEARCH_LIMITS } from "@/lib/search/requestPolicy";

/** One FIFO for Research in this JavaScript realm, shared by both tool aliases. */
let tail = Promise.resolve();
let lastStartedAt = -Infinity;
let cooldownUntil = 0;

async function waitUntil(at: number, signal: AbortSignal): Promise<void> {
  while (at > Date.now()) {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(
        () => {
          signal.removeEventListener("abort", abort);
          resolve();
        },
        Math.min(2_147_483_647, at - Date.now()),
      );
      signal.addEventListener("abort", abort, { once: true });
    });
  }
}

export function dispatchResearchSearch<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  { signal, deadlineAt }: { signal?: AbortSignal; deadlineAt?: number },
): Promise<T> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });
  const deadlineTimer =
    deadlineAt === undefined
      ? undefined
      : setTimeout(
          () =>
            controller.abort(
              new DOMException(
                "Research search deadline elapsed.",
                "TimeoutError",
              ),
            ),
          Math.max(0, deadlineAt - Date.now()),
        );
  if (deadlineAt !== undefined && deadlineAt <= Date.now()) {
    controller.abort(
      new DOMException("Research search deadline elapsed.", "TimeoutError"),
    );
  }

  const scheduled = tail.then(async () => {
    controller.signal.throwIfAborted();
    await waitUntil(
      Math.max(
        lastStartedAt + RESEARCH_SEARCH_LIMITS.minStartIntervalMs,
        cooldownUntil,
      ),
      controller.signal,
    );
    controller.signal.throwIfAborted();
    lastStartedAt = Date.now();
    const requestTimer = setTimeout(
      () =>
        controller.abort(
          new SearchRequestError(
            "Research search request timed out after 90000ms",
            504,
            "RESEARCH_SEARCH_TIMEOUT",
            "client",
          ),
        ),
      RESEARCH_SEARCH_LIMITS.requestTimeoutMs,
    );
    try {
      return await operation(controller.signal);
    } catch (error) {
      if (error instanceof SearchRequestError && error.status === 429) {
        cooldownUntil = Math.max(
          cooldownUntil,
          Date.now() +
            (error.retryAfterMs ?? RESEARCH_SEARCH_LIMITS.rateLimitCooldownMs),
        );
      }
      throw error;
    } finally {
      clearTimeout(requestTimer);
    }
  });
  // Cancellation rejects the caller immediately, but the slot stays occupied
  // until its transport settles. A late/abort-ignoring request cannot overlap.
  tail = scheduled.then(
    () => undefined,
    () => undefined,
  );
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(deadlineTimer);
      signal?.removeEventListener("abort", forwardAbort);
      controller.signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      reject(controller.signal.reason);
      cleanup();
    };
    if (controller.signal.aborted) abort();
    else controller.signal.addEventListener("abort", abort, { once: true });
    scheduled.then(resolve, reject).finally(cleanup);
  });
}
