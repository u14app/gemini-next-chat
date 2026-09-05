import type { ImageSource } from "@/lib/search/types";

/**
 * An image returned by an in-scope research search.
 *
 * Images are illustrative material. They deliberately live outside the
 * evidence and claim ledgers, while retaining the run that discovered them
 * for report version provenance.
 */
export interface ResearchImageSource extends ImageSource {
  id: string;
  retrievedAt: number;
  researchRunId: string;
}
