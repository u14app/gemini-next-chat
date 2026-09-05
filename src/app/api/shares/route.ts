import { readJsonRequestBody } from "@/lib/api/middleware";
import { SHARE_LIMITS } from "@/lib/sharing/types";
import { ShareMutationSchema } from "@/lib/sharing/schema";
import { shareRepository } from "@/lib/sharing/server";
import { handleShareRoute, ownerToken, shareJson } from "@/lib/sharing/routes";

export async function POST(request: Request) {
  return handleShareRoute(async () => {
    const token = ownerToken(request);
    const body = ShareMutationSchema.parse(
      await readJsonRequestBody(request, SHARE_LIMITS.requestBytes),
    );
    return shareJson(await shareRepository.publish(body, token, "create"), 201);
  });
}
