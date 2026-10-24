import { resolve } from "node:path";
import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  env as hfEnv,
} from "@huggingface/transformers";
import type { Nli, NliScores } from "../core/ports/nli";

export const NLI_MODEL = "Xenova/nli-deberta-v3-small";
const MAX_TOKENS = 512;

export interface HfNliOptions {
  model?: string;
  /** Weights variant. `int8` is about 160 MB for the small model; the default keeps downloads modest. */
  dtype?: "int8" | "q8" | "fp16" | "fp32";
  /** Where downloaded models are cached. Default `<cwd>/.cache/models` (gitignored). */
  cacheDir?: string;
  onProgress?: (info: { file?: string; progress?: number; status?: string }) => void;
}

type Tokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
type Model = Awaited<ReturnType<typeof AutoModelForSequenceClassification.from_pretrained>>;

/**
 * DeBERTa-v3 NLI through Transformers.js (onnxruntime-node). Labels are read from the model config,
 * never assumed: this model's order is contradiction, entailment, neutral.
 */
export class HfNli implements Nli {
  readonly maxTokens = MAX_TOKENS;
  private readonly indexOf: { entailment: number; neutral: number; contradiction: number };

  private constructor(
    private readonly tokenizer: Tokenizer,
    private readonly model: Model,
  ) {
    const labels = (model.config as { id2label?: Record<string, string> }).id2label ?? {};
    const find = (name: string): number => {
      const hit = Object.entries(labels).find(([, l]) => l.toLowerCase() === name);
      if (!hit)
        throw new Error(`NLI model has no "${name}" label (labels: ${JSON.stringify(labels)})`);
      return Number(hit[0]);
    };
    this.indexOf = {
      entailment: find("entailment"),
      neutral: find("neutral"),
      contradiction: find("contradiction"),
    };
  }

  /** Downloads the model on first use (cached afterwards). Reuse the instance: loading is slow. */
  static async load(options: HfNliOptions = {}): Promise<HfNli> {
    hfEnv.cacheDir = resolve(options.cacheDir ?? ".cache/models");
    const id = options.model ?? NLI_MODEL;
    const progress_callback = options.onProgress;
    const tokenizer = await AutoTokenizer.from_pretrained(id, { progress_callback });
    const model = await AutoModelForSequenceClassification.from_pretrained(id, {
      dtype: options.dtype ?? "int8",
      progress_callback,
    });
    return new HfNli(tokenizer, model);
  }

  countTokens(text: string): number {
    return this.tokenizer.encode(text).length;
  }

  async score(premise: string, hypothesis: string): Promise<NliScores> {
    // No truncation: silently cutting evidence would let an unsupported claim look supported.
    const inputs = await this.tokenizer(premise, {
      text_pair: hypothesis,
      padding: false,
      truncation: false,
    });
    const length = (inputs.input_ids as { dims: number[] }).dims.at(-1) ?? 0;
    if (length > MAX_TOKENS) {
      throw new Error(`pair needs ${length} tokens, the model accepts ${MAX_TOKENS}`);
    }

    const out = (await this.model(inputs)) as { logits: { data: Float32Array } };
    const logits = Array.from(out.logits.data);
    const max = Math.max(...logits);
    const exp = logits.map((l) => Math.exp(l - max));
    const sum = exp.reduce((a, b) => a + b, 0);
    const p = (i: number): number => (exp[i] ?? 0) / sum;
    return {
      entailment: p(this.indexOf.entailment),
      neutral: p(this.indexOf.neutral),
      contradiction: p(this.indexOf.contradiction),
    };
  }
}
