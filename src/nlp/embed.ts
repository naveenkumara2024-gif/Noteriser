import { resolve } from "node:path";
import { env as hfEnv, pipeline } from "@huggingface/transformers";
import type { Embedder } from "../core/ports/embed";

export const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";

type Extractor = Awaited<ReturnType<typeof pipeline<"feature-extraction">>>;

/** MiniLM sentence embeddings, mean-pooled and L2-normalised. Used only to explain, never to judge. */
export class HfEmbedder implements Embedder {
  private constructor(private readonly extractor: Extractor) {}

  static async load(options: { cacheDir?: string } = {}): Promise<HfEmbedder> {
    // The cache folder is a runtime path, not something to bundle: keep Turbopack from tracing the project for it.
    hfEnv.cacheDir = resolve(/* turbopackIgnore: true */ options.cacheDir ?? ".cache/models");
    // NOTERISER_OFFLINE=1 (set in the Docker image) forbids any download: the models must already be on disk.
    hfEnv.allowRemoteModels = process.env.NOTERISER_OFFLINE !== "1";
    const extractor = await pipeline("feature-extraction", EMBED_MODEL, { dtype: "q8" });
    return new HfEmbedder(extractor);
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const tensor = await this.extractor(texts, { pooling: "mean", normalize: true });
    return tensor.tolist() as number[][];
  }
}
