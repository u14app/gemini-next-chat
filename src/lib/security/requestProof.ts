import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isApiProofProtectedRoute } from "./apiRoutePolicy";
import { getDeploymentMode } from "./deployment";
import { incrementRateLimitBucket } from "./rateLimitStore";

export const API_PROOF_SESSION_COOKIE = "neo_api_proof_session";
export const REQUEST_PROOF_SESSION_PATH = "/api/request-proof/session";
export const API_PROOF_WINDOW_MS = 60_000;
export const API_PROOF_SESSION_TTL_MS = 10 * 60_000;

export const API_PROOF_HEADERS = {
  timestamp: "x-neo-api-proof-timestamp",
  nonce: "x-neo-api-proof-nonce",
  signature: "x-neo-api-proof-signature",
} as const;

export const API_PROOF_ERROR_CODES = {
  notConfigured: "API_PROOF_NOT_CONFIGURED",
  required: "API_PROOF_REQUIRED",
  expired: "API_PROOF_EXPIRED",
  invalid: "API_PROOF_INVALID",
} as const;

interface RequestProofSessionPayload {
  v: 1;
  k: string;
  exp: number;
}

export interface RequestProofSession {
  clientKey: string;
  expiresAt: number;
  serverTime: number;
  cookieValue: string;
  windowMs: number;
  sessionTtlMs: number;
}

export interface ApiProofPublicStatus {
  required: boolean;
  enabled: boolean;
  configured: boolean;
  ephemeral: boolean;
  protectedHighCostApis: boolean;
  windowSeconds: number;
  sessionTtlSeconds: number;
}

declare global {
  var __neoChatRequestProofEphemeralMaterial: string | undefined;
  var __neoChatRequestProofSigningKey:
    | {
        material: string;
        promise: Promise<CryptoKey>;
      }
    | undefined;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function getCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is required for API request proof");
  }
  return globalThis.crypto;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
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

