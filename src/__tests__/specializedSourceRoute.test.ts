import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), decrypt: vi.fn() }));
vi.mock("@/lib/security/safeFetch", () => ({ safeFetchText: mocks.fetch }));
vi.mock("@/lib/byok/server", () => ({ decryptOptionalSecret: mocks.decrypt }));
import { POST } from "@/app/api/plugins/execute/route";
import { RESEARCH_SOURCE_PLUGINS } from "@/lib/plugin/researchSources/catalog";
import { createPluginFunctionFingerprint } from "@/lib/plugin/confirmation";
import { clearResearchSourceTransportForTests } from "@/lib/plugin/researchSources/transport";
const request = (body: unknown) =>
  new Request("http://localhost/api/plugins/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as NextRequest;
beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.decrypt.mockReset().mockResolvedValue("");
  clearResearchSourceTransportForTests();
  vi.stubEnv("DEPLOYMENT_MODE", "local");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("specialized registered plugin route", () => {
  it("dispatches a canonical registered read with expected fingerprint", async () => {
    const plugin = RESEARCH_SOURCE_PLUGINS[0];
    const functionDef = plugin.functions[1];
    const text = readFileSync(
      new URL("./fixtures/researchSources/arxiv.xml", import.meta.url),
      "utf8",
    );
    mocks.fetch.mockResolvedValue({
      response: new Response(text),
      text,
      url: "https://export.arxiv.org/api/query",
    });
    const response = await POST(
      request({
        pluginId: plugin.id,
        functionName: functionDef.name,
        expectedFingerprint: await createPluginFunctionFingerprint(
          plugin,
          functionDef,
        ),
        args: { id: "2401.00001v2" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: { operation: "read", documents: [{ id: "2401.00001v2" }] },
    });
    expect(mocks.fetch.mock.calls[0][0]).toContain(
      "export.arxiv.org/api/query?",
    );
  });
  it("rejects unexpected parameters and fingerprint changes before networking", async () => {
    expect(
      (
        await POST(
          request({
            pluginId: "arxiv",
            functionName: "read_arxiv",
            args: { id: "2401.00001v2", url: "https://attacker.invalid" },
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request({
            pluginId: "arxiv",
            functionName: "read_arxiv",
            expectedFingerprint: "changed",
            args: { id: "2401.00001v2" },
          }),
        )
      ).status,
    ).toBe(409);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("rejects legacy payloads claiming a specialized built-in identity", async () => {
    const plugin = RESEARCH_SOURCE_PLUGINS[0];
    const response = await POST(
      request({
        plugin: { ...plugin, baseUrl: "https://attacker.invalid" },
        functionDef: plugin.functions[0],
        args: { query: "topic" },
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "SOURCE_REGISTERED_EXECUTION_REQUIRED",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
