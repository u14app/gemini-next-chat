import { z } from "zod";
import {
  API_INPUT_LIMITS,
  ATTACHMENT_LIMITS,
  CHAT_CONFIG_LIMITS,
  IMAGE_GENERATION_LIMITS,
  PLUGIN_EXECUTION_LIMITS,
  getAttachmentPayloadBytes,
  getAttachmentsPayloadChars,
  getRuntimeMaxAttachmentFileBytes,
} from "@/config/limits";
import { getRemoteAttachmentUrlError } from "../security/remoteAttachment";
import { getPluginExecutionArgsError } from "../plugin/execution";
import { BYOK_ALG } from "../byok/shared";
import { normalizeProviderType } from "../providers/providerTypes";
import { CHAT_IMAGE_UPLOAD_ID_PATTERN } from "./chatUploadProtocol";

const Base64UrlStringSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

export const EncryptedSecretEnvelopeSchema = z.object({
  v: z.literal(1),
  kid: z.string().min(1).max(128),
  alg: z.literal(BYOK_ALG),
  iv: Base64UrlStringSchema.min(1).max(1_024),
  wrappedKey: Base64UrlStringSchema.min(1).max(16_384),
  ciphertext: Base64UrlStringSchema.min(1).max(65_536),
  context: z.string().min(1).max(200),
});

function rejectPlainSecretField(
  value: unknown,
  ctx: z.RefinementCtx,
  path: string[],
  label: string,
) {
  if (typeof value === "string" && value.trim()) {
    ctx.addIssue({
      code: "custom",
      path,
      message: `${label} must be sent as an encrypted BYOK secret`,
    });
  }
}

function omitPlainSecretField<
  T extends Record<string, unknown>,
  K extends string,
>(value: T, field: K): Omit<T, K> {
  const next = { ...value };
  delete next[field];
  return next as Omit<T, K>;
}

export const ProviderRuntimeConfigSchema = z
  .object({
    type: z.enum([
      "OpenAI Compatible",
      "OpenAI",
      "Anthropic",
      "Google",
      "Gemini",
    ]),
    source: z.literal("server-default").optional(),
    apiKey: z.unknown().optional(),
    apiKeySecret: EncryptedSecretEnvelopeSchema.optional(),
    baseUrl: z.string().max(2_048).optional(),
    name: z.string().max(120).optional(),
  })
  .strict()
  .superRefine((provider, ctx) => {
    rejectPlainSecretField(
      provider.apiKey,
      ctx,
      ["apiKey"],
      "Provider API key",
    );
  })
  .transform((provider) => ({
    ...omitPlainSecretField(provider, "apiKey"),
    type: normalizeProviderType(provider.type),
  }));

const JsonLikeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonLikeSchema),
    z.record(z.string(), JsonLikeSchema),
  ]),
);

export const ModelNameSchema = z
  .string()
  .min(1)
  .max(API_INPUT_LIMITS.maxModelNameChars);

const ReasoningModeSchema = z.enum(["off", "auto", "low", "medium", "high"]);

export const AttachmentSchema = z.object({
  id: z.string().default(""),
  mimeType: z.string().min(1).max(ATTACHMENT_LIMITS.maxMimeTypeChars),
  data: z.string().max(ATTACHMENT_LIMITS.maxBase64Chars).optional(),
  url: z.string().max(ATTACHMENT_LIMITS.maxUrlChars).optional(),
  uploadId: z.string().regex(CHAT_IMAGE_UPLOAD_ID_PATTERN).optional(),
  fileName: z.string().min(1).max(ATTACHMENT_LIMITS.maxFileNameChars),
});

function addImageAttachmentTransportIssues(
  attachments: Array<z.infer<typeof AttachmentSchema>>,
  ctx: z.RefinementCtx,
  path: Array<string | number>,
): void {
  attachments.forEach((attachment, index) => {
    if (!attachment.mimeType.toLowerCase().startsWith("image/")) return;

    if (attachment.data) {
      ctx.addIssue({
        code: "custom",
        path: [...path, index, "data"],
        message: "Image attachments must be uploaded as files",
      });
    }

    if (attachment.uploadId && attachment.url) {
      ctx.addIssue({
        code: "custom",
        path: [...path, index, "uploadId"],
        message: "Uploaded image descriptors cannot include URLs",
      });
    }

    if (!attachment.data && !attachment.url && !attachment.uploadId) {
      ctx.addIssue({
        code: "custom",
        path: [...path, index],
        message: "Image attachment source is required",
      });
    }
  });
}

