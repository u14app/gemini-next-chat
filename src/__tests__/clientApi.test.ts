import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearApiProofSessionCache,
  getResponseErrorMessage,
  readJsonResponse,
  readJsonResponseOrThrow,
  signedApiFetch,
} from "../lib/api/client";

describe("client API response helpers", () => {
  it.each(["API_PROOF_REQUIRED", "API_PROOF_INVALID", "API_PROOF_EXPIRED"])(
    "renews the proof session once for %s and preserves the request body",
    async (code) => {
      let sessions = 0;
      let requests = 0;
      const bodies: unknown[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        if (String(input) === "/api/request-proof/session") {
          sessions += 1;
          return Response.json({
            enabled: true,
            clientKey: btoa(`session-${sessions}`),
            expiresAt: Date.now() + 600_000,
            serverTime: Date.now(),
          });
        }
        requests += 1;
        bodies.push(init?.body);
        return requests === 1
          ? Response.json({ code }, { status: 401 })
          : Response.json({ ok: true });
      });
      expect(
        (
          await signedApiFetch("/api/chat", {
            method: "POST",
            body: '{"prompt":"hello"}',
          })
        ).status,
      ).toBe(200);
      expect(sessions).toBe(2);
      expect(requests).toBe(2);
      expect(bodies).toEqual(['{"prompt":"hello"}', '{"prompt":"hello"}']);
    },
  );

  it.each(["API_PROOF_INVALID", "AUTH_ERROR"])(
    "bounds retries and preserves the final %s response",
    async (code) => {
      let requests = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        if (String(input) === "/api/request-proof/session")
          return Response.json({
            enabled: true,
            clientKey: btoa("session"),
            expiresAt: Date.now() + 600_000,
          });
        requests += 1;
        return Response.json({ code }, { status: 401 });
      });
      const response = await signedApiFetch("/api/chat", { method: "POST" });
      expect(await response.json()).toEqual({ code });
      expect(requests).toBe(code === "AUTH_ERROR" ? 1 : 2);
    },
  );

  afterEach(() => {
    clearApiProofSessionCache();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("parses JSON responses and returns null for empty or malformed bodies", async () => {
    await expect(
      readJsonResponse<{ ok: boolean }>(Response.json({ ok: true })),
    ).resolves.toEqual({ ok: true });
    await expect(readJsonResponse(new Response(""))).resolves.toBeNull();
    await expect(
      readJsonResponse(new Response("<html>Proxy error</html>")),
    ).resolves.toBeNull();
  });

  it("throws a stable fallback when successful response JSON is malformed", async () => {
    await expect(
      readJsonResponseOrThrow(new Response("<html></html>"), "Bad response"),
    ).rejects.toThrow("Bad response");
  });

  it("extracts public error messages with a stable fallback", async () => {
    await expect(
      getResponseErrorMessage(Response.json({ error: "Nope" }), "Fallback"),
    ).resolves.toBe("Nope");
    await expect(
      getResponseErrorMessage(
        Response.json({ error: { message: "Nested nope" } }),
        "Fallback",
      ),
    ).resolves.toBe("Nested nope");
    await expect(
      getResponseErrorMessage(new Response("<html></html>"), "Fallback"),
    ).resolves.toBe("Fallback");
  });

  it("signs protected API requests with a cached request proof session", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input) === "/api/request-proof/session") {
            return Response.json({
              enabled: true,
              clientKey: "dGVzdC1jbGllbnQtcHJvb2Yta2V5",
              expiresAt: Date.now() + 600_000,
              serverTime: Date.now(),
              windowMs: 60_000,
            });
          }

          return Response.json({
            ok: true,
            headers: Object.fromEntries(new Headers(init?.headers).entries()),
            body: init?.body,
            signal: init?.signal ? "present" : "missing",
          });
        },
      );
    const controller = new AbortController();

    const response = await signedApiFetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
      signal: controller.signal,
    });
    const data = await response.json();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(data.headers["content-type"]).toBe("application/json");
    expect(data.headers["x-neo-api-proof-timestamp"]).toBeTruthy();
    expect(data.headers["x-neo-api-proof-nonce"]).toBeTruthy();
    expect(data.headers["x-neo-api-proof-signature"]).toBeTruthy();
    expect(data.body).toBe(JSON.stringify({ ok: true }));
    expect(data.signal).toBe("present");

    await signedApiFetch("/api/search", { method: "POST" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not add proof headers when the server reports proof disabled", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/request-proof/session") {
          return Response.json({
            enabled: false,
            serverTime: Date.now(),
          });
        }

        return Response.json({
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
        });
      },
    );

    const response = await signedApiFetch("/api/chat", { method: "POST" });
    const data = await response.json();

    expect(data.headers["x-neo-api-proof-signature"]).toBeUndefined();
  });

  it("stops waiting for the shared proof handshake when its caller aborts", async () => {
    let resolveSession!: (response: Response) => void;
    const sessionResponse = new Promise<Response>((resolve) => {
      resolveSession = resolve;
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/request-proof/session") {
          return sessionResponse;
        }
        return Response.json({ ok: true });
      });
    const controller = new AbortController();

    const request = signedApiFetch("/api/chat", {
      method: "POST",
      signal: controller.signal,
    });
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveSession(Response.json({ enabled: false, serverTime: Date.now() }));
    await Promise.resolve();
  });

  it("reports the proof handshake watchdog as a timeout, not caller cancellation", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      });
    });

    const request = signedApiFetch("/api/chat", { method: "POST" });
    const expectation = expect(request).rejects.toMatchObject({
      name: "ResponseTimeoutError",
      code: "RESPONSE_TIMEOUT",
      statusCode: 504,
    });
    await vi.advanceTimersByTimeAsync(30_000);

    await expectation;
  });
});
