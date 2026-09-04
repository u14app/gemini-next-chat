import { XMLParser, XMLValidator } from "fast-xml-parser";
import { htmlToReadableText } from "@/lib/agent/readableDocument";
import type { ResearchSourceDocument } from "./types";
import { ResearchSourceError } from "./types";

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function array(value: unknown): unknown[] {
  return Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
}
export function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number")
    return String(value).replace(/\s+/g, " ").trim();
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(" ");
  return Object.entries(record(value))
    .filter(([key]) => !key.startsWith("@"))
    .map(([, item]) => text(item))
    .filter(Boolean)
    .join(" ");
}
export function parseSourceXml(input: string): Record<string, unknown> {
  if (
    input.length > 2_000_000 ||
    /<!ENTITY\b/i.test(input) ||
    /<!DOCTYPE[^>]*\[/i.test(input)
  )
    throw new ResearchSourceError(
      "Source XML exceeds safe parsing limits or declares custom entities.",
      "SOURCE_RESPONSE_INVALID",
      502,
    );
  // NLM publishes an external DTD declaration. It is removed, never resolved.
  const xml = input.replace(/<!DOCTYPE[^>]*>/gi, "");
  let depth = 0;
  let count = 0;
  for (const match of xml.matchAll(/<\/?[A-Za-z][^>]*>/g)) {
    if (++count > 50_000)
      throw new ResearchSourceError(
        "Source XML contains too many elements.",
        "SOURCE_RESPONSE_INVALID",
        502,
      );
    if (match[0].startsWith("</")) depth--;
    else if (!match[0].endsWith("/>")) depth++;
    if (depth > 64)
      throw new ResearchSourceError(
        "Source XML nesting is too deep.",
        "SOURCE_RESPONSE_INVALID",
        502,
      );
  }
  if (XMLValidator.validate(xml) !== true)
    throw new ResearchSourceError(
      "Source returned malformed XML.",
      "SOURCE_RESPONSE_INVALID",
      502,
    );
  return record(
    new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      parseTagValue: false,
      parseAttributeValue: false,
      processEntities: false,
      trimValues: true,
    }).parse(xml),
  );
}
export function descendant(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value))
    return value.flatMap((item) => descendant(item, key));
  return Object.entries(record(value)).flatMap(([name, item]) =>
    name === key ? array(item) : descendant(item, key),
  );
}
export function isoDate(value: unknown): string | undefined {
  const raw = text(value);
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const numericParts = /^(\d{4}) (\d{1,2}) (\d{1,2})$/.exec(raw);
  if (numericParts)
    return `${numericParts[1]}-${numericParts[2].padStart(2, "0")}-${numericParts[3].padStart(2, "0")}`;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (iso) return iso[1];
  // Month/year-only publication dates are not an exact day. Do not invent one
  // when enforcing an approved absolute date range.
  if (!/^\d{4} [A-Za-z]{3,9} \d{1,2}$/.test(raw)) return undefined;
  const parsed = Date.parse(`${raw} UTC`);
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString().slice(0, 10)
    : undefined;
}
export function document(
  input: Omit<ResearchSourceDocument, "truncated" | "missing" | "content"> & {
    content: string;
    missing?: string[];
  },
): ResearchSourceDocument {
  const content = htmlToReadableText(input.content);
  return {
    ...input,
    title: htmlToReadableText(input.title).slice(0, 500),
    content: content.slice(0, 32_000),
    truncated: content.length > 32_000,
    missing: input.missing ?? [],
  };
}
export function parseArxiv(xml: string): ResearchSourceDocument[] {
  return array(record(parseSourceXml(xml).feed).entry).flatMap((item) => {
    const entry = record(item);
    const match =
      /\/abs\/([a-z.-]+\/\d{7}(?:v\d+)?|\d{4}\.\d{4,5}(?:v\d+)?)$/i.exec(
        text(entry.id),
      );
    if (!match) return [];
    const abstract = text(entry.summary);
    const authors = array(entry.author)
      .map((author) => text(record(author).name))
      .filter(Boolean);
    const publishedAt = isoDate(entry.published);
    return [
      document({
        id: match[1],
        url: `https://arxiv.org/abs/${match[1]}`,
        title: text(entry.title),
        authors,
        publishedAt,
        content: `${text(entry.title)}\nAuthors: ${authors.join(", ")}\nPublished: ${publishedAt ?? "Unknown"}\n\n${abstract}`,
        coverage: abstract ? "abstract_and_metadata" : "metadata_only",
        missing: abstract ? [] : ["abstract"],
      }),
    ];
  });
}
export function parsePubmed(xml: string): ResearchSourceDocument[] {
  return descendant(parseSourceXml(xml), "PubmedArticle").flatMap((item) => {
    const citation = record(record(item).MedlineCitation);
    const article = record(citation.Article);
    const id = text(citation.PMID);
    if (!/^\d{1,10}$/.test(id)) return [];
    const abstract = text(record(article.Abstract).AbstractText);
    const authors = array(record(article.AuthorList).Author)
      .map((author) => {
        const a = record(author);
        return (
          text(a.CollectiveName) ||
          `${text(a.ForeName)} ${text(a.LastName)}`.trim()
        );
      })
      .filter(Boolean);
    const pubDate = record(
      record(record(article.Journal).JournalIssue).PubDate,
    );
    const publishedAt =
      isoDate(
        `${text(pubDate.Year)} ${text(pubDate.Month)} ${text(pubDate.Day)}`,
      ) ?? isoDate(pubDate.MedlineDate);
    return [
      document({
        id,
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        title: text(article.ArticleTitle),
        authors,
        publishedAt,
        content: `${text(article.ArticleTitle)}\nAuthors: ${authors.join(", ")}\nJournal: ${text(record(article.Journal).Title)}\nPublication date: ${publishedAt ?? text(pubDate)}\n\n${abstract}`,
        coverage: abstract ? "abstract_and_metadata" : "metadata_only",
        missing: abstract ? [] : ["abstract"],
      }),
    ];
  });
}
export function parsePatents(xml: string): ResearchSourceDocument[] {
  return descendant(parseSourceXml(xml), "exchange-document").flatMap(
    (item) => {
      const entry = record(item);
      const country = text(entry["@_country"]);
      const number = text(entry["@_doc-number"]);
      const kind = text(entry["@_kind"]);
      if (
        !/^[A-Z]{2}$/.test(country) ||
        !/^[A-Z0-9]{1,16}$/.test(number) ||
        !/^[A-Z]\d?$/.test(kind)
      )
        return [];
      const id = `${country}.${number}.${kind}`;
      const biblio = record(entry["bibliographic-data"]);
      const titles = descendant(biblio, "invention-title");
      const title =
        text(titles.find((t) => record(t)["@_lang"] === "en") ?? titles[0]) ||
        id;
      const abstract = text(
        array(entry.abstract).find((a) => record(a)["@_lang"] === "en") ??
          array(entry.abstract)[0],
      );
      const publishedAt = isoDate(
        descendant(biblio["publication-reference"], "date")[0],
      );
      return [
        document({
          id,
          url: `https://worldwide.espacenet.com/publicationDetails/biblio?CC=${country}&NR=${number}&KC=${kind}`,
          title,
          publishedAt,
          content: `${title}\nPublication: ${id}\nPublished: ${publishedAt ?? "Unknown"}\nApplicants: ${text(descendant(biblio, "applicant-name"))}\n\n${abstract}`,
          coverage: abstract ? "abstract_and_metadata" : "metadata_only",
          missing: abstract ? [] : ["abstract"],
        }),
      ];
    },
  );
}
