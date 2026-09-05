import { readJsonRequestBody } from "@/lib/api/middleware";
import { SHARE_LIMITS, ShareError } from "@/lib/sharing/types";
import { ShareIdSchema, ShareMutationSchema } from "@/lib/sharing/schema";
import { shareRepository } from "@/lib/sharing/server";
import { handleShareRoute, ownerToken, shareJson } from "@/lib/sharing/routes";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return handleShareRoute(async () =>
    shareJson(
      await shareRepository.get(ShareIdSchema.parse((await context.params).id)),
    ),
  );
}

export async function PUT(request: Request, context: Context) {
  return handleShareRoute(async () => {
    const token = ownerToken(request);
    const id = ShareIdSchema.parse((await context.params).id);
    const body = ShareMutationSchema.parse(
      await readJsonRequestBody(request, SHARE_LIMITS.requestBytes),
    );
    if (body.id !== id)
      throw new ShareError("SHARE_INVALID", "Share identifiers do not match.");
    return shareJson(await shareRepository.publish(body, token, "update"));
  });
}

export async function DELETE(request: Request, context: Context) {
  return handleShareRoute(async () => {
    const token = ownerToken(request);
    await shareRepository.revoke(
      ShareIdSchema.parse((await context.params).id),
      token,
    );
    return shareJson({ revoked: true });
  }, "revoke");
}
