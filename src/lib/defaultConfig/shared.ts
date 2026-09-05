import type {
  DefaultModels,
  DocumentParseProvider,
  ModelMetadata,
  ProviderType,
  ServerDefaultVoiceProvider,
  SystemSettings,
  VoiceSettings,
} from "@/types";

export const SERVER_DEFAULT_PROVIDER_ID = "SERVER_DEFAULT";
export const SERVER_DEFAULT_SEARCH_PROVIDER_ID = "default";

export type ServerDefaultProviderSource = "server-default";
export type PublicDeploymentStoreState = "memory" | "shared" | "missing";

export interface PublicServerConfig {
  sharing?: { available: boolean };
  modelProvider: {
    available: boolean;
    id: typeof SERVER_DEFAULT_PROVIDER_ID;
    name: string;
    type: ProviderType;
    models: string[];
    modelMetadata: Record<string, ModelMetadata>;
    defaultModels: Partial<DefaultModels>;
  };
  search: {
    available: boolean;
  };
  rag: {
    vectorStoreAvailable: boolean;
    documentProcessingAvailable: boolean;
    documentProcessingProvider?: DocumentParseProvider;
    topK?: number;
    chunkSize?: number;
    namespace?: string;
  };
  voice: {
    defaultProvider?: ServerDefaultVoiceProvider;
    elevenLabsAvailable: boolean;
    mimoAvailable: boolean;
    defaultSttAvailable: boolean;
    defaultTtsAvailable: boolean;
    sttModel?: string;
    ttsModel?: string;
    ttsVoiceId?: VoiceSettings["ttsVoiceId"];
    mimoSttModel?: string;
    mimoTtsModel?: string;
    mimoTtsVoiceId?: VoiceSettings["mimoTtsVoiceId"];
  };
  deployment?: {
    mode: "local" | "hosted";
    accessPasswordEnabled: boolean;
    trustedProxyHeaders: boolean;
    byokStableKeyConfigured: boolean;
    byokEphemeralAllowed: boolean;
    apiProof: {
      required: boolean;
      enabled: boolean;
      configured: boolean;
      protectedHighCostApis: boolean;
      windowSeconds: number;
      sessionTtlSeconds: number;
    };
    rateLimitStore: PublicDeploymentStoreState;
    documentParseJobStore: PublicDeploymentStoreState;
    pluginRegistryStore: PublicDeploymentStoreState;
  };
  limits: {
    attachments: {
      maxFileBytes: number;
    };
  };
  system?: SystemSettings;
}
