import "server-only";

import { AGENT_FETCH_URL_LIMITS } from "@/config/limits";
import { ApiError, ResponseTimeoutError } from "../errors";
import { readPublicWebPage } from "../agent/readPublicWebPage";
import {
  isWebPageChallenge,
  logWebReadFailure,
  normalizeWebReadTransportError,
  webPageChallengeError,
} from "../agent/webReadErrors";
import { safeFetchText } from "../security/safeFetch";
import { getSafeUrlPolicy } from "../security/urlPolicy";

const TOTAL_TIMEOUT_MS = 30_000;
const ATTEMPT_TIMEOUT_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readJinaContent(response: Response, text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const data =
    isRecord(parsed) && isRecord(parsed.data) ? parsed.data : undefined;
  const content = typeof data?.content === "string" ? data.content : text;
  const title = typeof data?.title === "string" ? data.title : undefined;
  const readerPreamble = /^(?:Title:|URL Source:|Warning: Target URL)/i.test(
    content.trimStart(),
  )
    ? content.split(/^Markdown Content:\s*$/im)[0].slice(0, 4_096)
    : "";
  const warning = [
    isRecord(parsed) ? parsed.message : undefined,
    data?.warning,
    readerPreamble,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  const targetRefused =
    /^(?:Warning:\s*)?Target URL returned error (?:401|403)\b/im.test(warning);
  // JSON content and Reader text envelopes describe the target, not the Reader
  // service. They take precedence even if an outer response has a CF header.
  const targetChallenge =
    (data !== undefined || /^URL Source:/im.test(text)) &&
    isWebPageChallenge(content, title);
  if (
    targetChallenge ||
    (targetRefused && /captcha|verify .*human/i.test(content))
  ) {
    throw webPageChallengeError();
  }
  if (targetRefused) {
    throw new ApiError(
      "The original webpage requires authorization or refused access. Use another source.",
      502,
      "WEB_PAGE_ACCESS_DENIED",
    );
  }
  if (
    response.headers.get("cf-mitigated") === "challenge" ||
    (!data && isWebPageChallenge(text))
  ) {
    throw new ApiError(
      "The Reader service requires verification.",
      502,
      "JINA_SERVICE_CHALLENGE",
      { upstreamStatus: response.status },
    );
  }

  const applicationCode =
    isRecord(parsed) && typeof parsed.code === "number"
      ? parsed.code
      : undefined;
  const status =
    applicationCode && applicationCode >= 400
      ? applicationCode
      : response.status;
  if (
    !response.ok ||
    (applicationCode !== undefined && applicationCode !== 200) ||
    (isRecord(parsed) && parsed.error)
  ) {
    throw new ApiError(
      `The Reader service could not read the webpage (HTTP ${status}).`,
      502,
      status >= 500 && status <= 599
        ? "JINA_SERVICE_UNAVAILABLE"
        : "JINA_READER_ERROR",
      { upstreamStatus: status },
    );
  }
  if (
    !content.trim() ||
    (parsed !== undefined &&
      !(applicationCode === 200 && typeof data?.content === "string")) ||
    (!data && /text\/html/i.test(response.headers.get("content-type") || ""))
  ) {
    throw new ApiError(
      "The Reader returned an invalid webpage response.",
      502,
      "JINA_READER_ERROR",
    );
  }
  return content;
}

function allowsDirectFallback(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    [
      "WEB_FETCH_NETWORK",
      "RESPONSE_TIMEOUT",
      "JINA_SERVICE_UNAVAILABLE",
      "JINA_SERVICE_CHALLENGE",
    ].includes(error.code || "")
  );
}

export async function readJinaWebPage({
  readerUrl,
  targetUrl,
  headers,
  signal,
  fetchText = safeFetchText,
}: {
  readerUrl: string;
  targetUrl: string;
  headers: HeadersInit;
  signal?: AbortSignal;
  fetchText?: typeof safeFetchText;
}): Promise<string> {
  signal?.throwIfAborted();
  const startedAt = Date.now();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  const deadline = setTimeout(
    () =>
      controller.abort(
        new ResponseTimeoutError(TOTAL_TIMEOUT_MS, "Webpage read"),
      ),
    TOTAL_TIMEOUT_MS,
  );

  try {
    try {
      let fetched: Awaited<ReturnType<typeof safeFetchText>>;
      try {
        fetched = await fetchText(
          readerUrl,
          { method: "GET", headers, signal: controller.signal },
          {
            policy: getSafeUrlPolicy("plugin"),
            timeoutMs: ATTEMPT_TIMEOUT_MS,
            maxResponseBytes: AGENT_FETCH_URL_LIMITS.maxResponseBytes,
          },
        );
      } catch (error) {
        controller.signal.throwIfAborted();
        logWebReadFailure(error, "jina", startedAt);
        throw normalizeWebReadTransportError(error);
      }
      controller.signal.throwIfAborted();
      try {
        return readJinaContent(fetched.response, fetched.text);
      } catch (error) {
        logWebReadFailure(error, "jina", startedAt);
        throw error;
      }
    } catch (error) {
      controller.signal.throwIfAborted();
      if (!allowsDirectFallback(error)) throw error;
    }

    const remainingMs = TOTAL_TIMEOUT_MS - (Date.now() - startedAt);
    if (remainingMs <= 0)
      throw new ResponseTimeoutError(TOTAL_TIMEOUT_MS, "Webpage read");
    const page = await readPublicWebPage(targetUrl, {
      signal: controller.signal,
      timeoutMs: Math.min(ATTEMPT_TIMEOUT_MS, remainingMs),
      fetchText,
      stage: "jina-fallback",
    });
    controller.signal.throwIfAborted();
    return `URL Source: ${page.url}\n\nMarkdown Content:\n${page.content}${page.truncated ? "\n\n[Content truncated at 40,000 characters.]" : ""}`;
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener("abort", cancel);
  }
}
