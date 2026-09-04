import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { RESEARCH_SOURCE_PLUGINS } from "@/lib/plugin/researchSources/catalog";
import {
  parseArxiv,
  parsePatents,
  parsePubmed,
  parseSourceXml,
} from "@/lib/plugin/researchSources/parsers";
import {
  runResearchSource,
  executeResearchSourceRequest,
} from "@/lib/plugin/researchSources/server";
import {
  normalizeSpecializedSourceResult,
  prepareSpecializedSourceCall,
  getSpecializedCheckpointUsage,
} from "@/lib/plugin/researchSources/client";
import { collectAgentEvidenceRecords } from "@/lib/agent/evidence";
import { getPluginFunctionInvocationPolicy } from "@/lib/plugin/risk";
import type { ResearchSourceFetch } from "@/lib/plugin/researchSources/transport";
import type { BuiltinResearchQueryBudget } from "@/services/api/chat/builtinTools/types";
import type { ToolCall } from "@/types";
const fixture = (name: string) =>
  readFileSync(
    new URL(`./fixtures/researchSources/${name}.xml`, import.meta.url),
    "utf8",
  );

describe("specialized research source documents", () => {
  it("keeps every catalog operation network-read only", () => {
    expect(RESEARCH_SOURCE_PLUGINS).toHaveLength(4);
    for (const plugin of RESEARCH_SOURCE_PLUGINS)
      for (const fn of plugin.functions)
        expect(getPluginFunctionInvocationPolicy(fn).effects).toEqual([
          "network_read",
        ]);
  });
  it("parses namespaced arXiv versions and labels missing abstracts", () => {
    const result = parseArxiv(fixture("arxiv"));
    expect(result.map((d) => d.id)).toEqual([
      "2401.00001v2",
      "hep-th/9901001v1",
    ]);
    expect(result[0].content).toContain("methods & their limits");
    expect(result[1]).toMatchObject({
      coverage: "metadata_only",
      missing: ["abstract"],
    });
  });
  it("reads NLM XML without resolving its external DTD", () => {
    expect(parsePubmed(fixture("pubmed"))[0]).toMatchObject({
      id: "12345678",
      publishedAt: "2023-09-10",
      title: "Evidence & limitations",
      coverage: "abstract_and_metadata",
    });
  });
  it("reads EPO document identity and public content", () => {
    expect(parsePatents(fixture("epo"))[0]).toMatchObject({
      id: "EP.1000000.A1",
      publishedAt: "2000-05-17",
      coverage: "abstract_and_metadata",
    });
  });
  it("rejects custom entities, excessive nesting and malformed XML", () => {
    expect(() =>
      parseSourceXml(
        '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///secret">]><x>&x;</x>',
      ),
    ).toThrow(/entities/);
    expect(() => parseSourceXml("<x>".repeat(65) + "</x>".repeat(65))).toThrow(
      /nesting/,
    );
    expect(() => parseSourceXml("<x><y></x>")).toThrow(/malformed/);
  });
  it("creates independent discovery identities, formalizes only reads, and leaves empty search empty", async () => {
    const base = {
      provider: "arxiv" as const,
      operation: "search" as const,
      documents: parseArxiv(fixture("arxiv")),
    };
    const result = await normalizeSpecializedSourceResult(
      base,
      "arxiv",
      "search",
    );
    const discovery = collectAgentEvidenceRecords(result, {
      toolCallId: "search",
      defaultKind: "mcp",
    });
    expect(discovery).toHaveLength(2);
    expect(new Set(discovery.map((e) => e.sourceId)).size).toBe(2);
    expect(discovery.every((e) => e.retrievalKind === "search")).toBe(true);
    const read = await normalizeSpecializedSourceResult(
      { ...base, operation: "read", documents: [base.documents[0]] },
      "arxiv",
      "read",
    );
    expect(
      collectAgentEvidenceRecords(read, {
        toolCallId: "read",
        defaultKind: "mcp",
      })[0].retrievalKind,
    ).toBe("fetch");
    const empty = await normalizeSpecializedSourceResult(
      { ...base, documents: [] },
      "arxiv",
      "search",
    );
    expect(
      collectAgentEvidenceRecords(empty, {
        toolCallId: "empty",
        defaultKind: "mcp",
      }),
    ).toEqual([]);
  });
  it("reserves query budget, clamps results/dates, blocks replay and excluded providers", () => {
    const budget: BuiltinResearchQueryBudget = {
      remainingQueries: 2,
      maxResultsPerQuery: 3,
      seenQueries: new Set(),
      searchPolicy: {
        preferredDomains: ["arxiv.org"],
        excludedDomains: [],
        dateFrom: "2024-01-01",
      },
    };
    expect(
      prepareSpecializedSourceCall(
        "arxiv",
        "search",
        { query: "retrieval", limit: 20, dateFrom: "2020-01-01" },
        budget,
      ),
    ).toMatchObject({ args: { limit: 3, dateFrom: "2024-01-01" } });
    expect(budget.remainingQueries).toBe(1);
    expect(
      prepareSpecializedSourceCall(
        "arxiv",
        "search",
        { query: "retrieval", dateFrom: "2020-01-01" },
        budget,
      ),
    ).toMatchObject({ error: { error: { code: "RESEARCH_QUERY_DUPLICATE" } } });
    expect(
      prepareSpecializedSourceCall("pubmed", "read", { id: "123" }, budget),
    ).toMatchObject({
      error: { error: { code: "RESEARCH_SOURCE_SCOPE_DENIED" } },
    });
  });
  it("does not promote a read outside the approved date range", async () => {
    const result = await normalizeSpecializedSourceResult(
      {
        provider: "arxiv",
        operation: "read",
        documents: parseArxiv(fixture("arxiv")).slice(0, 1),
      },
      "arxiv",
      "read",
      { preferredDomains: [], excludedDomains: [], dateFrom: "2025-01-01" },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "RESEARCH_SOURCE_SCOPE_DENIED" },
    });
    expect(
      collectAgentEvidenceRecords(result, {
        toolCallId: "read",
        defaultKind: "mcp",
      }),
    ).toEqual([]);
  });
  it("restores specialized query and read usage from committed tool calls", () => {
    const calls = [
      {
        name: "search_pubmed",
        pluginId: "pubmed",
        args: { query: "Review", dateFrom: "2020-01-01" },
      },
      { name: "read_pubmed", pluginId: "pubmed", args: { id: "1234" } },
    ] as ToolCall[];
    expect(getSpecializedCheckpointUsage(calls)).toEqual({
      queries: ["pubmed:review:2020-01-01::"],
      locators: ["plugin://pubmed/document/1234"],
    });
  });
});

