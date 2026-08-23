import "server-only";

import {
  ApiError,
  HostedProxyBlockedError,
  ResponseTimeoutError,
} from "../errors";
export { ResponseTimeoutError } from "../errors";
import {
  getSafeUrlPolicy,
  isLocalhostName,
  isPrivateIpAddress,
  redactUrl,
  SafeUrlPolicy,
  validateOutboundUrl,
} from "./urlPolicy";

interface SafeFetchOptions {
  policy?: SafeUrlPolicy;
  timeoutMs?: number;
  maxResponseBytes?: number;
  enforceResponseLimits?: boolean;
  countDecodedText?: boolean;
  signal?: AbortSignal;
}

interface SafeFetchTextResult {
  response: Response;
  text: string;
  url: string;
}

interface SafeFetchTimeout {
  timeoutMs: number;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
}

type LookupAddress = { address: string; family: number };
type DnsPromisesModule = {
  lookup?(
    hostname: string,
    options: { all: true; verbatim: true },
  ): Promise<LookupAddress[]>;
  resolve4?(hostname: string): Promise<string[]>;
  resolve6?(hostname: string): Promise<string[]>;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CROSS_ORIGIN_REDIRECT_SENSITIVE_HEADERS = [
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-api-key",
  "x-goog-api-key",
];

export class ResponseSizeLimitError extends ApiError {
  constructor(readonly maxBytes: number) {
    super(
      `Upstream response exceeded ${maxBytes} bytes`,
      502,
      "RESPONSE_SIZE_LIMIT",
      { maxBytes },
    );
    this.name = "ResponseSizeLimitError";
  }
}

function createSafeFetchTimeout(timeoutMs: number): SafeFetchTimeout {
  const controller = new AbortController();
  return {
    timeoutMs,
    controller,
    timer: setTimeout(
      () => controller.abort(new ResponseTimeoutError(timeoutMs)),
      timeoutMs,
    ),
  };
}

function clearSafeFetchTimeout(timeout: SafeFetchTimeout) {
  clearTimeout(timeout.timer);
}

function createTimeoutError(timeoutMs: number): Error {
  return new ResponseTimeoutError(timeoutMs);
}

function createAbortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("Response read aborted", "AbortError");
  }
  const error = new Error("Response read aborted");
  error.name = "AbortError";
  return error;
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "");
}

function isIpv4Literal(hostname: string): boolean {
  const parts = hostname.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => {
      if (!/^\d+$/.test(part)) return false;
      const value = Number(part);
      return Number.isInteger(value) && value >= 0 && value <= 255;
    })
  );
}

function isIpLiteral(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return isIpv4Literal(normalized) || normalized.includes(":");
}

async function loadNodeDnsModule(): Promise<DnsPromisesModule | null> {
  try {
    const moduleName = "node:dns/promises";
    return (await import(moduleName)) as DnsPromisesModule;
  } catch {
    return null;
  }
}

function isNotImplementedDnsError(error: unknown): boolean {
  return error instanceof Error && /not implemented/i.test(error.message);
}

async function resolveWithWorkerDns(
  dns: DnsPromisesModule,
  hostname: string,
): Promise<LookupAddress[] | null> {
  const lookups: Array<Promise<LookupAddress[]>> = [];

  if (dns.resolve4) {
    lookups.push(
      dns
        .resolve4(hostname)
        .then((addresses) =>
          addresses.map((address) => ({ address, family: 4 })),
        ),
    );
  }
  if (dns.resolve6) {
    lookups.push(
      dns
        .resolve6(hostname)
        .then((addresses) =>
          addresses.map((address) => ({ address, family: 6 })),
        ),
    );
  }

  if (lookups.length === 0) return null;

  const results = await Promise.allSettled(lookups);
  const addresses = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  if (addresses.length > 0) return addresses;

  const rejection = results.find((result) => result.status === "rejected");
  if (rejection?.status === "rejected") throw rejection.reason;
  return null;
}

async function lookupAddresses(
  dns: DnsPromisesModule,
  hostname: string,
): Promise<LookupAddress[] | null> {
  if (!dns.lookup) return resolveWithWorkerDns(dns, hostname);

  try {
    return await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    if (!isNotImplementedDnsError(error)) throw error;
    return resolveWithWorkerDns(dns, hostname);
  }
}

