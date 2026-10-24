/**
 * Sentence embeddings. Vectors must be L2-normalised so that a dot product is the cosine similarity.
 * Used only to point at the closest source sentence in explanations; never to grant a verdict.
 */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}