function jsonError(
  status: number,
  payload: Record<string, unknown>,
): NextResponse {
  const response = NextResponse.json(
    { ...payload, statusCode: status },
    { status },
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function getStableByokPrivateKeyPem(): string {
  return process.env.BYOK_PRIVATE_KEY_PEM?.trim().replace(/\\n/g, "\n") || "";
}

function isApiProofConfigured(): boolean {
  return Boolean(getStableByokPrivateKeyPem()) || isApiProofRequired();
}

export function isApiProofRequired(): boolean {
  return getDeploymentMode() === "hosted";
}

export function isApiProofProtectedPath(
  pathname: string,
  method = "POST",
): boolean {
  return isApiProofProtectedRoute(pathname, method);
}

export function getApiProofPublicStatus(): ApiProofPublicStatus {
  const required = isApiProofRequired();
  const configured = isApiProofConfigured();

  return {
    required,
    enabled: required && configured,
    configured,
    ephemeral: required && !getStableByokPrivateKeyPem(),
    protectedHighCostApis: required,
    windowSeconds: API_PROOF_WINDOW_MS / 1000,
    sessionTtlSeconds: API_PROOF_SESSION_TTL_MS / 1000,
  };
}

async function importServerSigningKey(material: string): Promise<CryptoKey> {
  const crypto = getCrypto();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`neo-api-proof:v1:${material}`),
  );
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function getServerSigningKey(): Promise<CryptoKey | null> {
  let material = getStableByokPrivateKeyPem();
  if (!material && isApiProofRequired()) {
    globalThis.__neoChatRequestProofEphemeralMaterial ??= createClientKey();
    material = globalThis.__neoChatRequestProofEphemeralMaterial;
  }
  if (!material) return null;

  if (globalThis.__neoChatRequestProofSigningKey?.material !== material) {
    globalThis.__neoChatRequestProofSigningKey = {
      material,
      promise: importServerSigningKey(material),
    };
  }

  return globalThis.__neoChatRequestProofSigningKey.promise;
}

async function importClientProofKey(clientKey: string): Promise<CryptoKey> {
  return getCrypto().subtle.importKey(
    "raw",
    toArrayBuffer(base64UrlToBytes(clientKey)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signString(key: CryptoKey, value: string): Promise<string> {
  const signature = await getCrypto().subtle.sign(
    "HMAC",
    key,
    encoder.encode(value),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verifyString(
  key: CryptoKey,
  value: string,
  signature: string,
): Promise<boolean> {
  try {
    return getCrypto().subtle.verify(
      "HMAC",
      key,
      toArrayBuffer(base64UrlToBytes(signature)),
      encoder.encode(value),
    );
  } catch {
    return false;
  }
}

async function signSessionPayload(
  payload: RequestProofSessionPayload,
): Promise<string> {
  const key = await getServerSigningKey();
  if (!key) return "";

  const payloadValue = bytesToBase64Url(
    encoder.encode(JSON.stringify(payload)),
  );
  const signature = await signString(key, payloadValue);
  return `${payloadValue}.${signature}`;
}

async function verifySessionPayload(
  cookieValue: string | undefined,
  now: number,
): Promise<RequestProofSessionPayload | null> {
  const [payloadValue, signature] = (cookieValue || "").trim().split(".");
  if (!payloadValue || !signature) return null;

  const key = await getServerSigningKey();
  if (!key) return null;

  const isValid = await verifyString(key, payloadValue, signature);
  if (!isValid) return null;

  try {
    const payload = JSON.parse(
      decoder.decode(base64UrlToBytes(payloadValue)),
    ) as Partial<RequestProofSessionPayload>;
    if (payload.v !== 1 || !payload.k || typeof payload.exp !== "number") {
      return null;
    }
    if (payload.exp <= now) return null;
    return payload as RequestProofSessionPayload;
  } catch {
    return null;
  }
}

function createClientKey(): string {
  const bytes = new Uint8Array(32);
  getCrypto().getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function createRequestProofSession(
  now = Date.now(),
): Promise<RequestProofSession> {
  const clientKey = createClientKey();
  const expiresAt = now + API_PROOF_SESSION_TTL_MS;
  const cookieValue = await signSessionPayload({
    v: 1,
    k: clientKey,
    exp: expiresAt,
  });

  return {
    clientKey,
    expiresAt,
    serverTime: now,
    cookieValue,
    windowMs: API_PROOF_WINDOW_MS,
    sessionTtlMs: API_PROOF_SESSION_TTL_MS,
  };
}

export async function createRequestProofSessionResponse(): Promise<NextResponse> {
  const status = getApiProofPublicStatus();
  const serverTime = Date.now();
  if (!status.required) {
    const response = NextResponse.json({ enabled: false, serverTime });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  if (!status.configured) {
    return jsonError(503, {
      error: "API request proof is not configured",
      code: API_PROOF_ERROR_CODES.notConfigured,
    });
  }
  const session = await createRequestProofSession(serverTime);
  const response = NextResponse.json({
    enabled: true,
    clientKey: session.clientKey,
    expiresAt: session.expiresAt,
    serverTime: session.serverTime,
    windowMs: session.windowMs,
  });
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(API_PROOF_SESSION_COOKIE, session.cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: API_PROOF_SESSION_TTL_MS / 1000,
  });
  return response;
}

export async function getRequestProofRateLimitIdentity(
  request: NextRequest,
  now = Date.now(),
): Promise<string | null> {
  const session = await verifySessionPayload(
    request.cookies.get(API_PROOF_SESSION_COOKIE)?.value,
    now,
  );
  if (!session) return null;

  const digest = await getCrypto().subtle.digest(
    "SHA-256",
    encoder.encode(`neo-api-rate-limit:v1:${session.k}`),
  );
  return `proof:${bytesToBase64Url(new Uint8Array(digest))}`;
}

export function getRequestProofSigningInput({
  method,
  target,
  timestamp,
  nonce,
}: {
  method: string;
  target: string;
  timestamp: number | string;
  nonce: string;
}): string {
  return `${method.toUpperCase()}\n${target}\n${timestamp}\n${nonce}`;
}

export async function createRequestProofHeaders({
  clientKey,
  method,
  target,
  timestamp,
  nonce,
}: {
  clientKey: string;
  method: string;
  target: string;
  timestamp: number;
  nonce: string;
}): Promise<Record<string, string>> {
  const key = await importClientProofKey(clientKey);
  const signature = await signString(
    key,
    getRequestProofSigningInput({ method, target, timestamp, nonce }),
  );

  return {
    [API_PROOF_HEADERS.timestamp]: String(timestamp),
    [API_PROOF_HEADERS.nonce]: nonce,
    [API_PROOF_HEADERS.signature]: signature,
  };
}

function getRequestTarget(request: NextRequest): string {
  return `${request.nextUrl.pathname}${request.nextUrl.search}`;
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.trunc(timestamp);
}

function isNonceValid(value: string | null): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{8,128}$/.test(value));
}

async function markRequestProofNonce(
  session: RequestProofSessionPayload,
  nonce: string,
  now: number,
): Promise<boolean> {
  const key = `api-proof:${session.k}:${nonce}`;
  const bucket = await incrementRateLimitBucket(key, API_PROOF_WINDOW_MS, now);
  return bucket.count === 1;
}

export async function enforceApiRequestProof(
  request: NextRequest,
  now = Date.now(),
): Promise<NextResponse | null> {
  if (
    !isApiProofRequired() ||
    !isApiProofProtectedPath(request.nextUrl.pathname, request.method)
  ) {
    return null;
  }

  if (!isApiProofConfigured()) {
    return jsonError(503, {
      error: "API request proof is not configured",
      code: API_PROOF_ERROR_CODES.notConfigured,
    });
  }

  const session = await verifySessionPayload(
    request.cookies.get(API_PROOF_SESSION_COOKIE)?.value,
    now,
  );
  if (!session) {
    return jsonError(401, {
      error: "API request proof is required",
      code: API_PROOF_ERROR_CODES.required,
    });
  }

  const timestampHeader = request.headers.get(API_PROOF_HEADERS.timestamp);
  const nonce = request.headers.get(API_PROOF_HEADERS.nonce);
  const signature = request.headers.get(API_PROOF_HEADERS.signature);
  const timestamp = parseTimestamp(timestampHeader);

  if (timestamp === null || !isNonceValid(nonce) || !signature) {
    return jsonError(401, {
      error: "API request proof is invalid",
      code: API_PROOF_ERROR_CODES.invalid,
    });
  }

  if (Math.abs(now - timestamp) > API_PROOF_WINDOW_MS) {
    return jsonError(401, {
      error: "API request proof has expired",
      code: API_PROOF_ERROR_CODES.expired,
    });
  }

  const key = await importClientProofKey(session.k);
  const isValid = await verifyString(
    key,
    getRequestProofSigningInput({
      method: request.method,
      target: getRequestTarget(request),
      timestamp: timestampHeader!,
      nonce,
    }),
    signature,
  );
  if (!isValid) {
    return jsonError(401, {
      error: "API request proof is invalid",
      code: API_PROOF_ERROR_CODES.invalid,
    });
  }

  const isFreshNonce = await markRequestProofNonce(session, nonce, now);
  if (!isFreshNonce) {
    return jsonError(401, {
      error: "API request proof is invalid",
      code: API_PROOF_ERROR_CODES.invalid,
    });
  }

  return null;
}

export function clearRequestProofSigningKeyForTesting(): void {
  globalThis.__neoChatRequestProofSigningKey = undefined;
  globalThis.__neoChatRequestProofEphemeralMaterial = undefined;
}
