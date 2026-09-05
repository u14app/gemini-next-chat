import { z } from "zod";
import { getSafeWebHref } from "@/lib/security/clientUrl";
import {
  SHARE_ASSET_ID_PATTERN,
  SHARE_ID_PATTERN,
  SHARE_LIMITS,
  ShareError,
  type PreparedSessionShare,
} from "./types";

const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const safeUrl = z
  .string()
  .max(4096)
  .refine((value) => Boolean(getSafeWebHref(value)));
const content = z.string().max(SHARE_LIMITS.snapshotBytes);
const assetId = z.string().regex(SHARE_ASSET_ID_PATTERN);
export const ShareIdSchema = z.string().regex(SHARE_ID_PATTERN);
export const ShareExpirySchema = z.enum(["1d", "7d", "30d", "forever"]);
export const ShareAssetSchema = z
  .object({
    id: assetId,
    mimeType: z.enum([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "image/avif",
    ]),
    data: z
      .string()
      .max(Math.ceil(SHARE_LIMITS.imageBytes / 3) * 4)
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      ),
  })
  .strict();

export const SharedConversationSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().max(512),
    createdAt: timestamp,
    messages: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            role: z.enum(["user", "model"]),
            timestamp,
            blocks: z
              .array(
                z.discriminatedUnion("type", [
                  z.object({ type: z.literal("text"), content }).strict(),
                  z
                    .object({
                      type: z.literal("report"),
                      title: z.string().max(512),
                      content,
                    })
                    .strict(),
                  z
                    .object({
                      type: z.literal("image"),
                      assetId,
                      alt: z.string().max(512),
                      sourceUrl: safeUrl.optional(),
                    })
                    .strict(),
                  z
                    .object({
                      type: z.literal("attachment"),
                      fileName: z.string().max(512),
                    })
                    .strict(),
                  z
                    .object({
                      type: z.literal("sources"),
                      sources: z
                        .array(
                          z
                            .object({
                              title: z.string().max(512),
                              url: safeUrl,
                            })
                            .strict(),
                        )
                        .max(200),
                    })
                    .strict(),
                ]),
              )
              .max(1000),
          })
          .strict(),
      )
      .max(5000),
  })
  .strict();

export const ShareMutationSchema = z
  .object({
    id: ShareIdSchema,
    operationId: ShareIdSchema,
    expectedRevision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    expiresIn: ShareExpirySchema.optional(),
    snapshot: SharedConversationSchema,
    assets: z.array(ShareAssetSchema).max(SHARE_LIMITS.imageCount),
  })
  .strict();

export function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function assertShareSize({ snapshot, assets }: PreparedSessionShare) {
  if (utf8Bytes(JSON.stringify(snapshot)) > SHARE_LIMITS.snapshotBytes) {
    throw new ShareError(
      "SHARE_TOO_LARGE",
      "The conversation is too large to share.",
      413,
    );
  }
  if (assets.length > SHARE_LIMITS.imageCount) {
    throw new ShareError(
      "SHARE_TOO_MANY_IMAGES",
      "A share can contain at most 32 images.",
      413,
    );
  }
  let total = 0;
  const ids = new Set<string>();
  for (const asset of assets) {
    const bytes =
      (asset.data.length / 4) * 3 -
      (asset.data.endsWith("==") ? 2 : asset.data.endsWith("=") ? 1 : 0);
    if (bytes <= 0 || bytes > SHARE_LIMITS.imageBytes || ids.has(asset.id)) {
      throw new ShareError(
        "SHARE_INVALID_IMAGE",
        "A shared image is invalid or exceeds 512 KiB.",
        413,
      );
    }
    ids.add(asset.id);
    total += bytes;
  }
  if (total > SHARE_LIMITS.totalImageBytes) {
    throw new ShareError(
      "SHARE_IMAGES_TOO_LARGE",
      "Shared images exceed the 2 MiB total limit.",
      413,
    );
  }
  for (const message of snapshot.messages) {
    for (const block of message.blocks) {
      const referenced =
        block.type === "image"
          ? [block.assetId]
          : block.type === "text" || block.type === "report"
            ? Array.from(
                block.content.matchAll(/share-asset:([a-f0-9]{64})/g),
                (match) => match[1],
              )
            : [];
      if (referenced.some((id) => !ids.has(id))) {
        throw new ShareError(
          "SHARE_IMAGE_MISSING",
          "A referenced image is missing from this share.",
        );
      }
    }
  }
}
