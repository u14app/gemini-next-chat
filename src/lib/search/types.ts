import type { LocalEncryptedSecretEnvelope } from "../security/localSecrets";

export interface Source {
  title: string;
  url: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export type CitationSourceKind = "web" | "knowledge";

export interface CitationSource extends Source {
  id: string;
  kind: CitationSourceKind;
  collectionId?: string;
  fileId?: string;
  chunkIndex?: number;
  retrieval?: "vector" | "keyword" | "both";
}

export interface ImageSource {
  url: string;
  description?: string;
}

export type SearchProviderID =
  "default" | "google" | "tavily" | "firecrawl" | "exa" | "bocha" | "searxng" | "youcom";

export type SearchTimeRange = "any" | "day" | "week" | "month" | "year";

export interface SearchServiceConfig {
  apiKey?: string;
  apiKeySecret?: LocalEncryptedSecretEnvelope;
  baseUrl?: string;
  serverAvailable?: boolean;
}