function addAttachmentFileSizeIssues(
  attachments: Array<z.infer<typeof AttachmentSchema>>,
  ctx: z.RefinementCtx,
  path: string[],
): void {
  const maxFileBytes = getRuntimeMaxAttachmentFileBytes();

  attachments.forEach((attachment, index) => {
    if (getAttachmentPayloadBytes(attachment) <= maxFileBytes) return;

    ctx.addIssue({
      code: "custom",
      path: [...path, index, "data"],
      message: "Attachment file is too large",
    });
  });
}

export const ToolCallSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(128),
    args: z.record(z.string(), JsonLikeSchema).default({}),
    status: z
      .enum([
        "pending",
        "awaiting_confirmation",
        "running",
        "success",
        "error",
        "skipped",
        "denied",
      ])
      .optional(),
    result: JsonLikeSchema.optional(),
    isError: z.boolean().optional(),
  })
  .transform((toolCall) => ({
    ...toolCall,
    status:
      toolCall.status ||
      (toolCall.isError
        ? "error"
        : toolCall.result !== undefined
          ? "success"
          : "pending"),
  }));

const MessageMemoryContextSchema = z.object({
  injectedMemoryIds: z.array(z.string().min(1).max(160)).max(100).default([]),
  promptContext: z.string().min(1).max(8_000),
  createdAt: z.number().optional(),
});

const SkillInvocationParametersSchema = z
  .record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.string().max(20_000))
  .refine((parameters) => Object.keys(parameters).length <= 20, {
    message: "Too many skill invocation parameters",
  });

export const SkillInvocationSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[A-Za-z0-9_-]+$/),
    title: z.string().min(1).max(160),
    description: z.string().max(2_048).optional(),
    category: z.string().min(1).max(120),
    mode: z.enum(["manual", "auto"]),
    schemaVersion: z.literal(2).optional(),
    definitionHash: z
      .string()
      .regex(/^fnv1a-[0-9a-f]{8}$/)
      .optional(),
    order: z.number().int().min(0).max(19).optional(),
    parameters: SkillInvocationParametersSchema.optional(),
    bundleId: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict();

export const MessageSchema = z.object({
  id: z.string().default(""),
  role: z.enum(["user", "model"]),
  content: z.string().max(2_000_000).default(""),
  reasoning: z.string().max(2_000_000).optional(),
  timestamp: z.number().default(0),
  attachments: z.array(AttachmentSchema).max(20).optional(),
  toolCalls: z
    .array(ToolCallSchema)
    .max(PLUGIN_EXECUTION_LIMITS.maxStreamedToolCalls)
    .optional(),
  skillInvocations: z.array(SkillInvocationSchema).max(20).optional(),
  memoryContext: MessageMemoryContextSchema.optional(),
  model: ModelNameSchema.optional(),
});

const FunctionParametersSchema = z
  .object({
    type: z.string().optional(),
    properties: z.record(z.string(), JsonLikeSchema).optional(),
    required: z.array(z.string()).optional(),
  })
  .passthrough();

const ToolSchema = z
  .object({
    type: z.literal("function"),
    function: z
      .object({
        name: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Za-z0-9_-]+$/),
        description: z.string().max(2_048).optional(),
        parameters: FunctionParametersSchema.optional(),
      })
      .strict(),
  })
  .strict();

const StructuredResponseFormatSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/),
    schema: z.record(z.string(), JsonLikeSchema),
    strict: z.boolean(),
  })
  .strict();

