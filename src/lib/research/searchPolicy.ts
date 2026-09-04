import type { ResearchScope } from "./types";

const DOMAIN_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const ISO_DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

export interface ResearchSearchPolicy {
  preferredDomains: string[];
  excludedDomains: string[];
  dateFrom?: string;
  dateTo?: string;
}

export function normalizeResearchDomain(value: string): string | undefined {
  const trimmed = value
    .trim()
    .toLowerCase()
    .replace(/^site:/, "");
  try {
    const hostname = trimmed.includes("://")
      ? new URL(trimmed).hostname.toLowerCase()
      : trimmed.replace(/^\*\./, "").replace(/\.$/, "");
    return DOMAIN_PATTERN.test(hostname) ? hostname : undefined;
  } catch {
    return undefined;
  }
}

function normalizeDomains(values: readonly string[] | undefined): string[] {
  return Array.from(
    new Set(
      (values ?? []).flatMap((value) => {
        const domain = normalizeResearchDomain(value);
        return domain ? [domain] : [];
      }),
    ),
  ).slice(0, 8);
}

export function normalizeResearchDate(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed && ISO_DATE_PATTERN.test(trimmed) ? trimmed : undefined;
}

export function createResearchSearchPolicy(
  scope: Pick<
    ResearchScope,
    "preferredDomains" | "excludedDomains" | "timeRange"
  >,
): ResearchSearchPolicy {
  const excludedDomains = normalizeDomains(scope.excludedDomains);
  const excluded = new Set(excludedDomains);
  const preferredDomains = normalizeDomains(scope.preferredDomains).filter(
    (domain) => !excluded.has(domain),
  );
  const dateFrom = normalizeResearchDate(scope.timeRange?.start);
  const dateTo = normalizeResearchDate(scope.timeRange?.end);
  return {
    preferredDomains,
    excludedDomains,
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  };
}
