/**
 * 浏览器直连 provider 客户端
 *
 * 与服务端的 `ProviderFactory` 相对：使用平台 fetch，不做 SSRF/DNS 校验
 * （请求源自用户本机、目标由用户自行配置），但需要开启各 SDK 的浏览器直连开关。
 */

import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { AuthenticationError } from "../errors";
import {
  ANTHROPIC_API_VERSION_HEADER,
  getProviderAnthropicSdkBaseUrl,
  getProviderApiKey,
  getProviderGoogleSdkOptions,
  isLocalhostName,
  isLocalNetworkIpAddress,
  normalizeProviderBaseUrl,
  type ProviderRuntimeConfig,
} from "../security/urlPolicy";
import { isAnthropicProviderType, isOpenAIProviderType } from "./providerTypes";

/** Anthropic 拒绝来自浏览器的请求，除非显式带上该头 */
const ANTHROPIC_BROWSER_HEADER = "anthropic-dangerous-direct-browser-access";

/**
 * 直连前的最小 URL 校验。
 *
 * 服务端由 safeFetch 的出站策略兜底，浏览器没有这层保护。
 * HTTPS 可访问外部地址；HTTP 仅允许显式的本机或局域网字面地址。
 */
export function assertDirectProviderUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid provider URL: ${value}`);
  }

  if (url.username || url.password) {
    throw new Error("Provider URLs must not include embedded credentials");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Protocol ${url.protocol} is not allowed`);
  }

  if (
    url.protocol === "http:" &&
    !isLocalhostName(url.hostname) &&
    !isLocalNetworkIpAddress(url.hostname)
  ) {
    throw new Error(
      "Direct provider URLs must use HTTPS unless the host is localhost, a loopback address, or a private LAN IP",
    );
  }

  return url;
}

function requireApiKey(provider: ProviderRuntimeConfig): string {
  const apiKey = getProviderApiKey(provider);

  if (!apiKey.trim()) {
    throw new AuthenticationError(
      `${provider.type} API key is not configured. Please add your API key in Settings.`,
    );
  }

  return apiKey;
}

export function createBrowserOpenAIClient(
  provider: ProviderRuntimeConfig,
): OpenAI {
  const apiKey = requireApiKey(provider);
  const baseURL = normalizeProviderBaseUrl(provider.baseUrl, provider.type);
  assertDirectProviderUrl(baseURL);

  return new OpenAI({
    apiKey,
    baseURL,
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
  });
}

export function createBrowserAnthropicClient(
  provider: ProviderRuntimeConfig,
): Anthropic {
  const apiKey = requireApiKey(provider);
  const baseURL = getProviderAnthropicSdkBaseUrl(provider.baseUrl);
  assertDirectProviderUrl(baseURL);

  return new Anthropic({
    apiKey,
    baseURL,
    dangerouslyAllowBrowser: true,
    defaultHeaders: { [ANTHROPIC_BROWSER_HEADER]: "true" },
    maxRetries: 0,
  });
}

export function createBrowserGoogleClient(
  provider: ProviderRuntimeConfig,
): GoogleGenAI {
  const apiKey = requireApiKey(provider);
  const { baseUrl, apiVersion } = getProviderGoogleSdkOptions(provider.baseUrl);
  assertDirectProviderUrl(baseUrl);

  return new GoogleGenAI({
    apiKey,
    httpOptions: { baseUrl, apiVersion },
  });
}

/**
 * 直连的模型列表请求头（与 /api/providers/models 服务端分支保持一致）
 */
export function getDirectProviderAuthHeaders(
  provider: ProviderRuntimeConfig,
  apiKey: string,
): Record<string, string> {
  if (isOpenAIProviderType(provider.type)) {
    return { Authorization: `Bearer ${apiKey}` };
  }

  if (isAnthropicProviderType(provider.type)) {
    return {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION_HEADER,
      [ANTHROPIC_BROWSER_HEADER]: "true",
    };
  }

  return { "x-goog-api-key": apiKey };
}

export { ANTHROPIC_BROWSER_HEADER };
