import { ShareIdSchema } from "@/lib/sharing/schema";
import { SHARE_ASSET_ID_PATTERN, ShareError } from "@/lib/sharing/types";
import { decodeShareAsset, shareRepository } from "@/lib/sharing/server";
import { handleShareRoute, SHARE_RESPONSE_HEADERS } from "@/lib/sharing/routes";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; assetId: string }> },
) {
  return handleShareRoute(async () => {
    const { id, assetId } = await context.params;
    ShareIdSchema.parse(id);
    const revision = Number(new URL(request.url).searchParams.get("revision"));
    if (
      !SHARE_ASSET_ID_PATTERN.test(assetId) ||
      !Number.isSafeInteger(revision) ||
      revision < 1
    )
      throw new ShareError("SHARE_INVALID", "Invalid image reference.");
    const asset = await shareRepository.getAsset(id, assetId, revision);
    const bytes = decodeShareAsset(asset);
    return new Response(new Uint8Array(bytes).buffer, {
      headers: {
        ...SHARE_RESPONSE_HEADERS,
        "Content-Type": asset.mimeType,
        "Content-Length": String(bytes.byteLength),
      },
    });
  });
}
