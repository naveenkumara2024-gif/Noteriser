/** Probabilities for one (premise, hypothesis) pair; they sum to about 1. */
export interface NliScores {
  entailment: number;
  neutral: number;
  contradiction: number;
}

/**
 * Natural-language-inference model: does the premise support the hypothesis? Implementations may be
 * slow to start, so callers should reuse one instance.
 */
export interface Nli {
  /** Tokens a (premise, hypothesis) pair may use, special tokens included. */
  readonly maxTokens: number;
  /** Token count of `text` as this model's tokenizer sees it (an estimate is acceptable in fakes). */
  countTokens(text: string): number;
  /** Rejects if the pair does not fit or the model fails; callers treat that as "check did not run". */
  score(premise: string, hypothesis: string): Promise<NliScores>;
}
