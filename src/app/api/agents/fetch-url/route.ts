import { NextRequest, NextResponse } from "next/server";

import {
  createApiErrorResponse,
  readJsonRequestBody,
} from "@/lib/api/middleware";
import { FetchUrlRequestSchema } from "@/lib/api/schemas";
import { readPublicWebPage } from "@/lib/agent/readPublicWebPage";
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

    return NextResponse.json(
      await readPublicWebPage(url, { signal: request.signal }),
    );
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
