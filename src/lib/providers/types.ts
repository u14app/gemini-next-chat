import type { LocalEncryptedSecretEnvelope } from "../security/localSecrets";

export type ProviderType =
  "OpenAI Compatible" | "OpenAI" | "Anthropic" | "Google";

export interface ModelProvider {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  apiKeySecret?: LocalEncryptedSecretEnvelope;
  enabled: boolean;
  models: string[];
  modelsList?: string[];
  isServerDefault?: boolean;
  /** 由浏览器直接请求该 provider，不经服务端代理 */
  directCall?: boolean;
}

export interface ModelMetadata {
  id: string;
  name: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  temperature?: boolean;
  knowledge?: string;
  release_date?: string;
  last_updated?: string;
  modalities?: {
    input?: string[];
    output?: string[];
  };
  structured_output?: boolean;
  open_weights?: boolean;
  reasoning_options?: Array<{
    type: "effort";
    values: Array<"low" | "medium" | "high">;
  }>;
  cost?: {
    input: number;
    output: number;
    cache_read?: number;
    cache_write?: number;
    reasoning?: number;
    input_audio?: number;
    output_audio?: number;
  };
  limit?: {
    context?: number;
    output?: number;
  };
}