function throwIfTimedOut(timeout: SafeFetchTimeout) {
  if (timeout.controller.signal.aborted) {
    throw timeout.controller.signal.reason instanceof ResponseTimeoutError
      ? timeout.controller.signal.reason
      : createTimeoutError(timeout.timeoutMs);
  }
}

async function lookupWithAbort(
  hostname: string,
  signal: AbortSignal,
): Promise<LookupAddress[] | null> {
  if (signal.aborted) {
    throw createAbortError();
  }
  const dns = await loadNodeDnsModule();
  if (!dns) return null;
  if (signal.aborted) {
    throw createAbortError();
  }

  let abortListener: (() => void) | null = null;
  const abortPromise = new Promise<never>((_, reject) => {
    abortListener = () => reject(createAbortError());
    signal.addEventListener("abort", abortListener, { once: true });
  });

  try {
    return await Promise.race([lookupAddresses(dns, hostname), abortPromise]);
  } finally {
    if (abortListener) {
      signal.removeEventListener("abort", abortListener);
    }
  }
}

async function assertResolvedAddressAllowed(
  url: URL,
  policy: SafeUrlPolicy,
  signal: AbortSignal,
) {
  const hostname = url.hostname;
  const normalizedHostname = normalizeHostname(hostname);

  if (isLocalhostName(normalizedHostname)) {
    if (policy.requirePublicAddress) {
      throw new HostedProxyBlockedError(
        "Outbound requests must target public network addresses",
      );
    }
    return;
  }

  if (isIpLiteral(normalizedHostname)) {
    if (policy.requirePublicAddress && isPrivateIpAddress(normalizedHostname)) {
      throw new HostedProxyBlockedError(
        "Outbound requests must target public network addresses",
      );
    }
    return;
  }

  const addresses = await lookupWithAbort(normalizedHostname, signal);
  if (!addresses?.length) {
    if (policy.requireDnsResolution || policy.requirePublicAddress) {
      throw new HostedProxyBlockedError(
        "DNS validation is unavailable for this outbound request",
      );
    }
    return;
  }

  if (
    policy.requirePublicAddress &&
    addresses.some(({ address }) => isPrivateIpAddress(address))
  ) {
    throw new HostedProxyBlockedError(
      "Outbound requests must target public network addresses",
    );
  }
}

function mergeAbortSignals(
  timeoutSignal: AbortSignal,
  userSignal?: AbortSignal | null,
): { signal: AbortSignal; cleanup: () => void } {
  if (!userSignal) return { signal: timeoutSignal, cleanup: () => {} };

  const controller = new AbortController();
  const abortFromTimeout = () =>
    controller.abort(timeoutSignal.reason || createAbortError());
  const abortFromUser = () =>
    controller.abort(userSignal.reason || createAbortError());
  let isListening = false;

  if (userSignal.aborted) {
    abortFromUser();
  } else if (timeoutSignal.aborted) {
    abortFromTimeout();
  } else {
    timeoutSignal.addEventListener("abort", abortFromTimeout, { once: true });
    userSignal.addEventListener("abort", abortFromUser, { once: true });
    isListening = true;
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (!isListening) return;
      timeoutSignal.removeEventListener("abort", abortFromTimeout);
      userSignal.removeEventListener("abort", abortFromUser);
      isListening = false;
    },
  };
}

function stripCrossOriginRedirectHeaders(
  init: RequestInit,
  fromUrl: URL,
  toUrl: URL,
): RequestInit {
  if (fromUrl.origin === toUrl.origin) return init;

  const headers = new Headers(init.headers);
  for (const header of CROSS_ORIGIN_REDIRECT_SENSITIVE_HEADERS) {
    headers.delete(header);
  }

  return {
    ...init,
    headers,
  };
}

