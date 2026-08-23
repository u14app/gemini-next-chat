import type { Message, Attachment } from "@/types";
import { useSettingsStore, getTaskModel } from "@/store/core/settingsStore";
import { useCoreSettingsStore } from "@/store/core/coreSettingsStore";
import { parseModelString } from "@/lib/utils/model";
import { normalizeSessionTitle } from "@/lib/chat/entities";
import {
  compressImageAttachments,
  getImageCompressionConfig,
  prepareGeneratedImageAttachments,
} from "@/lib/utils/imageCompression";
import { stripAttachmentsDisplayCacheForModel } from "@/lib/utils/imageDisplayCache";
import {
  getResponseErrorMessage,
  readJsonResponseOrThrow,
  signedApiFetch,
} from "@/lib/api/client";
import { createChatRequestBody } from "@/lib/api/chatImageRequestBody";
import {
  buildProviderRuntimeConfig,
  fetchWithByokRetry,
} from "@/lib/byok/client";
import {
  buildDirectProviderConfig,
  getBrowserImageRuntime,
  describeDirectCallError,
  directSimpleGenerator,
  getBrowserProviderRuntime,
  hydrateDirectProviderImageFiles,
  shouldUseDirectCall,
} from "./transport";
import { logDevError } from "@/lib/utils/devLogger";
import { createAbortError, isAbortError } from "./streamErrors";

export const executeCode = async (
  modelString: string,
  code: string,
): Promise<string> => {
  const { providerId, modelName } = parseModelString(modelString);

  const { providers } = useCoreSettingsStore.getState();
  const provider = providerId
    ? providers.find((p) => p.id === providerId)
    : providers.find((p) => p.enabled);

  if (!provider) throw new Error("No provider found");

  if (shouldUseDirectCall(provider)) {
    try {
      const [{ simulateCode }, runtime, directProvider] = await Promise.all([
        import("@/lib/chat/simulateCode"),
        getBrowserProviderRuntime(),
        buildDirectProviderConfig(provider),
      ]);
      const result = await simulateCode(
        directProvider,
        modelName,
        code,
        runtime,
      );
      if (!result.ok) throw new Error(result.error);
      return result.output;
    } catch (error) {
      throw describeDirectCallError(error, provider);
    }
  }

  try {
    const response = await fetchWithByokRetry(async () =>
      signedApiFetch("/api/chat/execute-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: await buildProviderRuntimeConfig(provider),
          modelName,
          code,
        }),
      }),
    );

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(response, "Code execution failed"),
      );
    }

    const data = await readJsonResponseOrThrow<{
      output?: string;
      error?: string;
    }>(response, "Code execution failed");
    return data.output || data.error || "No output.";
  } catch (error) {
    logDevError("Code execution error:", error);
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
};

export const generateChatTitle = async (
  history: Message[],
  signal?: AbortSignal,
): Promise<string> => {
  const fallbackTitle = () =>
    normalizeSessionTitle(history.find((m) => m.role === "user")?.content);
  const { providers } = useCoreSettingsStore.getState();
  const provider = providers.find((p) => p.enabled);

  if (!provider) return fallbackTitle();

  // Get task model from settings using helper function
  const modelString = getTaskModel("titleGeneration");

  const { providerId, modelName } = parseModelString(modelString);

  const targetProvider = providerId
    ? providers.find((p) => p.id === providerId)
    : provider;

  if (!targetProvider) return fallbackTitle();

  try {
    if (shouldUseDirectCall(targetProvider)) {
      const [{ generateTitleWith }, generate, directProvider] =
        await Promise.all([
          import("@/lib/chat/auxiliaryGeneration"),
          directSimpleGenerator(),
          buildDirectProviderConfig(targetProvider),
        ]);
      return await generateTitleWith(
        generate,
        directProvider,
        modelName,
        history,
        signal,
      );
    }

    const response = await fetchWithByokRetry(async () =>
      signedApiFetch("/api/chat/generate-title", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: await buildProviderRuntimeConfig(targetProvider, signal),
          modelName,
          history,
        }),
        signal,
      }),
    );

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(response, "Title generation failed"),
      );
    }

    const data = await readJsonResponseOrThrow<{ title?: string }>(
      response,
      "Title generation failed",
    );
    return normalizeSessionTitle(data.title);
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    logDevError("Title generation error:", error);
    return fallbackTitle();
  }
};

export const generateRelatedQuestions = async (
  history: Message[],
  signal?: AbortSignal,
): Promise<string[]> => {
  const { providers } = useCoreSettingsStore.getState();
  const provider = providers.find((p) => p.enabled);

  if (!provider) return [];

  // Get task model from settings using helper function
  const modelString = getTaskModel("relatedQuestions");

  const { providerId, modelName } = parseModelString(modelString);

  const targetProvider = providerId
    ? providers.find((p) => p.id === providerId)
    : provider;

  if (!targetProvider) return [];

  try {
    if (shouldUseDirectCall(targetProvider)) {
      const [{ generateRelatedQuestionsWith }, generate, directProvider] =
        await Promise.all([
          import("@/lib/chat/auxiliaryGeneration"),
          directSimpleGenerator(),
          buildDirectProviderConfig(targetProvider),
        ]);
      return await generateRelatedQuestionsWith(
        generate,
        directProvider,
        modelName,
        history,
        signal,
      );
    }

    const response = await fetchWithByokRetry(async () =>
      signedApiFetch("/api/chat/related-questions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: await buildProviderRuntimeConfig(targetProvider, signal),
          modelName,
          history,
        }),
        signal,
      }),
    );

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(
          response,
          "Related questions generation failed",
        ),
      );
    }

    const data = await readJsonResponseOrThrow<{ questions?: string[] }>(
      response,
      "Related questions generation failed",
    );
    return data.questions || [];
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    logDevError("Related questions error:", error);
    return [];
  }
};

