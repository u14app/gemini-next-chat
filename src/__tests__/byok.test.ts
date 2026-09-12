import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { clearByokPublicKeyCache, encryptSecret } from "../lib/byok/client";
import {
  decryptSecretEnvelope,
  getByokPublicKey,
  resolveProviderRuntimeConfig,
} from "../lib/byok/server";
import { ProviderRuntimeConfigSchema } from "../lib/api/schemas";
import {
  clearLocalSecretKeyCache,
  encryptLocalSecret,
  LOCAL_SECRET_CONTEXTS,
} from "../lib/security/localSecrets";

const originalEnv = {
  DEPLOYMENT_MODE: process.env.DEPLOYMENT_MODE,
  BYOK_ALLOW_EPHEMERAL_KEY: process.env.BYOK_ALLOW_EPHEMERAL_KEY,
  BYOK_KEY_ID: process.env.BYOK_KEY_ID,
  BYOK_PRIVATE_KEY_PEM: process.env.BYOK_PRIVATE_KEY_PEM,
  DEFAULT_MODEL_CONTEXT_COMPRESSION:
    process.env.DEFAULT_MODEL_CONTEXT_COMPRESSION,
  DEFAULT_MODEL_MEMORY: process.env.DEFAULT_MODEL_MEMORY,
  DEFAULT_MODEL_PROMPT_OPTIMIZATION:
    process.env.DEFAULT_MODEL_PROMPT_OPTIMIZATION,
  DEFAULT_MODEL_RAG_QUERY: process.env.DEFAULT_MODEL_RAG_QUERY,
  DEFAULT_MODEL_RELATED_QUESTIONS: process.env.DEFAULT_MODEL_RELATED_QUESTIONS,
  DEFAULT_MODEL_TITLE_GENERATION: process.env.DEFAULT_MODEL_TITLE_GENERATION,
  DEFAULT_PROVIDER_API_KEY: process.env.DEFAULT_PROVIDER_API_KEY,
  DEFAULT_PROVIDER_BASE_URL: process.env.DEFAULT_PROVIDER_BASE_URL,
  DEFAULT_PROVIDER_MODELS: process.env.DEFAULT_PROVIDER_MODELS,
  DEFAULT_PROVIDER_NAME: process.env.DEFAULT_PROVIDER_NAME,
  DEFAULT_PROVIDER_TYPE: process.env.DEFAULT_PROVIDER_TYPE,
  NODE_ENV: process.env.NODE_ENV,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      setEnv(key, value);
    }
  }
}

function setEnv(key: string, value: string) {
  (process.env as Record<string, string | undefined>)[key] = value;
}

function clearDefaultProviderEnv() {
  for (const key of Object.keys(originalEnv)) {
    if (
      key.startsWith("DEFAULT_MODEL_") ||
      key.startsWith("DEFAULT_PROVIDER_")
    ) {
      delete process.env[key];
    }
  }
}

function resetByokKeyMaterial() {
  globalThis.__neoChatByokKeyMaterial = undefined;
}

