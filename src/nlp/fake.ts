import type { Embedder } from "../core/ports/embed";
import type { Nli, NliScores } from "../core/ports/nli";

export const ENTAILED: NliScores = { entailment: 0.97, neutral: 0.02, contradiction: 0.01 };
export const NEUTRAL: NliScores = { entailment: 0.05, neutral: 0.9, contradiction: 0.05 };
export const CONTRADICTED: NliScores = { entailment: 0.01, neutral: 0.04, contradiction: 0.95 };

export type FakeNliStep = NliScores | Error | ((premise: string, hypothesis: string) => NliScores);

/**
 * Scripted `Nli`. `step` is a fixed answer, an Error (the check fails), or a function. Every call is
 * recorded so tests can assert how a premise was windowed.
 */
export class FakeNli implements Nli {
  readonly calls: { premise: string; hypothesis: string }[] = [];

  constructor(
    private readonly step: FakeNliStep = ENTAILED,
    readonly maxTokens = 512,
    private readonly tokensPerWord = 1.3,
  ) {}

  countTokens(text: string): number {
    const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
    return Math.ceil(words * this.tokensPerWord);
  }

  async score(premise: string, hypothesis: string): Promise<NliScores> {
    this.calls.push({ premise, hypothesis });
    if (this.step instanceof Error) throw this.step;
    return typeof this.step === "function" ? this.step(premise, hypothesis) : this.step;
  }
}

/** Hashed bag-of-words vectors: similar wording gives a higher cosine. Deterministic, no model. */
export class FakeEmbedder implements Embedder {
  constructor(private readonly dims = 256) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array<number>(this.dims).fill(0);
      for (const w of t.toLowerCase().match(/\p{L}[\p{L}\p{N}]*/gu) ?? []) {
        let h = 2166136261;
        for (const ch of w) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
        const i = (h >>> 0) % this.dims;
        v[i] = (v[i] ?? 0) + 1;
      }
      const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
      return v.map((x) => x / norm);
    });
  }
}
