import { NextRequest, NextResponse } from "next/server";
import {
  assertProviderOutboundAllowed,
  createGoogleClient,
} from "@/utils/apiHelpers";
import { createApiErrorResponse } from "@/lib/api/middleware";
import { ImageGenerateRequestSchema } from "@/lib/api/schemas";
import {
  hydrateChatImageUploads,
  readChatRequestBody,
} from "@/lib/api/chatMultipart";
import { safeFetchJson } from "@/lib/security/safeFetch";
import { getSafeUrlPolicy } from "@/lib/security/urlPolicy";
import { resolveProviderRuntimeConfig } from "@/lib/byok/server";
import {
  generateImage,
  type ImageGenerationRuntime,
} from "@/lib/chat/generateImage";
import type { ProviderImageAttachment } from "@/lib/providers/imageFiles";
import { safeServerLogError } from "@/lib/utils/safeServerLog";

const IMAGE_REQUEST_OPTIONS = {
  policy: getSafeUrlPolicy("provider"),
  timeoutMs: 120_000,
  maxResponseBytes: 36 * 1024 * 1024,
} as const;

// 保持惰性引用：仅在实际走到对应分支时才解引用 provider 客户端工厂
const serverImageRuntime: ImageGenerationRuntime = {
  assertOutboundAllowed: (provider, signal) =>
    assertProviderOutboundAllowed(provider, signal),
  createGoogleClient: (provider) => createGoogleClient(provider),
  fetchJson: (url, init) =>
    safeFetchJson<any>(url, init, IMAGE_REQUEST_OPTIONS),
};

export async function POST(request: NextRequest) {
  try {
    const requestBody = await readChatRequestBody(request);
    const body = await hydrateChatImageUploads(
      ImageGenerateRequestSchema.parse(requestBody.payload),
      requestBody.files,
    );
    const { modelName, prompt, imageCount, attachments } = body;
    const provider = await resolveProviderRuntimeConfig(body.provider);

    const result = await generateImage(
      {
        provider,
        modelName,
        prompt,
        imageCount,
        attachments: attachments as ProviderImageAttachment[] | undefined,
        signal: request.signal,
      },
      serverImageRuntime,
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({
      images: result.images,
      message: result.message,
    });
  } catch (error: any) {
    if (
      request.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      return new Response(null, { status: 499 });
    }
    safeServerLogError("Image generation error:", error);
    if (error instanceof Error && error.name === "ZodError") {
      return createApiErrorResponse(error, "Invalid image generation request");
    }
    return createApiErrorResponse(error, "Image generation failed");
  }
}
