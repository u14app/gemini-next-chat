import "server-only";
import { NextResponse } from "next/server";
import { BYOK_CONTEXTS } from "@/lib/byok/shared";
import { decryptOptionalSecret } from "@/lib/byok/server";
import type { PluginAuthConfig } from "../pluginExecutionExecutor";
import {
  getResearchSourceOperation,
  type ResearchSourceProvider,
} from "./catalog";
import {
  array,
  document,
  isoDate,
  parseArxiv,
  parsePatents,
  parsePubmed,
  record,
  text,
} from "./parsers";
import {
  createResearchSourceFetch,
  hashSourceKey,
  type ResearchSourceFetch,
} from "./transport";
import {
  ResearchSourceError,
  type ResearchSourceDocument,
  type ResearchSourceResult,
} from "./types";

const tokens = new Map<string, { token: string; expires: number }>();
function url(
  base: string,
  params: Record<string, string | number | undefined>,
): string {
  const target = new URL(base);
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) target.searchParams.set(key, String(value));
  return target.toString();
}
function json(input: string): Record<string, unknown> {
  try {
    return record(JSON.parse(input));
  } catch {
    throw new ResearchSourceError(
      "Source returned malformed JSON.",
      "SOURCE_RESPONSE_INVALID",
      502,
    );
  }
}
function dateArg(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    isoDate(value) !== value ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new ResearchSourceError(
      "Use a valid YYYY-MM-DD publication date.",
      "SOURCE_ARGUMENT_INVALID",
    );
  return value;
}
function required(value: unknown, pattern?: RegExp): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 500 ||
    /[\u0000-\u001f]/.test(value) ||
    (pattern && !pattern.test(value))
  )
    throw new ResearchSourceError(
      "Source query or document identifier is invalid.",
      "SOURCE_ARGUMENT_INVALID",
    );
  return value.trim();
}
function filterDates(
  docs: ResearchSourceDocument[],
  from?: string,
  to?: string,
) {
  return docs.filter(
    (d) =>
      (!from && !to) ||
      (d.publishedAt &&
        (!from || d.publishedAt >= from) &&
        (!to || d.publishedAt <= to)),
  );
}
async function epoToken(
  auth: string,
  fetch: ResearchSourceFetch,
): Promise<string> {
  let credentials: Record<string, unknown>;
  try {
    credentials = record(JSON.parse(auth));
  } catch {
    credentials = {};
  }
  const { clientId, clientSecret } = credentials;
  if (
    typeof clientId !== "string" ||
    typeof clientSecret !== "string" ||
    !/^[\x21-\x7e]{1,300}$/.test(clientId) ||
    clientId.includes(":") ||
    !/^[\x21-\x7e]{1,300}$/.test(clientSecret)
  )
    throw new ResearchSourceError(
      "Configure both EPO OPS client ID and client secret.",
      "SOURCE_CONFIGURATION_REQUIRED",
    );
  const key = await hashSourceKey(auth);
  const saved = tokens.get(key);
  if (saved && saved.expires > Date.now()) return saved.token;
  const data = json(
    await fetch(
      "https://ops.epo.org/3.2/auth/accesstoken",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      },
      { cache: false },
    ),
  );
  if (
    typeof data.access_token !== "string" ||
    !/^[\x21-\x7e]{1,4096}$/.test(data.access_token)
  )
    throw new ResearchSourceError(
      "EPO token exchange failed.",
      "SOURCE_AUTH_FAILED",
      403,
    );
  if (tokens.size >= 100) tokens.delete(tokens.keys().next().value!);
  tokens.set(key, {
    token: data.access_token,
    expires:
      Date.now() +
      Math.max(0, Math.min(Number(data.expires_in) || 600, 1200) - 60) * 1000,
  });
  return data.access_token;
}
interface Filing {
  id: string;
  url: string;
  title: string;
  date?: string;
}
function filingRows(data: unknown, cik: string, company: string): Filing[] {
  const row = record(data);
  return array(row.accessionNumber).flatMap((value, index) => {
    const accession = text(value);
    const primary = text(array(row.primaryDocument)[index]);
    if (
      !/^\d{10}-\d{2}-\d{6}$/.test(accession) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}\.(?:htm|html|txt)$/i.test(primary)
    )
      return [];
    const date = isoDate(array(row.filingDate)[index]);
    if (!date) return [];
    return [
      {
        id: `${cik}/${accession}/${date}/${primary}`,
        url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/${primary}`,
        title: `${company} ${text(array(row.form)[index])} ${text(array(row.filingDate)[index])}`,
        date,
      },
    ];
  });
}
async function secFilings(
  cik: string,
  fetch: ResearchSourceFetch,
  headers: HeadersInit,
  from?: string,
  to?: string,
): Promise<Filing[]> {
  const data = json(
    await fetch(
      `https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`,
      { headers },
    ),
  );
  const filings = record(data.filings);
  const company = text(data.name) || cik;
  const rows = filingRows(filings.recent, cik, company);
  const historic = array(filings.files)
    .map(record)
    .filter(
      (file) =>
        (!from || text(file.filingTo) >= from) &&
        (!to || text(file.filingFrom) <= to),
    )
    .slice(0, 3);
  for (const file of historic) {
    const name = text(file.name);
    if (
      !/^CIK\d{10}-submissions-\d{3}\.json$/.test(name) ||
      !name.startsWith(`CIK${cik.padStart(10, "0")}-`)
    )
      continue;
    rows.push(
      ...filingRows(
        json(
          await fetch(`https://data.sec.gov/submissions/${name}`, { headers }),
        ),
        cik,
        company,
      ),
    );
  }
  return rows;
}
export async function runResearchSource({
  provider,
  operation,
  args,
  auth = "",
  fetch,
  signal,
}: {
  provider: ResearchSourceProvider;
  operation: "search" | "read";
  args: Record<string, unknown>;
  auth?: string;
  fetch: ResearchSourceFetch;
  signal?: AbortSignal;
}): Promise<ResearchSourceResult> {
  signal?.throwIfAborted();
  const query = operation === "search" ? required(args.query) : "";
  const id = operation === "read" ? required(args.id) : "";
  const limit = args.limit === undefined ? 5 : Number(args.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new ResearchSourceError(
      "Search limit must be between 1 and 20.",
      "SOURCE_ARGUMENT_INVALID",
    );
  const from = dateArg(args.dateFrom);
  const to = dateArg(args.dateTo);
  if (from && to && from > to)
    throw new ResearchSourceError(
      "Publication date range is reversed.",
      "SOURCE_ARGUMENT_INVALID",
    );
  let documents: ResearchSourceDocument[] = [];
  let coverageNote: string | undefined;
  if (provider === "arxiv") {
    if (operation === "read")
      required(id, /^(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})(?:v\d+)?$/i);
    const expression =
      from || to
        ? `(${query}) AND submittedDate:[${(from ?? "1991-01-01").replace(/-/g, "")}0000 TO ${(to ?? "9999-12-31").replace(/-/g, "")}2359]`
        : query;
    documents = parseArxiv(
      await fetch(
        url(
          "https://export.arxiv.org/api/query",
          operation === "search"
            ? {
                search_query: expression,
                start: 0,
                max_results: limit,
                sortBy: "relevance",
              }
            : { id_list: id, max_results: 1 },
        ),
      ),
    );
    if (operation === "read")
      documents = documents.filter((d) =>
        /v\d+$/.test(id) ? d.id === id : d.id.replace(/v\d+$/, "") === id,
      );
  } else if (provider === "pubmed") {
    if (operation === "read") required(id, /^\d{1,10}$/);
    if (operation === "read")
      documents = parsePubmed(
        await fetch(
          url("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi", {
            db: "pubmed",
            id,
            retmode: "xml",
            api_key: auth || undefined,
          }),
        ),
      ).filter((d) => d.id === id);
    else {
      const data = json(
        await fetch(
          url("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", {
            db: "pubmed",
            term: query,
            retmode: "json",
            retmax: limit,
            datetype: from || to ? "pdat" : undefined,
            mindate: from,
            maxdate: to,
            api_key: auth || undefined,
          }),
        ),
      );
      if (data.error || record(data.esearchresult).ERROR)
        throw new ResearchSourceError(
          "PubMed rejected the search expression.",
          "SOURCE_ARGUMENT_INVALID",
        );
      const ids = array(record(data.esearchresult).idlist)
        .map(text)
        .filter((value) => /^\d{1,10}$/.test(value))
        .slice(0, limit);
      if (ids.length) {
        const summary = record(
          json(
            await fetch(
              url(
                "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
                {
                  db: "pubmed",
                  id: ids.join(","),
                  retmode: "json",
                  api_key: auth || undefined,
                },
              ),
            ),
          ).result,
        );
        documents = ids
          .map((pmid) => {
            const entry = record(summary[pmid]);
            return document({
              id: pmid,
              url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
              title: text(entry.title),
              content: `${text(entry.title)}\n${text(entry.fulljournalname)}\n${text(entry.pubdate)}`,
              publishedAt: isoDate(entry.pubdate),
              coverage: "metadata_only",
              missing: ["abstract"],
            });
          })
          .filter((d) => d.title);
      }
    }
  } else if (provider === "epo-ops") {
    if (operation === "read")
      required(id, /^[A-Z]{2}\.[A-Z0-9]{1,16}\.[A-Z]\d?$/);
    const token = await epoToken(auth, fetch);
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/xml",
    };
    if (operation === "search") {
      const expression = `(${query})${from ? ` AND pd >= ${from.replace(/-/g, "")}` : ""}${to ? ` AND pd <= ${to.replace(/-/g, "")}` : ""}`;
      documents = parsePatents(
        await fetch(
          url(
            "https://ops.epo.org/3.2/rest-services/published-data/search/biblio",
            { q: expression, Range: `1-${limit}` },
          ),
          { headers },
        ),
      );
    } else {
      const base = `https://ops.epo.org/3.2/rest-services/published-data/publication/docdb/${id}`;
      documents = parsePatents(
        await fetch(`${base}/biblio`, { headers }),
      ).filter((d) => d.id === id);
      const abstractResponse = await fetch(
        `${base}/abstract`,
        { headers },
        { allowMissing: true },
      );
      const abstract = abstractResponse
        ? parsePatents(abstractResponse).find(
            (d) => d.id === id && d.coverage === "abstract_and_metadata",
          )
        : undefined;
      if (abstract)
        documents = documents.map((d) =>
          document({
            ...d,
            content: `${d.content}\n\n${abstract.content}`,
            coverage: "abstract_and_metadata",
            missing: [],
          }),
        );
    }
  } else {
    if (
      !auth ||
      auth.length > 200 ||
      /[\r\n]/.test(auth) ||
      !/[^\s@]+@[^\s@]+\.[^\s@]+/.test(auth)
    )
      throw new ResearchSourceError(
        "Configure SEC User-Agent with an organization name and contact email.",
        "SOURCE_CONFIGURATION_REQUIRED",
      );
    const headers = {
      "User-Agent": auth,
      Accept: "application/json,text/html",
    };
    coverageNote =
      "At most three matching companies, with recent filings and up to three matching historical index files per company. Not an all-company full-text search.";
    if (operation === "read") {
      const parts =
        /^(\d{1,10})\/(\d{10}-\d{2}-\d{6})\/(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,199}\.(?:htm|html|txt))$/i.exec(
          id,
        );
      if (!parts)
        throw new ResearchSourceError(
          "Use the exact filing identifier returned by search.",
          "SOURCE_ARGUMENT_INVALID",
        );
      const filing = (
        await secFilings(
          parts[1],
          fetch,
          headers,
          dateArg(parts[3]),
          dateArg(parts[3]),
        )
      ).find((entry) => entry.id === id);
      if (filing)
        documents = [
          document({
            id,
            url: filing.url,
            title: filing.title,
            publishedAt: filing.date,
            content: await fetch(filing.url, { headers }),
            coverage: "filing_text",
          }),
        ];
    } else {
      const form =
        args.form === undefined
          ? undefined
          : required(args.form, /^[A-Za-z0-9 /-]{1,30}$/);
      let ciks: string[];
      if (/^\d{1,10}$/.test(query)) ciks = [String(Number(query))];
      else {
        const companies = Object.values(
          json(
            await fetch("https://www.sec.gov/files/company_tickers.json", {
              headers,
            }),
          ),
        ).map(record);
        const exact = companies.filter(
          (c) => text(c.ticker).toLowerCase() === query.toLowerCase(),
        );
        ciks = (
          exact.length
            ? exact
            : companies.filter((c) =>
                text(c.title).toLowerCase().includes(query.toLowerCase()),
              )
        )
          .slice(0, 3)
          .map((c) => text(c.cik_str))
          .filter((cik) => /^\d{1,10}$/.test(cik));
      }
      for (const cik of ciks) {
        signal?.throwIfAborted();
        const rows = await secFilings(cik, fetch, headers, from, to);
        documents.push(
          ...rows
            .filter((f) => !form || f.title.includes(` ${form} `))
            .map((f) =>
              document({
                id: f.id,
                url: f.url,
                title: f.title,
                content: f.title,
                publishedAt: f.date,
                coverage: "metadata_only",
                missing: ["filing_text"],
              }),
            ),
        );
      }
    }
  }
  signal?.throwIfAborted();
  documents = filterDates(documents, from, to).slice(
    0,
    operation === "read" ? 1 : limit,
  );
  if (operation === "read" && !documents.length)
    throw new ResearchSourceError(
      "Document was not found in the available source records.",
      "SOURCE_DOCUMENT_UNAVAILABLE",
      404,
    );
  return {
    provider,
    operation,
    documents,
    ...(coverageNote ? { coverageNote } : {}),
  };
}
export async function executeResearchSourceRequest({
  provider,
  functionName,
  args,
  authConfig,
  signal,
  decryptSecret = decryptOptionalSecret,
  fetch,
}: {
  provider: ResearchSourceProvider;
  functionName: string;
  args: Record<string, unknown>;
  authConfig?: PluginAuthConfig;
  signal?: AbortSignal;
  decryptSecret?: typeof decryptOptionalSecret;
  fetch?: ResearchSourceFetch;
}) {
  try {
    const operation = getResearchSourceOperation(provider, functionName);
    if (!operation)
      throw new ResearchSourceError(
        "Unknown source function.",
        "SOURCE_FUNCTION_INVALID",
      );
    if (authConfig?.baseUrl)
      throw new ResearchSourceError(
        "Specialized sources use fixed official endpoints.",
        "SOURCE_ENDPOINT_INVALID",
      );
    const auth = await decryptSecret(
      authConfig?.valueSecret,
      BYOK_CONTEXTS.pluginAuth(provider),
    );
    const result = await runResearchSource({
      provider,
      operation,
      args,
      auth: auth || "",
      signal,
      fetch: fetch ?? createResearchSourceFetch(provider, signal),
    });
    return NextResponse.json({ result });
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    )
      throw error;
    if (error instanceof ResearchSourceError)
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    // Do not echo upstream response bodies, credential-bearing URLs or headers.
    return NextResponse.json(
      {
        error:
          "Source request could not complete. Check source configuration and retry.",
        code: "SOURCE_REQUEST_FAILED",
      },
      { status: 502 },
    );
  }
}
