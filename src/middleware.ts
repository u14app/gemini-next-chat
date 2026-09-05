import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_ATTEMPTS_COOKIE,
  ACCESS_ERROR_CODES,
  ACCESS_SESSION_COOKIE,
  getAccessAttemptState,
  isAccessLocked,
  isAccessPasswordEnabled,
  isValidAccessSessionCookie,
} from "./lib/security/accessControl";
import { applyRequestGuards } from "./lib/security/requestGuards";
import { REQUEST_PROOF_SESSION_PATH } from "./lib/security/requestProof";
import { isPublicShareRead, SHARE_RESPONSE_HEADERS } from "./lib/sharing/types";

const ACCESS_VERIFY_PATH = "/api/access/verify";

function jsonError(
  status: number,
  payload: Record<string, unknown>,
): NextResponse {
  const response = NextResponse.json(
    { ...payload, statusCode: status },
    { status },
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/share/")) {
    const response = NextResponse.next();
    for (const [name, value] of Object.entries(SHARE_RESPONSE_HEADERS)) {
      response.headers.set(name, value);
    }
    return response;
  }
  const guardResponse = await applyRequestGuards(request);
  if (guardResponse) return guardResponse;

  if (!isAccessPasswordEnabled()) {
    return NextResponse.next();
  }

  if (isPublicShareRead(request.nextUrl.pathname, request.method)) {
    return NextResponse.next();
  }

  if (
    request.nextUrl.pathname === ACCESS_VERIFY_PATH ||
    request.nextUrl.pathname === REQUEST_PROOF_SESSION_PATH
  ) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(ACCESS_SESSION_COOKIE)?.value;
  if (await isValidAccessSessionCookie(sessionCookie)) {
    return NextResponse.next();
  }

  const attemptState = await getAccessAttemptState(
    request.cookies.get(ACCESS_ATTEMPTS_COOKIE)?.value,
  );
  if (isAccessLocked(attemptState)) {
    return jsonError(423, {
      error: "Access is temporarily locked",
      code: ACCESS_ERROR_CODES.locked,
      lockedUntil: attemptState.lockedUntil,
    });
  }

  return jsonError(401, {
    error: "Access password is required",
    code: ACCESS_ERROR_CODES.required,
  });
}

export const config = {
  matcher: ["/api/:path*", "/share/:path*"],
};
