export const SHARE_LIMITS = {
  requestBytes: 4 * 1024 * 1024,
  snapshotBytes: 768 * 1024,
  imageCount: 32,
  imageBytes: 512 * 1024,
  totalImageBytes: 2 * 1024 * 1024,
  redisRequestBytes: 8 * 1024 * 1024,
} as const;

export type ShareExpiry = "1d" | "7d" | "30d" | "forever";
export type SharedBlock =
  | { type: "text"; content: string }
  | { type: "report"; title: string; content: string }
  | { type: "image"; assetId: string; alt: string; sourceUrl?: string }
  | { type: "attachment"; fileName: string }
  | { type: "sources"; sources: { title: string; url: string }[] };

export interface SharedMessage {
  id: string;
  role: "user" | "model";
  timestamp: number;
  blocks: SharedBlock[];
}

export interface SharedConversation {
  schemaVersion: 1;
  title: string;
  createdAt: number;
  messages: SharedMessage[];
}

export interface ShareAsset {
  id: string;
  mimeType:
    "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/avif";
  data: string;
}

export interface PreparedSessionShare {
  snapshot: SharedConversation;
  assets: ShareAsset[];
}

export interface ShareMetadata {
  id: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
}

export interface PublicShare extends ShareMetadata {
  snapshot: SharedConversation;
}

export interface ShareMutation extends PreparedSessionShare {
  id: string;
  operationId: string;
  expectedRevision: number;
  expiresIn?: ShareExpiry;
}

export class ShareError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "ShareError";
  }
}

export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const SHARE_ASSET_ID_PATTERN = /^[a-f0-9]{64}$/;
export const SHARE_OWNER_HEADER = "x-neo-share-owner";
export const SHARE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export function getSharedAssetUrl(
  id: string,
  assetId: string,
  revision: number,
) {
  return `/api/shares/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}?revision=${revision}`;
}

export function getSharedImageMarker(assetId: string) {
  return `share-asset:${assetId}`;
}

export function isPublicShareRead(pathname: string, method: string) {
  return (
    method === "GET" &&
    /^\/api\/shares\/[A-Za-z0-9_-]{43}(?:\/assets\/[a-f0-9]{64})?$/.test(
      pathname,
    )
  );
}
