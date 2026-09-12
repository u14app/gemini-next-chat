import "server-only";

import { ApiError, AuthenticationError, ValidationError } from "../errors";
import {
  BYOK_ALG,
  ByokPublicKeyResponse,
  EncryptedSecretEnvelope,
} from "./shared";
import { base64UrlToBytes } from "./encoding";
import type { ProviderRuntimeConfig } from "../security/urlPolicy";
import { getDefaultProviderRuntimeConfig } from "../defaultConfig/server";
import { getSpkiKeyId, parsePkcs8RsaPrivateKeyPem } from "./pem";
import { getDeploymentMode } from "../security/deployment";
import {
  GOOGLE_PROVIDER_TYPE,
  LEGACY_GEMINI_PROVIDER_TYPE,
} from "../providers/providerTypes";

interface ByokKeyMaterial extends ByokPublicKeyResponse {
  privateKey: CryptoKey;
}

declare global {
  var __neoChatByokKeyMaterial: Promise<ByokKeyMaterial> | undefined;
}

const RSA_ALGORITHM = { name: "RSA-OAEP", hash: "SHA-256" } as const;

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function getCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new ApiError(
      "Web Crypto is not available in this runtime",
      500,
      "WEB_CRYPTO_UNAVAILABLE",
    );
  }
  return globalThis.crypto;
}

function getConfiguredPrivateKeyPem(): string | undefined {
  const pem = process.env.BYOK_PRIVATE_KEY_PEM?.trim();
  return pem ? pem.replace(/\\n/g, "\n") : undefined;
}

function shouldAllowEphemeralKey(): boolean {
  return (
    getDeploymentMode() === "hosted" ||
    process.env.BYOK_ALLOW_EPHEMERAL_KEY === "true" ||
    process.env.NODE_ENV !== "production"
  );
}

async function importPrivateKeyFromPem(pem: string): Promise<ByokKeyMaterial> {
  const crypto = getCrypto();
  const { privateKeyJwk, publicKeyJwk, spkiDer } =
    parsePkcs8RsaPrivateKeyPem(pem);
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    RSA_ALGORITHM,
    false,
    ["unwrapKey"],
  );

  return {
    kid: process.env.BYOK_KEY_ID?.trim() || (await getSpkiKeyId(spkiDer)),
    alg: BYOK_ALG,
    publicKeyJwk,
    privateKey,
  };
}

async function generateEphemeralKeyMaterial(): Promise<ByokKeyMaterial> {
  const crypto = getCrypto();
  const keyPair = await crypto.subtle.generateKey(
    {
      ...RSA_ALGORITHM,
      modulusLength: 3072,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
    },
    true,
    ["wrapKey", "unwrapKey"],
  );
  const spki = new Uint8Array(
    await crypto.subtle.exportKey("spki", keyPair.publicKey),
  );
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

  return {
    kid: await getSpkiKeyId(spki),
    alg: BYOK_ALG,
    publicKeyJwk,
    privateKey: keyPair.privateKey,
  };
}

async function loadKeyMaterial(): Promise<ByokKeyMaterial> {
  const privateKeyPem = getConfiguredPrivateKeyPem();
  if (privateKeyPem) {
    return importPrivateKeyFromPem(privateKeyPem);
  }

  if (!shouldAllowEphemeralKey()) {
    throw new ApiError(
      "BYOK_PRIVATE_KEY_PEM is required in production",
      500,
      "BYOK_KEY_NOT_CONFIGURED",
    );
  }

  return generateEphemeralKeyMaterial();
}

async function getKeyMaterial(): Promise<ByokKeyMaterial> {
  if (!globalThis.__neoChatByokKeyMaterial) {
    globalThis.__neoChatByokKeyMaterial = loadKeyMaterial().catch((error) => {
      globalThis.__neoChatByokKeyMaterial = undefined;
      throw error;
    });
  }

  return globalThis.__neoChatByokKeyMaterial;
}

export async function getByokPublicKey(): Promise<ByokPublicKeyResponse> {
  const { kid, alg, publicKeyJwk } = await getKeyMaterial();
  return { kid, alg, publicKeyJwk };
}

export async function decryptSecretEnvelope(
  envelope: EncryptedSecretEnvelope,
  expectedContext: string,
): Promise<string> {
  const keyMaterial = await getKeyMaterial();

  if (envelope.v !== 1 || envelope.alg !== BYOK_ALG) {
    throw new ValidationError("Unsupported BYOK secret envelope");
  }
  if (envelope.kid !== keyMaterial.kid) {
    throw new AuthenticationError("BYOK key id does not match this server");
  }
  if (envelope.context !== expectedContext) {
    throw new AuthenticationError("BYOK secret context does not match request");
  }

  try {
    const crypto = getCrypto();
    const aesKey = await crypto.subtle.unwrapKey(
      "raw",
      bytesToArrayBuffer(base64UrlToBytes(envelope.wrappedKey)),
      keyMaterial.privateKey,
      RSA_ALGORITHM,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytesToArrayBuffer(base64UrlToBytes(envelope.iv)),
        additionalData: new TextEncoder().encode(envelope.context),
      },
      aesKey,
      bytesToArrayBuffer(base64UrlToBytes(envelope.ciphertext)),
    );

    return new TextDecoder().decode(plaintext);
  } catch {
    throw new AuthenticationError("Unable to decrypt BYOK secret");
  }
}

export async function decryptOptionalSecret(
  envelope: EncryptedSecretEnvelope | undefined,
  expectedContext: string,
): Promise<string | undefined> {
  if (!envelope) return undefined;
  return decryptSecretEnvelope(envelope, expectedContext);
}

function getProviderSecretContext(provider: ProviderRuntimeConfig): string {
  const context = `provider:${provider.type}`;
  const legacyGeminiContext = `provider:${LEGACY_GEMINI_PROVIDER_TYPE}`;
  if (
    provider.type === GOOGLE_PROVIDER_TYPE &&
    provider.apiKeySecret?.context === legacyGeminiContext
  ) {
    return legacyGeminiContext;
  }

  return context;
}

export async function resolveProviderRuntimeConfig(
  provider: ProviderRuntimeConfig,
): Promise<ProviderRuntimeConfig> {
  if (provider.source === "server-default") {
    const defaultProvider = getDefaultProviderRuntimeConfig();
    if (!defaultProvider) {
      throw new ApiError(
        "Server-default provider is unavailable",
        503,
        "SERVER_DEFAULT_PROVIDER_UNAVAILABLE",
      );
    }
    if (provider.type !== defaultProvider.type) {
      throw new ValidationError(
        "Server-default provider type does not match this request",
      );
    }

    const apiKey = await decryptOptionalSecret(
      provider.apiKeySecret,
      getProviderSecretContext(provider),
    );
    return apiKey ? { ...defaultProvider, apiKey } : defaultProvider;
  }

  const apiKey = await decryptOptionalSecret(
    provider.apiKeySecret,
    getProviderSecretContext(provider),
  );

  return apiKey ? { ...provider, apiKey } : provider;
}
