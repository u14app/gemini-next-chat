import type { Source } from "@/types";
import type { MarkdownGeneratedFile } from "@/lib/utils/markdownFiles";

export type MarkdownContentPolicy = "evidence-answer";
export type DiagramTheme = "light" | "dark";
export interface MarkdownImageSource {
  url: string;
  sourceUrl?: string;
  title?: string;
  description?: string;
}
export interface MarkdownRendererProps {
  content: string;
  className?: string;
  searchSources?: Source[];
  ragSources?: Source[];
  onCitationClick?: (source: Source, index: number) => void;
  onFileClick?: (file: MarkdownGeneratedFile) => void;
  isStreaming?: boolean;
  forcedTheme?: DiagramTheme;
  forceExpandCodeBlocks?: boolean;
  readOnly?: boolean;
  /** Evidence answers allow prose, GFM, math and literal code, without rich artifacts. */
  contentPolicy?: MarkdownContentPolicy;
  imageSources?: readonly MarkdownImageSource[];
  /** Exact manifest URLs; only same-origin share asset routes may bypass the remote image policy. */
  registeredImageUrls?: readonly string[];
  imageUrlAliases?: Readonly<Record<string, string>>;
}
