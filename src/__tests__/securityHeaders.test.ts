import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  getContentSecurityPolicy,
  getSecurityHeaders,
} from "../lib/security/headers";
import {
  THEME_INIT_SCRIPT,
  THEME_INIT_SCRIPT_SHA256,
} from "../lib/themeInitScript";

function getCspValue(mode: "local" | "hosted"): string {
  const csp = getSecurityHeaders(mode).find(
    (header) => header.key === "Content-Security-Policy",
  );
  expect(csp).toBeDefined();
  return csp?.value || "";
}

function getDirective(csp: string, directive: string): string {
  return (
    csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${directive} `)) || ""
  );
}

describe("security headers", () => {
  it("keeps the Edge-safe theme hash synchronized with the inline script", () => {
    expect(
      createHash("sha256").update(THEME_INIT_SCRIPT).digest("base64"),
    ).toBe(THEME_INIT_SCRIPT_SHA256);
  });

  it("does not upgrade self-hosted HTTP requests to HTTPS", () => {
    expect(getCspValue("local")).not.toContain("upgrade-insecure-requests");
    expect(getCspValue("hosted")).not.toContain("upgrade-insecure-requests");
  });

  it("keeps local development CSP permissive enough for local proxies", () => {
    const csp = getCspValue("local");

    expect(getDirective(csp, "script-src")).toContain("'unsafe-eval'");
    expect(getDirective(csp, "img-src")).toContain("http:");
    expect(getDirective(csp, "connect-src")).toContain("http:");
  });

  it("keeps hosted scripts nonce-ready without broad JavaScript eval", () => {
    const csp = getCspValue("hosted");

    expect(getDirective(csp, "script-src")).not.toContain("'unsafe-eval'");
    expect(getDirective(csp, "script-src")).not.toContain("'unsafe-inline'");
    expect(getDirective(csp, "script-src")).toContain("'sha256-");
    expect(getDirective(csp, "script-src")).toContain("'wasm-unsafe-eval'");
    expect(getDirective(csp, "img-src")).not.toContain("http:");
    expect(getDirective(csp, "connect-src")).not.toContain("http:");
  });

  it("authorizes one request nonce in hosted HTML responses", () => {
    const scriptSrc = getDirective(
      getContentSecurityPolicy("hosted", "requestnonce"),
      "script-src",
    );

    expect(scriptSrc).toContain("'nonce-requestnonce'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });
});
