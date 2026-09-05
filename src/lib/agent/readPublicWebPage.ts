import "server-only";

import { AGENT_FETCH_URL_LIMITS } from "@/config/limits";
import { ApiError } from "../errors";
import { safeFetchText } from "../security/safeFetch";
import { getSafeUrlPolicy } from "../security/urlPolicy";
import { toReadableDocument } from "./readableDocument";
import {
  isWebPageChallenge,
  logWebReadFailure,
  normalizeWebReadTransportError,
  webPageChallengeError,
} from "./webReadErrors";

export async function readPublicWebPage(
  url: string,
  {
    signal,
    timeoutMs = AGENT_FETCH_URL_LIMITS.timeoutMs,
    fetchText = safeFetchText,
    stage = "direct",
  }: {
    signal?: AbortSignal;
    timeoutMs?: number;
    fetchText?: typeof safeFetchText;
    stage?: "direct" | "jina-fallback";
  } = {},
) {
  const startedAt = Date.now();
  let fetched: Awaited<ReturnType<typeof safeFetchText>>;
  try {
    signal?.throwIfAborted();
    fetched = await fetchText(
      url,
      {
        method: "GET",
        headers: { Accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
        signal,
      },
      {
        policy: getSafeUrlPolicy("webFetch"),
        timeoutMs,
        maxResponseBytes: AGENT_FETCH_URL_LIMITS.maxResponseBytes,
      },
    );
    signal?.throwIfAborted();
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    logWebReadFailure(error, stage, startedAt);
    throw normalizeWebReadTransportError(error);
  }

  const { response, text } = fetched;
  if (
    response.headers.get("cf-mitigated") === "challenge" ||
    isWebPageChallenge(text)
  ) {
    const error = webPageChallengeError();
    logWebReadFailure(error, stage, startedAt);
    throw error;
  }
  if (!response.ok) {
    const error = new ApiError(
      `The page responded with HTTP ${response.status}.`,
      502,
      "WEB_FETCH_HTTP_ERROR",
      { upstreamStatus: response.status },
    );
    logWebReadFailure(error, stage, startedAt);
    throw error;
  }

  const contentType = response.headers.get("content-type") || "";
  return {
    url: response.url || url,
    contentType,
    ...toReadableDocument(
      text,
      contentType,
      AGENT_FETCH_URL_LIMITS.maxContentChars,
    ),
  };
}
