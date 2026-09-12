import { isApiProofProtectedRoute } from "../security/apiRoutePolicy";
import { ResponseTimeoutError } from "../errors";

const API_PROOF_SESSION_PATH = "/api/request-proof/session";
const API_PROOF_REFRESH_SKEW_MS = 60_000;
const API_PROOF_SESSION_TIMEOUT_MS = 30_000;
const API_PROOF_HEADERS = {
  timestamp: "x-neo-api-proof-timestamp",
  nonce: "x-neo-api-proof-nonce",
  signature: "x-neo-api-proof-signature",
} as const;

interface RequestProofSessionResponse {
  enabled: boolean;
  clientKey?: string;
  expiresAt?: number;
  serverTime?: number;
  windowMs?: number;
}

interface CachedRequestProofSession {
  enabled: boolean;
  clientKey?: string;
  expiresAt?: number;
  serverTimeOffsetMs: number;
}

let apiProofSession: CachedRequestProofSession | null = null;
let apiProofSessionPromise: Promise<CachedRequestProofSession> | null = null;
let apiProofSessionController: AbortController | null = null;
let apiProofCryptoKey: {
  clientKey: string;
  promise: Promise<CryptoKey>;
} | null = null;

const encoder = new TextEncoder();

function createAbortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  if (typeof DOMException !== "undefined") {
    return new DOMException("The operation was aborted", "AbortError");
  }
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError(signal);
}

async function waitForCaller<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return promise;

  let abortListener: (() => void) | null = null;
  const aborted = new Promise<never>((_, reject) => {
    abortListener = () => reject(createAbortError(signal));
    signal.addEventListener("abort", abortListener, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (abortListener) signal.removeEventListener("abort", abortListener);
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const base64 = padded.padEnd(
    padded.length + ((4 - (padded.length % 4)) % 4),
    "=",
  );
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function resolveFetchUrl(input: RequestInfo | URL): URL | null {
  const raw = input instanceof Request ? input.url : String(input);
  try {
    if (typeof window !== "undefined") {
      const url = new URL(raw, window.location.href);
      return url.origin === window.location.origin ? url : null;
    }

    if (!raw.startsWith("/")) return null;
    return new URL(raw, "https://neo.local");
  } catch {
    return null;
  }
}

function getFetchMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (
    init?.method ||
    (input instanceof Request ? input.method : undefined) ||
    "GET"
  ).toUpperCase();
}

function getMergedHeaders(
  input: RequestInfo | URL,
  init?: RequestInit,
): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : {});
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value);
    });
  }
  return headers;
}

function isRequestProofSessionUsable(
  session: CachedRequestProofSession | null,
): session is CachedRequestProofSession {
  if (!session) return false;
  if (!session.enabled) return true;
  if (!session.expiresAt) return false;
  return (
    session.expiresAt - (Date.now() + session.serverTimeOffsetMs) >
    API_PROOF_REFRESH_SKEW_MS
  );
}

function parseRequestProofSession(
  data: RequestProofSessionResponse,
): CachedRequestProofSession {
  const serverTime = typeof data.serverTime === "number" ? data.serverTime : 0;
  if (!data.enabled) {
    return {
      enabled: false,
      serverTimeOffsetMs: serverTime ? serverTime - Date.now() : 0,
    };
  }

  if (!data.clientKey || typeof data.expiresAt !== "number") {
    throw new Error("Invalid API request proof session");
  }

  return {
    enabled: true,
    clientKey: data.clientKey,
    expiresAt: data.expiresAt,
    serverTimeOffsetMs: serverTime ? serverTime - Date.now() : 0,
  };
}