export const ChatRequestSchema = z
  .object({
    provider: ProviderRuntimeConfigSchema,
    modelName: ModelNameSchema,
    history: z.array(MessageSchema).max(400),
    newMessage: z.string().max(API_INPUT_LIMITS.maxChatTextChars),
    attachments: z
      .array(AttachmentSchema)
      .max(ATTACHMENT_LIMITS.maxCount)
      .optional(),
    config: z
      .object({
        temperature: z
          .number()
          .min(CHAT_CONFIG_LIMITS.minTemperature)
          .max(CHAT_CONFIG_LIMITS.maxTemperature)
          .optional(),
        useReasoning: z.boolean().optional(),
        reasoningMode: ReasoningModeSchema.optional(),
        useSearch: z.boolean().optional(),
        useAgentMode: z.boolean().optional(),
        useDeepResearch: z.boolean().optional(),
        useRAG: z.boolean().optional(),
        imageCount: z
          .number()
          .int()
          .min(IMAGE_GENERATION_LIMITS.minCount)
          .max(IMAGE_GENERATION_LIMITS.maxCount)
          .optional(),
      })
      .strict()
      .optional(),
    systemInstruction: z
      .string()
      .max(API_INPUT_LIMITS.maxSystemInstructionChars)
      .optional(),
    responseFormat: StructuredResponseFormatSchema.optional(),
    tools: z.array(ToolSchema).max(64).optional(),
    enableImageGeneration: z.boolean().optional(),
    enableGoogleSearch: z.boolean().optional(),
    enableOpenAIWebSearch: z.boolean().optional(),
  })
  .strict()
  .superRefine((request, ctx) => {
    const attachments = request.attachments || [];
    const totalPayloadChars = getAttachmentsPayloadChars(attachments);

    if (totalPayloadChars > ATTACHMENT_LIMITS.maxTotalBase64Chars) {
      ctx.addIssue({
        code: "custom",
        path: ["attachments"],
        message: "Attachment payload is too large",
      });
    }

    addAttachmentFileSizeIssues(attachments, ctx, ["attachments"]);
    addImageAttachmentTransportIssues(attachments, ctx, ["attachments"]);

    request.history.forEach((message, messageIndex) => {
      addImageAttachmentTransportIssues(message.attachments || [], ctx, [
        "history",
        messageIndex,
        "attachments",
      ]);
    });

    attachments.forEach((attachment, index) => {
      if (!attachment.url) return;

      const remoteUrlError = getRemoteAttachmentUrlError(attachment.url);
      if (remoteUrlError) {
        ctx.addIssue({
          code: "custom",
          path: ["attachments", index, "url"],
          message: remoteUrlError,
        });
      }
    });
  });

export const SimpleGenerateRequestSchema = z
  .object({
    provider: ProviderRuntimeConfigSchema,
    modelName: ModelNameSchema,
    prompt: z.string().min(1).max(API_INPUT_LIMITS.maxSimplePromptChars),
  })
  .strict();

export const AuxiliaryGenerateRequestSchema = z
  .object({
    provider: ProviderRuntimeConfigSchema,
    modelName: ModelNameSchema,
    history: z.array(MessageSchema).max(100).optional(),
    userMessage: z
      .string()
      .max(API_INPUT_LIMITS.maxAuxiliaryTextChars)
      .optional(),
  })
  .strict();

const PluginFunctionSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    description: z.string().max(2_048).optional(),
    parameters: FunctionParametersSchema.optional(),
    path: z.string().min(1).max(1_024).optional(),
    method: z
      .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
      .or(z.enum(["get", "post", "put", "patch", "delete"]))
      .optional(),
    mcpToolName: z.string().min(1).max(256).optional(),
    risk: z.enum(["read", "write", "destructive", "external"]).optional(),
  })
  .strict()
  .superRefine((functionDef, ctx) => {
    if (functionDef.mcpToolName) return;
    if (functionDef.path && functionDef.method) return;

    ctx.addIssue({
      code: "custom",
      message:
        "Plugin function must declare either REST path/method or mcpToolName",
    });
  });

const PluginHeaderMapSchema = z.record(
  z.string().min(1).max(120),
  z.string().max(4_096),
);

const PluginSchema = z
  .object({
    id: z.string().min(1).max(200),
    title: z.string().max(300).optional(),
    description: z.string().max(5_000).optional(),
    logoUrl: z.string().max(2_048).optional(),
    manifestUrl: z.string().max(2_048).optional(),
    externalDocsUrl: z.string().max(2_048).optional(),
    baseUrl: z.string().max(2_048).optional(),
    category: z.string().max(120).optional(),
    categories: z.array(z.string().max(120)).max(20).optional(),
    added: z.string().max(120).optional(),
    functions: z.array(PluginFunctionSchema).max(40).optional(),
    source: z.enum(["builtin", "openapi", "mcp"]).optional(),
    mcp: z
      .object({
        transport: z.enum(["streamable-http", "sse"]),
        source: z.enum(["registry", "custom", "bridge"]).optional(),
        serverUrl: z.string().min(1).max(2_048),
        serverName: z.string().min(1).max(300),
        serverVersion: z.string().max(120).optional(),
        headers: PluginHeaderMapSchema.optional(),
        toolNameMap: z.record(z.string(), z.string()).optional(),
      })
      .strict()
      .optional(),
    builtIn: z.boolean().optional(),
    auth: z
      .object({
        type: z.enum(["bearer", "apiKey", "basic", "oauth2", "none"]),
        name: z.string().max(120).optional(),
        in: z.enum(["header", "query"]).optional(),
        required: z.boolean().optional(),
      })
      .optional(),
  })
  .strict();

