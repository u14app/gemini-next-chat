import type { ResearchSourceProvider } from "./catalog";

export interface ResearchSourceDocument {
  id: string;
  url: string;
  title: string;
  content: string;
  publishedAt?: string;
  authors?: string[];
  coverage: "abstract_and_metadata" | "metadata_only" | "filing_text";
  truncated: boolean;
  missing: string[];
}
export interface ResearchSourceResult {
  provider: ResearchSourceProvider;
  operation: "search" | "read";
  documents: ResearchSourceDocument[];
  coverageNote?: string;
}
export class ResearchSourceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ResearchSourceError";
  }
}
