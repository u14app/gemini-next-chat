import { ApiError } from "../errors";

export interface StructuredResponseFormat {
  name: string;
  schema: Record<string, unknown>;
  strict: boolean;
}

export const STRUCTURED_OUTPUT_CAPABILITY_ERROR_CODE =
  "STRUCTURED_OUTPUT_CAPABILITY_ERROR";

type StructuredOutputErrorStatus = 400 | 422;

const FORMAT_FIELD_PATTERN =
  /response[_\s.-]?format|response[_\s.-]?(?:json[_\s.-]?)?schema|responseJsonSchema|json[_\s.-]?schema|structured[_\s.-]?outputs?|output[_\s.-]?config(?:\.|\s)+(?:format|schema)|text(?:\.|\s)+format/i;
const FORMAT_REJECTION_PATTERN =
  /unsupported|not supported|does not support|unknown|unrecognized|unexpected|invalid|rejected|not (?:available|allowed|enabled|permitted)|extra inputs?|must (?:be|have)|cannot|can't/i;
const NON_CAPABILITY_ERROR_PATTERN =
  /api[_\s.-]?key|authenticat|unauthori[sz]ed|forbidden|permission|quota|rate[_\s.-]?limit|too many requests|billing|credit|network|connection|connect(?:ion)? failed|timeout|timed out|socket|dns|fetch failed|service unavailable|overload|internal server|bad gateway|gateway timeout/i;

const ERROR_TEXT_KEYS = [
  "message",
  "code",
  "type",
  "param",
  "statusText",
] as const;
const NESTED_ERROR_KEYS = [
  "error",
  "cause",
  "response",
  "body",
  "details",
] as const;

function getStructuredOutputErrorStatus(
  error: unknown,
): StructuredOutputErrorStatus | undefined {
  const queue: unknown[] = [error];
  const visited = new Set<unknown>();

  while (queue.length > 0 && visited.size < 16) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || visited.has(current)) {
      continue;
    }
    visited.add(current);
    const record = current as Record<string, unknown>;
    const status = record.status ?? record.statusCode;
    if (status === 400 || status === 422) return status;
    for (const key of NESTED_ERROR_KEYS) queue.push(record[key]);
  }

  return undefined;
}

function collectStructuredOutputErrorText(error: unknown): string {
  const queue: unknown[] = [error];
  const visited = new Set<unknown>();
  const text: string[] = [];

  while (queue.length > 0 && visited.size < 16 && text.length < 24) {
    const current = queue.shift();
    if (typeof current === "string") {
      text.push(current.slice(0, 4_096));
      continue;
    }
    if (!current || typeof current !== "object" || visited.has(current)) {
      continue;
    }
    visited.add(current);
    const record = current as Record<string, unknown>;
    if (current instanceof Error) text.push(current.message.slice(0, 4_096));
    for (const key of ERROR_TEXT_KEYS) {
      const value = record[key];
      if (typeof value === "string") text.push(value.slice(0, 4_096));
    }
    for (const key of NESTED_ERROR_KEYS) queue.push(record[key]);
  }

  return text.join(" ");
}

export function isStructuredOutputCapabilityError(error: unknown): boolean {
  const status = getStructuredOutputErrorStatus(error);
  if (!status) return false;

  const text = collectStructuredOutputErrorText(error);
  if (NON_CAPABILITY_ERROR_PATTERN.test(text)) return false;
  return FORMAT_FIELD_PATTERN.test(text) && FORMAT_REJECTION_PATTERN.test(text);
}

export class StructuredOutputCapabilityError extends ApiError {
  constructor(statusCode: StructuredOutputErrorStatus) {
    super(
      "The provider rejected the structured output schema or format.",
      statusCode,
      STRUCTURED_OUTPUT_CAPABILITY_ERROR_CODE,
    );
    this.name = "StructuredOutputCapabilityError";
  }
}

export function normalizeStructuredOutputCapabilityError(
  error: unknown,
): unknown {
  if (error instanceof StructuredOutputCapabilityError) return error;
  if (!isStructuredOutputCapabilityError(error)) return error;

  return new StructuredOutputCapabilityError(
    getStructuredOutputErrorStatus(error) as StructuredOutputErrorStatus,
  );
}