async function readWithLimit(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (signal?.aborted) {
    throw createAbortError();
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (signal?.aborted) {
      throw createAbortError();
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let isListening = false;
  const abortRead = () => {
    void reader.cancel().catch(() => {});
  };

  if (signal) {
    signal.addEventListener("abort", abortRead, { once: true });
    isListening = true;
  }

  try {
    while (true) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      const { done, value } = await reader.read();
      if (signal?.aborted) {
        throw createAbortError();
      }
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ResponseSizeLimitError(maxBytes);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (signal?.aborted) {
      throw createAbortError();
    }
    throw error;
  } finally {
    if (isListening && signal) {
      signal.removeEventListener("abort", abortRead);
    }
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function createLimitedResponse(
  response: Response,
  {
    timeout,
    maxResponseBytes,
    userSignal,
    countDecodedText,
  }: {
    timeout: SafeFetchTimeout;
    maxResponseBytes: number;
    userSignal?: AbortSignal | null;
    countDecodedText?: boolean;
  },
): Response {
  if (!response.body) {
    clearSafeFetchTimeout(timeout);
    return response;
  }

  const reader = response.body.getReader();
  const decoder = countDecodedText ? new TextDecoder() : null;
  const encoder = countDecodedText ? new TextEncoder() : null;
  let total = 0;
  let cleanedUp = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const abortError = () => {
    if (timeout.controller.signal.aborted) {
      return timeout.controller.signal.reason instanceof ResponseTimeoutError
        ? timeout.controller.signal.reason
        : new ResponseTimeoutError(timeout.timeoutMs);
    }
    return createAbortError();
  };
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearSafeFetchTimeout(timeout);
    timeout.controller.signal.removeEventListener("abort", handleAbort);
    userSignal?.removeEventListener("abort", handleAbort);
  };
  const handleAbort = () => {
    const error = abortError();
    void reader.cancel(error).catch(() => undefined);
    controllerRef?.error(error);
    cleanup();
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      timeout.controller.signal.addEventListener("abort", handleAbort, {
        once: true,
      });
      userSignal?.addEventListener("abort", handleAbort, { once: true });
      if (timeout.controller.signal.aborted || userSignal?.aborted) {
        handleAbort();
      }
    },
    async pull(controller) {
      if (timeout.controller.signal.aborted || userSignal?.aborted) {
        handleAbort();
        return;
      }
      try {
        const { done, value } = await reader.read();
        if (timeout.controller.signal.aborted || userSignal?.aborted) {
          handleAbort();
          return;
        }
        if (done) {
          if (decoder && encoder) {
            total += encoder.encode(decoder.decode()).byteLength;
          }
          if (total > maxResponseBytes) {
            const error = new ResponseSizeLimitError(maxResponseBytes);
            controller.error(error);
            cleanup();
            return;
          }
          controller.close();
          cleanup();
          return;
        }
        if (!value) return;
        total +=
          decoder && encoder
            ? encoder.encode(decoder.decode(value, { stream: true })).byteLength
            : value.byteLength;
        if (total > maxResponseBytes) {
          const error = new ResponseSizeLimitError(maxResponseBytes);
          await reader.cancel(error).catch(() => undefined);
          controller.error(error);
          cleanup();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(
          timeout.controller.signal.aborted || userSignal?.aborted
            ? abortError()
            : error,
        );
        cleanup();
      }
    },
    cancel(reason) {
      cleanup();
      return reader.cancel(reason);
    },
  });
  const limited = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  Object.defineProperty(limited, "url", { value: response.url });
  return limited;
}

async function safeFetchResponse(
  input: string | URL,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
  timeoutSignal: AbortSignal,
): Promise<Response> {
  const policy = options.policy || getSafeUrlPolicy("plugin");
  let { url } = validateOutboundUrl(input, policy);
  await assertResolvedAddressAllowed(url, policy, timeoutSignal);

  const maxRedirects = policy.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let requestInit: RequestInit = { ...init };

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    await assertResolvedAddressAllowed(url, policy, timeoutSignal);
    const mergedSignal = mergeAbortSignals(timeoutSignal, requestInit.signal);
    let response: Response;
    try {
      response = await fetch(url, {
        ...requestInit,
        redirect: "manual",
        signal: mergedSignal.signal,
      });
    } finally {
      mergedSignal.cleanup();
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }

    if (redirectCount === maxRedirects) {
      throw new Error(`Too many redirects after ${maxRedirects} hops`);
    }

    await response.body?.cancel();
    const redirectUrl = new URL(location, url);
    const validatedRedirect = validateOutboundUrl(redirectUrl, policy);
    await assertResolvedAddressAllowed(
      validatedRedirect.url,
      policy,
      timeoutSignal,
    );
    requestInit = stripCrossOriginRedirectHeaders(
      requestInit,
      url,
      validatedRedirect.url,
    );
    url = validatedRedirect.url;

    const originalMethod = String(requestInit.method || "GET").toUpperCase();
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) &&
        originalMethod === "POST")
    ) {
      const headers = new Headers(requestInit.headers);
      headers.delete("content-length");
      requestInit = {
        ...requestInit,
        method: "GET",
        body: undefined,
        headers,
      };
    }
  }

  throw new Error(`Too many redirects after ${maxRedirects} hops`);
}