export const generateRAGSearchQueries = async (
  userPrompt: string,
  signal?: AbortSignal,
): Promise<string[]> => {
  const { providers } = useCoreSettingsStore.getState();
  const provider = providers.find((p) => p.enabled);

  if (!provider) return [userPrompt];

  // Get task model from settings using helper function
  const modelString = getTaskModel("ragQuery");

  const { providerId, modelName } = parseModelString(modelString);

  const targetProvider = providerId
    ? providers.find((p) => p.id === providerId)
    : provider;

  if (!targetProvider) return [userPrompt];

  try {
    if (shouldUseDirectCall(targetProvider)) {
      const [{ generateRAGQueriesWith }, generate, directProvider] =
        await Promise.all([
          import("@/lib/chat/auxiliaryGeneration"),
          directSimpleGenerator(),
          buildDirectProviderConfig(targetProvider),
        ]);
      return await generateRAGQueriesWith(
        generate,
        directProvider,
        modelName,
        userPrompt,
        signal,
      );
    }

    const response = await fetchWithByokRetry(async () =>
      signedApiFetch("/api/chat/rag-queries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: await buildProviderRuntimeConfig(targetProvider, signal),
          modelName,
          userMessage: userPrompt,
        }),
        signal,
      }),
    );

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(
          response,
          "RAG queries generation failed",
        ),
      );
    }

    const data = await readJsonResponseOrThrow<{ queries?: string[] }>(
      response,
      "RAG queries generation failed",
    );
    return data.queries || [userPrompt];
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    logDevError("RAG queries error:", error);
    return [userPrompt];
  }
};

export const generateImage = async (
  modelString: string,
  prompt: string,
  options: { imageCount?: number; attachments?: Attachment[] } = {},
  signal?: AbortSignal,
): Promise<{ images: Attachment[]; message: string }> => {
  const { providerId, modelName } = parseModelString(modelString);

  const { providers } = useCoreSettingsStore.getState();
  const provider = providerId
    ? providers.find((p) => p.id === providerId)
    : providers.find((p) => p.enabled);

  if (!provider) throw new Error("No provider found");

  try {
    const imageCompressionConfig = getImageCompressionConfig(
      useSettingsStore.getState().system,
    );
    const preparedAttachments = options.attachments
      ? await compressImageAttachments(
          options.attachments,
          imageCompressionConfig,
          { signal },
        )
      : undefined;
    const requestAttachments = preparedAttachments
      ? await stripAttachmentsDisplayCacheForModel(preparedAttachments)
      : undefined;
    if (shouldUseDirectCall(provider)) {
      const [{ generateImage }, runtime, directProvider] = await Promise.all([
        import("@/lib/chat/generateImage"),
        getBrowserImageRuntime(),
        buildDirectProviderConfig(provider),
      ]);
      const directImages = await hydrateDirectProviderImageFiles(
        [],
        requestAttachments || [],
        { signal },
      );

      let result;
      try {
        result = await generateImage(
          {
            provider: directProvider,
            modelName,
            prompt,
            imageCount: options.imageCount,
            attachments: directImages.attachments,
            signal,
          },
          runtime,
        );
      } catch (error) {
        throw describeDirectCallError(error, provider);
      }

      if (!result.ok) throw new Error(result.error);

      return {
        images: await prepareGeneratedImageAttachments(
          result.images,
          imageCompressionConfig,
          { signal },
        ),
        message: result.message,
      };
    }

    const response = await fetchWithByokRetry(async () => {
      const request = await createChatRequestBody(
        {
          provider: await buildProviderRuntimeConfig(provider, signal),
          modelName,
          prompt,
          imageCount: options.imageCount,
          attachments: requestAttachments,
        },
        { signal },
      );
      return signedApiFetch("/api/chat/generate-image", {
        method: "POST",
        headers: request.headers,
        body: request.body,
        signal,
      });
    });

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(response, "Image generation failed"),
      );
    }

    const data = await readJsonResponseOrThrow<{
      images?: Attachment[];
      message?: string;
    }>(response, "Image generation failed");
    const images = await prepareGeneratedImageAttachments(
      data.images || [],
      imageCompressionConfig,
      { signal },
    );
    return {
      images,
      message: data.message || "No images generated.",
    };
  } catch (error) {
    if (isAbortError(error, signal)) throw createAbortError(signal);
    logDevError("Image generation error:", error);
    throw error;
  }
};