const PluginAuthConfigSchema = z
  .object({
    type: z.enum(["bearer", "apiKey", "none", "oauth2"]).optional(),
    value: z.unknown().optional(),
    valueSecret: EncryptedSecretEnvelopeSchema.optional(),
    key: z.string().max(120).optional(),
    addTo: z.enum(["header", "query"]).optional(),
    baseUrl: z.string().max(2_048).optional(),
    model: ModelNameSchema.optional(),
  })
  .strict()
  .superRefine((authConfig, ctx) => {
    rejectPlainSecretField(
      authConfig.value,
      ctx,
      ["value"],
      "Plugin auth value",
    );
  })
  .transform((authConfig) => omitPlainSecretField(authConfig, "value"))
  .optional();

export const ToolExecutionSchema = z
  .object({
    plugin: PluginSchema,
    functionDef: PluginFunctionSchema,
    args: z.record(z.string(), JsonLikeSchema).default({}),
    authConfig: PluginAuthConfigSchema,
  })
  .strict()
  .superRefine((request, ctx) => {
    const argsError = getPluginExecutionArgsError(request.args);
    if (argsError) {
      ctx.addIssue({
        code: "custom",
        path: ["args"],
        message: argsError,
      });
    }
  });

export const PluginExecutionRequestSchema = z
  .object({
    pluginId: z.string().min(1).max(200),
    functionName: z.string().min(1).max(128),
    expectedFingerprint: z.string().min(1).max(200).optional(),
    args: z.record(z.string(), JsonLikeSchema).default({}),
    authConfig: PluginAuthConfigSchema,
    callId: z.string().max(200).optional(),
  })
  .strict()
  .superRefine((request, ctx) => {
    const argsError = getPluginExecutionArgsError(request.args);
    if (argsError) {
      ctx.addIssue({
        code: "custom",
        path: ["args"],
        message: argsError,
      });
    }
  });

export const PluginInstallSchema = z
  .object({
    plugin: PluginSchema.partial().optional(),
    customInput: z.string().max(2_000_000).optional(),
    authConfig: PluginAuthConfigSchema,
  })
  .strict();

export const McpBridgeDiscoveryRequestSchema = z
  .object({
    manifestUrl: z.string().min(1).max(2_048),
    tokenSecret: EncryptedSecretEnvelopeSchema,
  })
  .strict();

export const SearchRequestSchema = z
  .object({
    provider: z.enum([
      "default",
      "tavily",
      "firecrawl",
      "exa",
      "bocha",
      "searxng",
    ]),
    query: z.string().min(1).max(4_000),
    scope: z.string().max(100).optional(),
    timeRange: z.enum(["any", "day", "week", "month", "year"]).optional(),
    config: z
      .object({
        apiKey: z.unknown().optional(),
        apiKeySecret: EncryptedSecretEnvelopeSchema.optional(),
        baseUrl: z.string().max(2_048).optional(),
        useDefault: z.boolean().optional(),
      })
      .strict()
      .superRefine((config, ctx) => {
        rejectPlainSecretField(
          config.apiKey,
          ctx,
          ["apiKey"],
          "Search API key",
        );
      })
      .transform((config) => omitPlainSecretField(config, "apiKey"))
      .optional(),
    maxResult: z.coerce.number().int().min(1).max(10).optional(),
  })
  .strict();

export const FetchUrlRequestSchema = z
  .object({
    url: z.string().max(2_048).url(),
  })
  .strict();

export const MessageImageProxyRequestSchema = z
  .object({
    url: z.string().max(2_048).url(),
  })
  .strict();