export async function safeFetch(
  input: string | URL,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  const timeout = createSafeFetchTimeout(
    options.timeoutMs || DEFAULT_TIMEOUT_MS,
  );
  const lifecycleSignal = mergeAbortSignals(
    timeout.controller.signal,
    init.signal,
  );
  let responseOwnsTimeout = false;

  try {
    const response = await safeFetchResponse(
      input,
      init,
      options,
      lifecycleSignal.signal,
    );
    if (options.enforceResponseLimits && response.body) {
      responseOwnsTimeout = true;
      return createLimitedResponse(response, {
        timeout,
        maxResponseBytes:
          options.maxResponseBytes || DEFAULT_MAX_RESPONSE_BYTES,
        userSignal: init.signal,
        countDecodedText: options.countDecodedText,
      });
    }
    return response;
  } catch (error) {
    throwIfTimedOut(timeout);
    throw error;
  } finally {
    lifecycleSignal.cleanup();
    if (!responseOwnsTimeout) clearSafeFetchTimeout(timeout);
  }
}

export async function assertOutboundUrlAllowed(
  input: string | URL,
  options: SafeFetchOptions = {},
): Promise<void> {
  const timeout = createSafeFetchTimeout(
    options.timeoutMs || DEFAULT_TIMEOUT_MS,
  );
  const lifecycleSignal = mergeAbortSignals(
    timeout.controller.signal,
    options.signal,
  );

  try {
    const policy = options.policy || getSafeUrlPolicy("plugin");
    const { url } = validateOutboundUrl(input, policy);
    await assertResolvedAddressAllowed(url, policy, lifecycleSignal.signal);
  } catch (error) {
    throwIfTimedOut(timeout);
    throw error;
  } finally {
    lifecycleSignal.cleanup();
    clearSafeFetchTimeout(timeout);
  }
}

export async function safeFetchText(
  input: string | URL,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<SafeFetchTextResult> {
  const timeout = createSafeFetchTimeout(
    options.timeoutMs || DEFAULT_TIMEOUT_MS,
  );
  const lifecycleSignal = mergeAbortSignals(
    timeout.controller.signal,
    init.signal,
  );

  try {
    const response = await safeFetchResponse(
      input,
      init,
      options,
      lifecycleSignal.signal,
    );
    const bytes = await readWithLimit(
      response,
      options.maxResponseBytes || DEFAULT_MAX_RESPONSE_BYTES,
      lifecycleSignal.signal,
    );
    const text = new TextDecoder().decode(bytes);
    return { response, text, url: redactUrl(response.url) };
  } catch (error) {
    throwIfTimedOut(timeout);
    throw error;
  } finally {
    lifecycleSignal.cleanup();
    clearSafeFetchTimeout(timeout);
  }
}

export async function safeFetchJson<T = unknown>(
  input: string | URL,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<{ response: Response; data: T; url: string }> {
  const { response, text, url } = await safeFetchText(input, init, options);
  try {
    return { response, data: JSON.parse(text) as T, url };
  } catch {
    throw new Error("Expected a JSON response from upstream service");
  }
}

export async function safeFetchArrayBuffer(
  input: string | URL,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<{ response: Response; arrayBuffer: ArrayBuffer; url: string }> {
  const timeout = createSafeFetchTimeout(
    options.timeoutMs || DEFAULT_TIMEOUT_MS,
  );
  const lifecycleSignal = mergeAbortSignals(
    timeout.controller.signal,
    init.signal,
  );

  try {
    const response = await safeFetchResponse(
      input,
      init,
      options,
      lifecycleSignal.signal,
    );
    const bytes = await readWithLimit(
      response,
      options.maxResponseBytes || DEFAULT_MAX_RESPONSE_BYTES,
      lifecycleSignal.signal,
    );
    const arrayBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(arrayBuffer).set(bytes);
    return {
      response,
      arrayBuffer,
      url: redactUrl(response.url),
    };
  } catch (error) {
    throwIfTimedOut(timeout);
    throw error;
  } finally {
    lifecycleSignal.cleanup();
    clearSafeFetchTimeout(timeout);
  }
}
