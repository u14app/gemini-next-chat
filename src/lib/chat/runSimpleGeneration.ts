/**
 * 传输无关的简单文本生成（标题、相关问题、RAG 查询等）
 *
 * 该模块必须保持同构：不得引入 server-only 模块或 Node API。
 */

import { createAnthropicMessageText } from "../streaming/anthropic";
import {
  isOpenAIProviderType,
  isAnthropicProviderType,
  isGoogleProviderType,
} from "../providers/providerTypes";
import type { ProviderConfig, ProviderRuntime } from "./runChatStream";

function getResponsesOutputText(response: any): string {
  if (typeof response?.output_text === "string") return response.output_text;

  const output = Array.isArray(response?.output) ? response.output : [];
  return output
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .map((content: any) =>
      typeof content?.text === "string" ? content.text : "",
    )
    .join("");
}

export async function runSimpleGeneration(
  provider: ProviderConfig,
  modelName: string,
  prompt: string,
  runtime: ProviderRuntime,
  signal?: AbortSignal,
): Promise<string> {
  await runtime.assertOutboundAllowed(provider, signal);

  if (provider.type === "OpenAI") {
    const client = runtime.createOpenAIClient(provider);
    const request: any = {
      model: modelName,
      input: prompt,
      temperature: 0.7,
    };
    const response = signal
      ? await client.responses.create(request, { signal })
      : await client.responses.create(request);
    return getResponsesOutputText(response);
  }

  if (isOpenAIProviderType(provider.type)) {
    const client = runtime.createOpenAIClient(provider);
    const request: any = {
      model: modelName,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    };
    const response = signal
      ? await client.chat.completions.create(request, { signal })
      : await client.chat.completions.create(request);
    return response.choices[0]?.message?.content || "";
  }

  if (isAnthropicProviderType(provider.type)) {
    const client = runtime.createAnthropicClient(provider);
    return createAnthropicMessageText({
      client,
      model: modelName,
      prompt,
      signal,
    });
  }

  if (isGoogleProviderType(provider.type)) {
    const client = runtime.createGoogleClient(provider);
    const request: any = {
      model: modelName,
      contents: { parts: [{ text: prompt }] },
    };
    if (signal) request.config = { abortSignal: signal };
    const result = await client.models.generateContent(request);
    return result.text || "";
  }

  throw new Error(`Unsupported provider type: ${provider.type}`);
}
