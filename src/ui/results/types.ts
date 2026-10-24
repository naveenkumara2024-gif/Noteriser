import type { SourceSentence } from "@/core/schema/source";

/** Which item's sources are being looked at. Drives the highlight in the Source column and the narrow-screen disclosure. */
export interface Selection {
  itemId: string;
  ids: readonly string[];
}

export type Select = (selection: Selection | null) => void;
export type SentenceIndex = ReadonlyMap<string, SourceSentence>;
