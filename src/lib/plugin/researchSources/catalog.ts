import type { Plugin } from "../types";

export const RESEARCH_SOURCE_IDS = [
  "arxiv",
  "pubmed",
  "epo-ops",
  "sec-edgar",
] as const;
export type ResearchSourceProvider = (typeof RESEARCH_SOURCE_IDS)[number];
export const RESEARCH_SOURCE_FUNCTIONS: Record<
  ResearchSourceProvider,
  { search: string; read: string }
> = {
  arxiv: { search: "search_arxiv", read: "read_arxiv" },
  pubmed: { search: "search_pubmed", read: "read_pubmed" },
  "epo-ops": { search: "search_patents", read: "read_patent" },
  "sec-edgar": { search: "search_filings", read: "read_filing" },
};
export function isResearchSourceProvider(
  id: string | undefined,
): id is ResearchSourceProvider {
  return RESEARCH_SOURCE_IDS.includes(id as ResearchSourceProvider);
}
export function getResearchSourceOperation(
  pluginId: string | undefined,
  functionName: string,
): "search" | "read" | undefined {
  if (!isResearchSourceProvider(pluginId)) return undefined;
  const names = RESEARCH_SOURCE_FUNCTIONS[pluginId];
  return functionName === names.search
    ? "search"
    : functionName === names.read
      ? "read"
      : undefined;
}
const stringField = (description: string, maxLength = 500) => ({
  type: "string",
  minLength: 1,
  maxLength,
  description,
});
const commonSearch = {
  query: stringField(
    "Search expression. SEC: company name, ticker, or CIK. EPO: CQL expression such as ti=solar.",
  ),
  limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
  dateFrom: {
    type: "string",
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    description: "Earliest publication or filing date (inclusive).",
  },
  dateTo: {
    type: "string",
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    description: "Latest publication or filing date (inclusive).",
  },
};
const details: Record<
  ResearchSourceProvider,
  {
    title: string;
    description: string;
    url: string;
    docs: string;
    idHelp: string;
    auth: Plugin["auth"];
  }
> = {
  arxiv: {
    title: "arXiv",
    description:
      "Search preprints and read versioned abstracts and bibliographic metadata.",
    url: "https://export.arxiv.org",
    docs: "https://info.arxiv.org/help/api/user-manual.html",
    idHelp:
      "arXiv identifier, preferably including a version, e.g. 2401.12345v2 or hep-th/9901001v1.",
    auth: { type: "none" },
  },
  pubmed: {
    title: "PubMed",
    description:
      "Search biomedical literature and read PubMed abstracts and publication records.",
    url: "https://eutils.ncbi.nlm.nih.gov",
    docs: "https://dataguide.nlm.nih.gov/eutilities/utilities.html",
    idHelp: "PubMed numeric PMID.",
    auth: { type: "apiKey", name: "api_key", in: "query", required: false },
  },
  "epo-ops": {
    title: "EPO OPS",
    description:
      "Search worldwide patents and read public bibliographic records and available abstracts.",
    url: "https://ops.epo.org",
    docs: "https://developers.epo.org/",
    idHelp:
      "DOCDB publication identifier returned by search, e.g. EP.1000000.A1.",
    auth: { type: "oauth2", required: true },
  },
  "sec-edgar": {
    title: "SEC EDGAR",
    description:
      "Find company filings by name, ticker or CIK and read the primary filing document.",
    url: "https://www.sec.gov",
    docs: "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
    idHelp:
      "Exact filing ID returned by search: CIK/accession-number/filing-date/primary-document.htm.",
    auth: { type: "apiKey", name: "User-Agent", in: "header", required: true },
  },
};
export const RESEARCH_SOURCE_PLUGINS: Plugin[] = RESEARCH_SOURCE_IDS.map(
  (id) => {
    const d = details[id];
    return {
      id,
      title: d.title,
      description: d.description,
      logoUrl: `${d.url}/favicon.ico`,
      manifestUrl: d.docs,
      externalDocsUrl: d.docs,
      baseUrl: d.url,
      source: "builtin",
      builtIn: true,
      category: "research",
      auth: d.auth,
      functions: [
        {
          name: RESEARCH_SOURCE_FUNCTIONS[id].search,
          description: `${d.description} Search returns discovery records only; call the corresponding read tool before using a document as evidence. SEC coverage is bounded to the company's available recent and historical filing indexes.`,
          method: "GET",
          path: "/research/search",
          risk: "read",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              ...commonSearch,
              ...(id === "sec-edgar"
                ? {
                    form: stringField(
                      "Optional exact filing form, e.g. 10-K, 10-Q, 8-K.",
                      30,
                    ),
                  }
                : {}),
            },
            required: ["query"],
          },
        },
        {
          name: RESEARCH_SOURCE_FUNCTIONS[id].read,
          description: `${d.idHelp} Read returns the actual available content with coverage and truncation labels; no PDF or paywalled full-text access.`,
          method: "GET",
          path: "/research/read",
          risk: "read",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: { id: stringField(d.idHelp, 240) },
            required: ["id"],
          },
        },
      ],
    };
  },
);
