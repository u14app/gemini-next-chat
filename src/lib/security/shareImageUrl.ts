/** A public share may display only explicitly registered, same-origin assets. */
export function getRegisteredShareImageSrc(
  value: string | undefined,
  registeredUrls: readonly string[] = [],
  origin: string | undefined = typeof window === "undefined"
    ? undefined
    : window.location.origin,
): string | null {
  if (!value || !origin || !registeredUrls.includes(value)) return null;
  try {
    const url = new URL(value);
    if (
      url.origin !== origin ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash
    )
      return null;
    if (
      !/^\/api\/shares\/[A-Za-z0-9_-]{43}\/assets\/[a-f0-9]{64}$/.test(
        url.pathname,
      ) ||
      !/^\?revision=[1-9]\d*$/.test(url.search)
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}