export const RAGQuerySchema = z
  .object({
    text: z.string().min(1).max(200_000),
    namespace: z.string().max(200).optional(),
    url: z.string().max(2_048).optional(),
    token: z.unknown().optional(),
    tokenSecret: EncryptedSecretEnvelopeSchema.optional(),
    useDefault: z.boolean().optional(),
    topK: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict()
  .superRefine((request, ctx) => {
    rejectPlainSecretField(request.token, ctx, ["token"], "RAG token");
    if (!request.useDefault && (!request.url?.trim() || !request.tokenSecret)) {
      ctx.addIssue({
        code: "custom",
        path: ["tokenSecret"],
        message: "RAG URL and token are required",
      });
    }
  })
  .transform((request) => omitPlainSecretField(request, "token"));

export const RAGUpsertSchema = z
  .object({
    items: z
      .array(
        z.object({
          id: z.string().min(1),
          data: z.string().min(1).max(200_000),
          metadata: z.record(z.string(), JsonLikeSchema).optional(),
        }),
      )
      .max(1_000),
    namespace: z.string().max(200).optional(),
    url: z.string().max(2_048).optional(),
    token: z.unknown().optional(),
    tokenSecret: EncryptedSecretEnvelopeSchema.optional(),
    useDefault: z.boolean().optional(),
  })
  .strict()
  .superRefine((request, ctx) => {
    rejectPlainSecretField(request.token, ctx, ["token"], "RAG token");
    if (!request.useDefault && (!request.url?.trim() || !request.tokenSecret)) {
      ctx.addIssue({
        code: "custom",
        path: ["tokenSecret"],
        message: "RAG URL and token are required",
      });
    }
  })
  .transform((request) => omitPlainSecretField(request, "token"));

export const DocumentParseSchema = z
  .object({
    file: z.instanceof(File),
    provider: z.enum(["mineru", "llamaParse"]).default("mineru"),
    apiKey: z.unknown().optional(),
    apiToken: z.unknown().optional(),
    apiKeySecret: EncryptedSecretEnvelopeSchema.optional(),
    useDefault: z.boolean().optional(),
  })
  .strict()
  .superRefine((request, ctx) => {
    rejectPlainSecretField(
      request.apiKey,
      ctx,
      ["apiKey"],
      "Document parse API key",
    );
    rejectPlainSecretField(
      request.apiToken,
      ctx,
      ["apiToken"],
      "Document parse API token",
    );
    if (
      !request.useDefault &&
      request.provider === "llamaParse" &&
      !request.apiKeySecret
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["apiKeySecret"],
        message: "Document parse API key is required",
      });
    }
  })
  .transform((request) =>
    omitPlainSecretField(omitPlainSecretField(request, "apiKey"), "apiToken"),
  );

export const ImageGenerateRequestSchema = z
  .object({
    provider: ProviderRuntimeConfigSchema,
    modelName: ModelNameSchema,
    prompt: z.string().min(1).max(8_000),
    imageCount: z
      .number()
      .int()
      .min(IMAGE_GENERATION_LIMITS.minCount)
      .max(IMAGE_GENERATION_LIMITS.maxCount)
      .optional(),
    attachments: z
      .array(AttachmentSchema)
      .max(ATTACHMENT_LIMITS.maxCount)
      .optional(),
  })
  .strict()
  .superRefine((request, ctx) => {
    const attachments = request.attachments || [];
    const totalPayloadChars = getAttachmentsPayloadChars(attachments);

    if (totalPayloadChars > ATTACHMENT_LIMITS.maxTotalBase64Chars) {
      ctx.addIssue({
        code: "custom",
        path: ["attachments"],
        message: "Attachment payload is too large",
      });
    }

    addAttachmentFileSizeIssues(attachments, ctx, ["attachments"]);
    addImageAttachmentTransportIssues(attachments, ctx, ["attachments"]);

    attachments.forEach((attachment, index) => {
      if (!attachment.url) return;

      const remoteUrlError = getRemoteAttachmentUrlError(attachment.url);
      if (remoteUrlError) {
        ctx.addIssue({
          code: "custom",
          path: ["attachments", index, "url"],
          message: remoteUrlError,
        });
      }
    });
  });

export const VoiceSynthesizeRequestSchema = z
  .object({
    text: z.string().min(1).max(10_000),
    provider: z.enum(["default", "elevenlabs", "mimo", "browser", "model"]),
    apiKey: z.unknown().optional(),
    apiKeySecret: EncryptedSecretEnvelopeSchema.optional(),
    voiceId: z.string().max(120).optional(),
    modelId: z.string().max(120).optional(),
    modelProvider: ProviderRuntimeConfigSchema.optional(),
  })
  .strict()
  .superRefine((request, ctx) => {
    rejectPlainSecretField(request.apiKey, ctx, ["apiKey"], "Voice API key");
  })
  .superRefine((request, ctx) => {
    if (request.provider === "elevenlabs" && !request.voiceId?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["voiceId"],
        message: "ElevenLabs voice ID is required",
      });
    }
  })
  .transform((request) => omitPlainSecretField(request, "apiKey"));

export const VoiceTranscribeRequestSchema = z
  .object({
    provider: z.enum(["default", "elevenlabs", "mimo", "browser", "model"]),
    apiKey: z.unknown().optional(),
    apiKeySecret: EncryptedSecretEnvelopeSchema.optional(),
    modelId: z.string().max(120).optional(),
    modelProvider: ProviderRuntimeConfigSchema.optional(),
    language: z.enum(["auto", "en", "zh", "ja"]).optional(),
  })
  .strict()
  .superRefine((request, ctx) => {
    rejectPlainSecretField(request.apiKey, ctx, ["apiKey"], "Voice API key");
  })
  .transform((request) => omitPlainSecretField(request, "apiKey"));
