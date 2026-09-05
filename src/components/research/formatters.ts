export type ResearchDateValue = Date | number | string;

function toDate(value: ResearchDateValue): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatResearchDateTime(
  value: ResearchDateValue,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).format(toDate(value));
}

export function formatResearchTime(
  value: ResearchDateValue,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(toDate(value));
}

export function formatResearchTokens(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}