describe("official provider adapters", () => {
  it("arXiv validates identifiers before networking and preserves exact versions", async () => {
    const fetch = vi
      .fn<ResearchSourceFetch>()
      .mockResolvedValue(fixture("arxiv"));
    await expect(
      runResearchSource({
        provider: "arxiv",
        operation: "read",
        args: { id: "../../secret" },
        fetch,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_ARGUMENT_INVALID" });
    expect(fetch).not.toHaveBeenCalled();
    const response = await runResearchSource({
      provider: "arxiv",
      operation: "read",
      args: { id: "2401.00001v2" },
      fetch,
    });
    expect(response.documents).toHaveLength(1);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get("id_list")).toBe(
      "2401.00001v2",
    );
  });
  it("PubMed uses no API key when missing and does not fetch summaries after empty search", async () => {
    const fetch = vi
      .fn<ResearchSourceFetch>()
      .mockResolvedValue('{"esearchresult":{"idlist":[]}}');
    expect(
      (
        await runResearchSource({
          provider: "pubmed",
          operation: "search",
          args: { query: "empty" },
          fetch,
        })
      ).documents,
    ).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.has("api_key")).toBe(
      false,
    );
  });
  it("PubMed attaches an optional key only to official E-utilities requests", async () => {
    const fetch = vi
      .fn<ResearchSourceFetch>()
      .mockResolvedValue(fixture("pubmed"));
    const result = await runResearchSource({
      provider: "pubmed",
      operation: "read",
      args: { id: "12345678" },
      auth: "fixture-key",
      fetch,
    });
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get("api_key")).toBe(
      "fixture-key",
    );
    expect(JSON.stringify(result)).not.toContain("fixture-key");
  });
  it("EPO exchanges encrypted-pair contents server-side and returns no credentials", async () => {
    const fetch = vi
      .fn<ResearchSourceFetch>()
      .mockResolvedValueOnce(
        '{"access_token":"fixture-token","expires_in":1200}',
      )
      .mockResolvedValueOnce(fixture("epo"))
      .mockResolvedValueOnce("");
    const result = await runResearchSource({
      provider: "epo-ops",
      operation: "read",
      args: { id: "EP.1000000.A1" },
      auth: JSON.stringify({
        clientId: "fixture-client",
        clientSecret: "fixture-secret",
      }),
      fetch,
    });
    expect(fetch.mock.calls[0][0]).toBe(
      "https://ops.epo.org/3.2/auth/accesstoken",
    );
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: "grant_type=client_credentials",
    });
    expect(fetch.mock.calls[1][1]).toMatchObject({
      headers: { Authorization: "Bearer fixture-token" },
    });
    expect(JSON.stringify(result)).not.toMatch(/fixture-token|fixture-secret/);
  });
  it("rejects absent EPO and invalid SEC credentials without source requests", async () => {
    const fetch = vi.fn<ResearchSourceFetch>();
    await expect(
      runResearchSource({
        provider: "epo-ops",
        operation: "search",
        args: { query: "ti=solar" },
        fetch,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONFIGURATION_REQUIRED" });
    await expect(
      runResearchSource({
        provider: "sec-edgar",
        operation: "search",
        args: { query: "EXM" },
        auth: "no contact",
        fetch,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONFIGURATION_REQUIRED" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("resolves SEC ticker, filters forms, reads a verified primary document and labels truncation", async () => {
    const submissions = JSON.stringify({
      name: "Example",
      filings: {
        recent: {
          accessionNumber: ["0000000001-24-000001", "0000000001-24-000002"],
          primaryDocument: ["report.htm", "other.htm"],
          filingDate: ["2024-02-01", "2024-02-02"],
          form: ["10-K", "8-K"],
        },
        files: [],
      },
    });
    const fetch = vi
      .fn<ResearchSourceFetch>()
      .mockResolvedValueOnce(
        '{"0":{"cik_str":1,"ticker":"EXM","title":"Example"}}',
      )
      .mockResolvedValueOnce(submissions)
      .mockResolvedValueOnce(submissions)
      .mockResolvedValueOnce(
        `<html><script>secret()</script><body><h1>Annual report</h1><p>${"Body ".repeat(8000)}</p></body></html>`,
      );
    const found = await runResearchSource({
      provider: "sec-edgar",
      operation: "search",
      args: { query: "EXM", form: "10-K", dateFrom: "2024-01-01" },
      auth: "Example contact@example.com",
      fetch,
    });
    expect(found.documents).toHaveLength(1);
    expect(found.documents[0].id).toBe(
      "1/0000000001-24-000001/2024-02-01/report.htm",
    );
    const read = await runResearchSource({
      provider: "sec-edgar",
      operation: "read",
      args: { id: found.documents[0].id },
      auth: "Example contact@example.com",
      fetch,
    });
    expect(read.documents[0]).toMatchObject({
      truncated: true,
      coverage: "filing_text",
      publishedAt: "2024-02-01",
    });
    expect(read.documents[0].content).not.toContain("secret()");
    expect(read.documents[0].content.length).toBeLessThanOrEqual(32000);
    expect(fetch.mock.calls.at(-1)?.[0]).toBe(
      "https://www.sec.gov/Archives/edgar/data/1/000000000124000001/report.htm",
    );
  });
  it("rejects Base URL overrides and redacts unexpected upstream failures", async () => {
    const fetch = vi
      .fn<ResearchSourceFetch>()
      .mockRejectedValue(
        new Error("https://example.invalid?api_key=sensitive"),
      );
    const decryptSecret = vi.fn().mockResolvedValue("");
    const override = await executeResearchSourceRequest({
      provider: "arxiv",
      functionName: "search_arxiv",
      args: { query: "q" },
      authConfig: { baseUrl: "https://attacker.invalid" },
      decryptSecret,
      fetch,
    });
    expect(override.status).toBe(400);
    const response = await executeResearchSourceRequest({
      provider: "arxiv",
      functionName: "search_arxiv",
      args: { query: "q" },
      decryptSecret,
      fetch,
    });
    expect(await response.text()).not.toContain("sensitive");
  });
});