async function loadApiProofSession(
  signal: AbortSignal,
): Promise<CachedRequestProofSession> {
  const response = await fetch(API_PROOF_SESSION_PATH, {
    method: "GET",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(
      await getResponseErrorMessage(
        response,
        "API request proof is not available",
      ),
    );
  }

  const data = await readJsonResponseOrThrow<RequestProofSessionResponse>(
    response,
    "API request proof is not available",
  );
  return parseRequestProofSession(data);
}

async function getApiProofSession(
  signal?: AbortSignal,
): Promise<CachedRequestProofSession> {
  if (isRequestProofSessionUsable(apiProofSession)) return apiProofSession;
  if (!apiProofSessionPromise) {
    const controller = new AbortController();
    apiProofSessionController = controller;
    const timeout = setTimeout(
      () =>
        controller.abort(
          new ResponseTimeoutError(
            API_PROOF_SESSION_TIMEOUT_MS,
            "API request proof session",
          ),
        ),
      API_PROOF_SESSION_TIMEOUT_MS,
    );
    const request = loadApiProofSession(controller.signal)
      .then((session) => {
        apiProofSession = session;
        return session;
      })
      .catch((error) => {
        if (apiProofSessionPromise === request) {
          apiProofSessionPromise = null;
        }
        if (controller.signal.reason instanceof ResponseTimeoutError) {
          throw controller.signal.reason;
        }
        throw error;
      })
      .finally(() => {
        clearTimeout(timeout);
        if (apiProofSessionPromise === request) {
          apiProofSessionPromise = null;
        }
        if (apiProofSessionController === controller) {
          apiProofSessionController = null;
        }
      });
    apiProofSessionPromise = request;
  }
  return waitForCaller(apiProofSessionPromise, signal);
}

async function importApiProofKey(clientKey: string): Promise<CryptoKey> {
  if (apiProofCryptoKey?.clientKey !== clientKey) {
    apiProofCryptoKey = {
      clientKey,
      promise: crypto.subtle.importKey(
        "raw",
        toArrayBuffer(base64UrlToBytes(clientKey)),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      ),
    };
  }
  return apiProofCryptoKey.promise;
}

function createApiProofNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function getApiProofSigningInput({
  method,
  target,
  timestamp,
  nonce,
}: {
  method: string;
  target: string;
  timestamp: string;
  nonce: string;
}): string {
  return `${method.toUpperCase()}\n${target}\n${timestamp}\n${nonce}`;
}

async function createApiProofHeaders({
  clientKey,
  method,
  target,
  timestamp,
  nonce,
  signal,
}: {
  clientKey: string;
  method: string;
  target: string;
  timestamp: string;
  nonce: string;
  signal?: AbortSignal;
}): Promise<Record<string, string>> {
  const key = await waitForCaller(importApiProofKey(clientKey), signal);
  throwIfAborted(signal);
  const signature = await waitForCaller(
    crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(
        getApiProofSigningInput({ method, target, timestamp, nonce }),
      ),
    ),
    signal,
  );
  throwIfAborted(signal);

  return {
    [API_PROOF_HEADERS.timestamp]: timestamp,
    [API_PROOF_HEADERS.nonce]: nonce,
    [API_PROOF_HEADERS.signature]: bytesToBase64Url(new Uint8Array(signature)),
  };
}

export function clearApiProofSessionCache(): void {
  apiProofSessionController?.abort();
  apiProofSessionController = null;
  apiProofSession = null;
  apiProofSessionPromise = null;
  apiProofCryptoKey = null;
}

export async function signedApiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = resolveFetchUrl(input);
  const method = getFetchMethod(input, init);
  const signal =
    init?.signal ?? (input instanceof Request ? input.signal : undefined);
  if (!url || !isApiProofProtectedRoute(url.pathname, method)) {
    return fetch(input, init);
  }

  // Keep a replayable Request before fetch consumes its body. Stream bodies in
  // RequestInit cannot be replayed; their original response is returned below.
  const replayInput = input instanceof Request ? input.clone() : input;
  for (let attempt = 0; ; attempt += 1) {
    const session = await getApiProofSession(signal);
    throwIfAborted(signal);
    const target = `${url.pathname}${url.search}`;
    const timestamp = String(
      Math.trunc(Date.now() + session.serverTimeOffsetMs),
    );
    const headers = getMergedHeaders(input, init);
    const proofHeaders =
      session.enabled && session.clientKey
        ? await createApiProofHeaders({
            clientKey: session.clientKey,
            method,
            target,
            timestamp,
            nonce: createApiProofNonce(),
            signal,
          })
        : {};
    for (const [key, value] of Object.entries(proofHeaders)) {
      headers.set(key, value);
    }

    throwIfAborted(signal);
    const response = await fetch(attempt === 0 ? input : replayInput, {
      ...init,
      headers,
    });
    if (
      attempt > 0 ||
      response.status !== 401 ||
      init?.body instanceof ReadableStream
    ) {
      return response;
    }
    const error = await readJsonResponse<{ code?: string }>(response.clone());
    if (
      !error?.code ||
      ![
        "API_PROOF_REQUIRED",
        "API_PROOF_INVALID",
        "API_PROOF_EXPIRED",
      ].includes(error.code)
    ) {
      return response;
    }
    // Concurrent failures from an old session must not discard a newer session
    // or cancel another caller's in-flight handshake.
    if (apiProofSession === session) {
      apiProofSession = null;
      apiProofCryptoKey = null;
    }
    throwIfAborted(signal);
  }
}

export async function readJsonResponse<T = unknown>(
  response: Response,
): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function readJsonResponseOrThrow<T = unknown>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const data = await readJsonResponse<T>(response);
  if (data === null) {
    throw new Error(fallbackMessage);
  }
  return data;
}

export async function getResponseErrorMessage(
  response: Response,
  fallbackMessage: string,
): Promise<string> {
  const data = await readJsonResponse<any>(response);
  const message =
    data?.error?.message || data?.error || data?.message || data?.details;

  return typeof message === "string" && message.trim()
    ? message
    : fallbackMessage;
}
