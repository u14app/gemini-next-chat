import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const log = vi.hoisted(() => vi.fn());
vi.mock("@/lib/utils/safeServerLog", () => ({ safeServerLogWarn: log }));

import { ApiError } from "@/lib/errors";
import {
  isWebPageChallenge,
  logWebReadFailure,
  normalizeWebReadTransportError,
} from "@/lib/agent/webReadErrors";

describe("web read errors", () => {
  it("logs bounded diagnostic fields without causes, URLs, credentials, or page content", () => {
    const error = new TypeError("fetch failed", {
      cause: Object.assign(
        new Error("https://reader.invalid/?token=private-token"),
        {
          code: "UND_ERR_CONNECT_TIMEOUT",
          authorization: "Bearer private-secret",
          body: "private page content",
        },
      ),
    });
    logWebReadFailure(error, "jina", Date.now());
    expect(log).toHaveBeenLastCalledWith("Web reader request failed:", {
      stage: "jina",
      elapsedMs: expect.any(Number),
      code: "RESPONSE_TIMEOUT",
      statusCode: 504,
      transportCode: "UND_ERR_CONNECT_TIMEOUT",
    });
    expect(JSON.stringify(log.mock.lastCall)).not.toMatch(
      /private|reader.invalid/,
    );
  });

  it("keeps unrelated programmer failures intact", () => {
    const error = new TypeError("Unexpected object shape");
    expect(normalizeWebReadTransportError(error)).toBe(error);
  });

  it("preserves existing typed policy and response-limit errors", () => {
    const error = new ApiError("Blocked", 403, "HOSTED_PROXY_BLOCKED");
    expect(normalizeWebReadTransportError(error)).toBe(error);
  });

  it("recognizes a challenge page with its title and verification text", () => {
    expect(
      isWebPageChallenge(
        "<title>Just a moment...</title><p>Enable JavaScript and cookies to continue</p>",
      ),
    ).toBe(true);
  });

  it("does not reject a technical article that quotes Cloudflare detection code", () => {
    expect(
      isWebPageChallenge(
        "<title>Cloudflare detection</title><p>HTTP 403, cf-mitigated: challenge, window._cf_chl_opt and /cdn-cgi/challenge-platform/ identify challenges.</p>",
      ),
    ).toBe(false);
  });
});
