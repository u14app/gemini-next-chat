import "server-only";

export function isSharingAvailable(): boolean {
  return (
    process.env.SHARING_ENABLED?.trim().toLowerCase() === "true" &&
    isShareStorageAvailable()
  );
}

export function isShareStorageAvailable(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}
