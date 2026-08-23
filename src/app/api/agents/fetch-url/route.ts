import { NextRequest, NextResponse } from "next/server";

import { AGENT_FETCH_URL_LIMITS } from "@/config/limits";
import {
  createApiErrorResponse,
  readJsonRequestBody,
} from "@/lib/api/middleware";
import { FetchUrlRequestSchema } from "@/lib/api/schemas";
import { toReadableDocument } from "@/lib/agent/readableDocument";
import { safeFetchText } from "@/lib/security/safeFetch";
import { getSafeUrlPolicy } from "@/lib/security/urlPolicy";
import { safeServerLogError } from "@/lib/utils/safeServerLog";

/**
 * Fetches a single public page on behalf of the agent's `fetch_url` tool.
 * The URL comes from the model, so every request goes through the SSRF-guarded
 * `webFetch` policy (public hosts only, no private ranges, capped redirects)
 * and a hard response-byte limit.
 */
export async function POST(request: NextRequest) {
  try {
    const { url } = FetchUrlRequestSchema.parse(
      await readJsonRequestBody(request),
    );

    const { response, text } = await safeFetchText(
      url,
      {
        method: "GET",
        redirect: "follow",
        headers: { Accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
        signal: request.signal,
      },
      {
        policy: getSafeUrlPolicy("webFetch"),
        timeoutMs: AGENT_FETCH_URL_LIMITS.timeoutMs,
        maxResponseBytes: AGENT_FETCH_URL_LIMITS.maxResponseBytes,
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: `The page responded with HTTP ${response.status}.` },
        { status: 502 },
      );
    }

    const contentType = response.headers.get("content-type") || "";
    const document = toReadableDocument(
      text,
      contentType,
      AGENT_FETCH_URL_LIMITS.maxContentChars,
    );

    return NextResponse.json({
      url: response.url || url,
      contentType,
      ...document,
    });
  } catch (error) {
    if (
      request.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      return new Response(null, { status: 499 });
    }
    safeServerLogError("Fetch URL error:", error);
    return createApiErrorResponse(error, "Failed to fetch the URL");
  }
}
