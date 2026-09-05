import {
  SHARE_ID_PATTERN,
  ShareError,
  type PublicShare,
} from "@/lib/sharing/types";

export async function readShareResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    code?: string;
  } | null;
  if (!response.ok)
    throw new ShareError(
      body?.code || "SHARE_REQUEST_FAILED",
      body?.error || "The share request failed. Please try again.",
      response.status,
    );
  return body as T;
}

/** Public reader deliberately has no app storage, credential or sync imports. */
export async function getPublicShare(
  id: string,
  signal?: AbortSignal,
): Promise<PublicShare> {
  if (!SHARE_ID_PATTERN.test(id))
    throw new ShareError("SHARE_NOT_FOUND", "This share is unavailable.", 404);
  return readShareResponse<PublicShare>(
    await fetch(`/api/shares/${encodeURIComponent(id)}`, {
      cache: "no-store",
      credentials: "omit",
      signal,
    }),
  );
}
