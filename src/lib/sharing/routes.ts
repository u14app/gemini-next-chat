import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { isSharingAvailable, isShareStorageAvailable } from "./config";
import {
  SHARE_ID_PATTERN,
  SHARE_OWNER_HEADER,
  SHARE_RESPONSE_HEADERS,
  ShareError,
} from "./types";

export { SHARE_RESPONSE_HEADERS } from "./types";

export function requireSharing(mode: "share" | "revoke" = "share") {
  // Turning off publication must not prevent owners from revoking existing
  // snapshots when deleting their conversations. Mutation guards still apply.
  const available =
    mode === "revoke" ? isShareStorageAvailable() : isSharingAvailable();
  if (!available)
    throw new ShareError("SHARING_UNAVAILABLE", "Sharing is unavailable.", 503);
}

export function ownerToken(request: Request) {
  const value = request.headers.get(SHARE_OWNER_HEADER) || "";
  if (!SHARE_ID_PATTERN.test(value))
    throw new ShareError(
      "SHARE_FORBIDDEN",
      "A share management credential is required.",
      403,
    );
  return value;
}

export function shareJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: SHARE_RESPONSE_HEADERS });
}

export async function handleShareRoute(
  action: () => Promise<Response>,
  mode: "share" | "revoke" = "share",
) {
  try {
    requireSharing(mode);
    return await action();
  } catch (error) {
    if (error instanceof ShareError)
      return shareJson(
        { error: error.message, code: error.code },
        error.status,
      );
    if (error instanceof ZodError || error instanceof SyntaxError)
      return shareJson(
        { error: "Invalid share data.", code: "SHARE_INVALID" },
        400,
      );
    if (
      error instanceof Error &&
      "statusCode" in error &&
      error.statusCode === 413
    )
      return shareJson(
        { error: "The share is too large.", code: "SHARE_TOO_LARGE" },
        413,
      );
    return shareJson(
      {
        error: "Sharing is temporarily unavailable.",
        code: "SHARE_UNAVAILABLE",
      },
      503,
    );
  }
}