describe("BYOK secret envelopes", () => {
  it("uses a process-local hosted key in production even when ephemeral opt-in is false", async () => {
    resetByokKeyMaterial();
    setEnv("DEPLOYMENT_MODE", "hosted");
    setEnv("NODE_ENV", "production");
    setEnv("BYOK_ALLOW_EPHEMERAL_KEY", "false");
    delete process.env.BYOK_PRIVATE_KEY_PEM;
    const first = await getByokPublicKey();
    expect(first.kid).toBeTruthy();
    expect(await getByokPublicKey()).toEqual(first);
    resetByokKeyMaterial();
    expect((await getByokPublicKey()).kid).not.toBe(first.kid);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    restoreEnv();
    resetByokKeyMaterial();
    clearByokPublicKeyCache();
    clearLocalSecretKeyCache();
    globalThis.__neoChatLocalSecretKeyMaterial = undefined;
  });

  it("requires a stable private key in local production without opt-in", async () => {
    vi.resetModules();
    resetByokKeyMaterial();
    setEnv("NODE_ENV", "production");
    setEnv("DEPLOYMENT_MODE", "local");
    delete process.env.BYOK_ALLOW_EPHEMERAL_KEY;
    delete process.env.BYOK_PRIVATE_KEY_PEM;

    const { getByokPublicKey: freshGetByokPublicKey } =
      await import("../lib/byok/server");

    await expect(freshGetByokPublicKey()).rejects.toMatchObject({
      code: "BYOK_KEY_NOT_CONFIGURED",
    });
  });

  it("imports escaped-newline private keys from the environment", async () => {
    vi.resetModules();
    resetByokKeyMaterial();
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicExponent: 0x10001,
    });
    const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    setEnv("NODE_ENV", "production");
    process.env.BYOK_PRIVATE_KEY_PEM = pem.replace(/\n/g, "\\n");

    const {
      decryptSecretEnvelope: freshDecryptSecretEnvelope,
      getByokPublicKey: freshGetByokPublicKey,
    } = await import("../lib/byok/server");
    const { encryptSecret: freshEncryptSecret } =
      await import("../lib/byok/client");

    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(await freshGetByokPublicKey()),
    );

    const envelope = await freshEncryptSecret("escaped-pem", "provider:Gemini");

    await expect(
      freshDecryptSecretEnvelope(envelope!, "provider:Gemini"),
    ).resolves.toBe("escaped-pem");
  });

  it("rejects invalid public key responses", async () => {
    vi.resetModules();
    const { encryptSecret: freshEncryptSecret } =
      await import("../lib/byok/client");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        kid: "bad-key",
        alg: "RSA-OAEP-256+A256GCM",
        publicKeyJwk: { kty: "EC" },
      }),
    );

    await expect(
      freshEncryptSecret("secret", "provider:Gemini"),
    ).rejects.toThrow(/Invalid BYOK RSA public key/);
  });

  it("cancels a caller waiting for the shared public key request", async () => {
    vi.resetModules();
    const {
      clearByokPublicKeyCache: clearFreshCache,
      encryptSecret: freshEncryptSecret,
    } = await import("../lib/byok/client");
    let requestSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = init?.signal || undefined;
          requestSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const controller = new AbortController();

    const pending = freshEncryptSecret(
      "secret",
      "provider:Gemini",
      controller.signal,
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(requestSignal?.aborted).toBe(false);

    clearFreshCache();
    expect(requestSignal?.aborted).toBe(true);
  });

  it("reports the public-key watchdog as a timeout, not caller cancellation", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { encryptSecret: freshEncryptSecret } =
      await import("../lib/byok/client");
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      });
    });

    const request = freshEncryptSecret("secret", "provider:Gemini");
    const expectation = expect(request).rejects.toMatchObject({
      name: "ResponseTimeoutError",
      code: "RESPONSE_TIMEOUT",
      statusCode: 504,
    });
    await vi.advanceTimersByTimeAsync(30_000);

    await expectation;
  });

  it("refreshes the public key and retries BYOK auth failures once", async () => {
    vi.resetModules();
    resetByokKeyMaterial();
    const { encryptSecret: freshEncryptSecret, fetchWithByokRetry } =
      await import("../lib/byok/client");
    const { getByokPublicKey: freshGetByokPublicKey } =
      await import("../lib/byok/server");
    const apiBodies: string[] = [];
    let apiCalls = 0;
    let publicKeyCalls = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/byok/public-key") {
        publicKeyCalls += 1;
        return Response.json(await freshGetByokPublicKey());
      }

      apiCalls += 1;
      apiBodies.push(String(init?.body || ""));
      if (apiCalls === 1) {
        return Response.json(
          {
            error: "BYOK key id does not match this server",
            code: "AUTH_ERROR",
            statusCode: 401,
          },
          { status: 401 },
        );
      }

      return Response.json({ ok: true });
    });

    const response = await fetchWithByokRetry(async () => {
      const apiKeySecret = await freshEncryptSecret(
        "retry-secret",
        "provider:Gemini",
      );
      return fetch("/api/test", {
        method: "POST",
        body: JSON.stringify({ apiKeySecret }),
      });
    });

    expect(response.status).toBe(200);
    expect(apiCalls).toBe(2);
    expect(publicKeyCalls).toBe(2);
    expect(JSON.stringify(apiBodies)).not.toContain("retry-secret");
  });

  it("retries loading the public key after a failed request", async () => {
    vi.resetModules();
    const { encryptSecret: freshEncryptSecret } =
      await import("../lib/byok/client");
    const {
      decryptSecretEnvelope: freshDecryptSecretEnvelope,
      getByokPublicKey: freshGetByokPublicKey,
    } = await import("../lib/byok/server");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockImplementation(async () =>
        Response.json(await freshGetByokPublicKey()),
      );

    await expect(
      freshEncryptSecret("retry-secret", "provider:Gemini"),
    ).rejects.toThrow(/Failed to load BYOK public key/);

    const envelope = await freshEncryptSecret(
      "retry-secret",
      "provider:Gemini",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(
      freshDecryptSecretEnvelope(envelope!, "provider:Gemini"),
    ).resolves.toBe("retry-secret");
  });

  it("roundtrips encrypted secrets through the server keypair", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(await getByokPublicKey()),
    );

    const envelope = await encryptSecret("sk-test-secret", "provider:Gemini");

    expect(envelope).toMatchObject({
      v: 1,
      alg: "RSA-OAEP-256+A256GCM",
      context: "provider:Gemini",
    });
    expect(JSON.stringify(envelope)).not.toContain("sk-test-secret");
    await expect(
      decryptSecretEnvelope(envelope!, "provider:Gemini"),
    ).resolves.toBe("sk-test-secret");
  });

  it("decrypts legacy Gemini provider envelopes after provider type normalization", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(await getByokPublicKey()),
    );

    const envelope = await encryptSecret(
      "legacy-gemini-secret",
      "provider:Gemini",
    );
    const provider = ProviderRuntimeConfigSchema.parse({
      type: "Gemini",
      apiKeySecret: envelope,
    });

    expect(provider.type).toBe("Google");
    await expect(resolveProviderRuntimeConfig(provider)).resolves.toMatchObject(
      {
        type: "Google",
        apiKey: "legacy-gemini-secret",
      },
    );
  });

  it("rejects browser credentials when the server-default provider is unavailable", async () => {
    clearDefaultProviderEnv();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(await getByokPublicKey()),
    );
    const apiKeySecret = await encryptSecret(
      "browser-secret",
      "provider:OpenAI",
    );
    const provider = ProviderRuntimeConfigSchema.parse({
      type: "OpenAI",
      source: "server-default",
      apiKeySecret,
    });

    await expect(resolveProviderRuntimeConfig(provider)).rejects.toMatchObject({
      name: "ApiError",
      statusCode: 503,
      code: "SERVER_DEFAULT_PROVIDER_UNAVAILABLE",
    });
  });

  it("rejects browser credentials when the server-default provider type changed", async () => {
    clearDefaultProviderEnv();
    setEnv("DEFAULT_PROVIDER_TYPE", "Anthropic");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(await getByokPublicKey()),
    );
    const apiKeySecret = await encryptSecret(
      "browser-secret",
      "provider:OpenAI",
    );
    const provider = ProviderRuntimeConfigSchema.parse({
      type: "OpenAI",
      source: "server-default",
      apiKeySecret,
    });

    await expect(resolveProviderRuntimeConfig(provider)).rejects.toMatchObject({
      name: "ValidationError",
      statusCode: 400,
      code: "VALIDATION_ERROR",
    });
  });

  it.each([
    ["overrides", "server-secret"],
    ["supplements", undefined],
  ])(
    "%s browser credentials only with the current server-default provider type",
    async (_action, serverApiKey) => {
      clearDefaultProviderEnv();
      setEnv("DEFAULT_PROVIDER_TYPE", "OpenAI");
      setEnv("DEFAULT_PROVIDER_NAME", "Current default");
      setEnv("DEFAULT_PROVIDER_BASE_URL", "https://gateway.example.com/v1");
      if (serverApiKey) {
        setEnv("DEFAULT_PROVIDER_API_KEY", serverApiKey);
      }
      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        Response.json(await getByokPublicKey()),
      );
      const apiKeySecret = await encryptSecret(
        "browser-secret",
        "provider:OpenAI",
      );
      const provider = ProviderRuntimeConfigSchema.parse({
        type: "OpenAI",
        source: "server-default",
        apiKeySecret,
      });

      await expect(resolveProviderRuntimeConfig(provider)).resolves.toEqual({
        type: "OpenAI",
        name: "Current default",
        baseUrl: "https://gateway.example.com/v1",
        apiKey: "browser-secret",
      });
    },
  );

  it("builds provider BYOK envelopes from encrypted local secrets", async () => {
    vi.resetModules();
    resetByokKeyMaterial();
    const {
      decryptSecretEnvelope: freshDecryptSecretEnvelope,
      getByokPublicKey: freshGetByokPublicKey,
    } = await import("../lib/byok/server");
    const { buildProviderRuntimeConfig } = await import("../lib/byok/client");

    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(await freshGetByokPublicKey()),
    );
    const apiKeySecret = await encryptLocalSecret(
      "local-provider-secret",
      LOCAL_SECRET_CONTEXTS.providerApiKey("LOCAL1"),
    );

    const runtime = await buildProviderRuntimeConfig({
      id: "LOCAL1",
      name: "Local Gemini",
      type: "Google",
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "",
      apiKeySecret,
      enabled: true,
      models: [],
      modelsList: [],
    });

    expect(JSON.stringify(runtime)).not.toContain("local-provider-secret");
    await expect(
      freshDecryptSecretEnvelope(runtime.apiKeySecret!, "provider:Google"),
    ).resolves.toBe("local-provider-secret");
  });

  it("rejects mismatched key ids and contexts", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(await getByokPublicKey()),
    );

    const envelope = await encryptSecret("secret", "search:tavily");

    await expect(
      decryptSecretEnvelope(
        { ...envelope!, kid: "other-key" },
        "search:tavily",
      ),
    ).rejects.toMatchObject({ name: "AuthenticationError" });
    await expect(
      decryptSecretEnvelope(envelope!, "search:exa"),
    ).rejects.toMatchObject({ name: "AuthenticationError" });
  });

  it("rejects tampered ciphertext", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(await getByokPublicKey()),
    );

    const envelope = await encryptSecret("secret", "rag:token");

    await expect(
      decryptSecretEnvelope(
        {
          ...envelope!,
          ciphertext: `${envelope!.ciphertext[0] === "A" ? "B" : "A"}${envelope!.ciphertext.slice(1)}`,
        },
        "rag:token",
      ),
    ).rejects.toMatchObject({ name: "AuthenticationError" });
  });
});
