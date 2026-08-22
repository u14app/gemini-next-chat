import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  assertProviderOutboundAllowed,
  createAnthropicClient,
  createGoogleClient,
  createOpenAIClient,
} from "@/utils/apiHelpers";
import {
  ModelNameSchema,
  ProviderRuntimeConfigSchema,
} from "@/lib/api/schemas";
import {
  createApiErrorResponse,
  readJsonRequestBody,
} from "@/lib/api/middleware";
import { resolveProviderRuntimeConfig } from "@/lib/byok/server";
import {
  simulateCode,
  type CodeSimulationResult,
} from "@/lib/chat/simulateCode";
import { safeServerLogError } from "@/lib/utils/safeServerLog";

const serverCodeSimulationRuntime = {
  assertOutboundAllowed: assertProviderOutboundAllowed,
  createOpenAIClient,
  createAnthropicClient,
  createGoogleClient,
};

function createCodeSimulationResponse(result: CodeSimulationResult) {
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json({ output: result.output });
}

const ExecuteCodeSchema = z.object({
  provider: ProviderRuntimeConfigSchema,
  modelName: ModelNameSchema,
  code: z.string().min(1).max(100_000),
});

export async function POST(request: NextRequest) {
  try {
    const body = ExecuteCodeSchema.parse(await readJsonRequestBody(request));
    const { modelName, code } = body;
    const provider = await resolveProviderRuntimeConfig(body.provider);
    return createCodeSimulationResponse(
      await simulateCode(
        provider,
        modelName,
        code,
        serverCodeSimulationRuntime,
        request.signal,
      ),
    );
  } catch (error: any) {
    safeServerLogError("Code execution error:", error);
    if (error instanceof Error && error.name === "ZodError") {
      return createApiErrorResponse(error, "Invalid code execution request");
    }
    return createApiErrorResponse(error, "Code execution failed");
  }
}
