import type { Embedder } from "../ports/embed";
import type { SourceDoc } from "../schema/source";

export interface SourceIndex {
  ids: string[];
  vectors: number[][];
}

export interface Match {
  id: string;
  similarity: number;
}

/** Embed every source sentence once per document. */
export async function buildSourceIndex(embedder: Embedder, doc: SourceDoc): Promise<SourceIndex> {
  const vectors = await embedder.embed(doc.sentences.map((s) => s.text));
  return { ids: doc.sentences.map((s) => s.id), vectors };
}

const dot = (a: number[], b: number[]): number => a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0);

/**
 * The `k` source sentences most similar to `text`, best first. Only ever used to explain a flag
 * ("closest is S3.4, not the cited S3.2"): a high similarity never makes anything SUPPORTED.
 */
export async function closestSentences(
  index: SourceIndex,
  embedder: Embedder,
  text: string,
  k = 3,
): Promise<Match[]> {
  const [query] = await embedder.embed([text]);
  if (!query) return [];
  return index.vectors
    .map((v, i) => ({ id: index.ids[i] ?? "", similarity: dot(query, v) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}

/**
 * A hint when a better-matching sentence than any cited one exists (the model probably cited the
 * wrong sentence). Returns null when the citation looks reasonable.
 */
export function citationHint(matches: Match[], citedIds: readonly string[]): string | null {
  const best = matches[0];
  if (!best || citedIds.includes(best.id)) return null;
  const bestCited = Math.max(
    0,
    ...matches.filter((m) => citedIds.includes(m.id)).map((m) => m.similarity),
  );
  return best.similarity - bestCited >= 0.05
    ? `The closest sentence in the notes is ${best.id}, not the cited ${citedIds.join(", ")}.`
    : null;
}
