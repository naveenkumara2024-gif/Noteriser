/**
 * Every number the verdict depends on lives here and nowhere else. Initial values follow lore §3.4;
 * Stage 8 tunes them on the dev split only. Do not adjust them to make a particular example pass.
 */
export interface Thresholds {
  /** Entailment at or above this counts as supported. */
  entailmentSupported: number;
  /** Below this the claim is neutral to its source: unsupported. Between the two: partial. */
  entailmentPartial: number;
  /** Contradiction probability at or above this removes the item and it is never repaired. */
  contradiction: number;
  /** This many unseen ordinary words in a claim downgrade SUPPORTED to PARTIAL (paraphrase is normal). */
  softNovelPartial: number;
}

export const THRESHOLDS: Thresholds = {
  entailmentSupported: 0.85,
  entailmentPartial: 0.5,
  contradiction: 0.5,
  softNovelPartial: 3,
};
