import Type from "typebox";

const Count = Type.Integer({ minimum: 0 });

/** Counts of items by outcome. Every generated item lands in exactly one bucket. */
export const OutcomeCounts = Type.Object({
  generated: Count,
  supported: Count,
  partial: Count,
  removed: Count,
  /** Interrupted runs only: generated but not yet judged. Always 0 for a complete run. */
  unreviewed: Count,
});
export type OutcomeCounts = Type.Static<typeof OutcomeCounts>;

/**
 * Lore §6.6, plus per-type counts and cost. `reconciles` must hold (invariant 3):
 * generated = supported + partial + removed + unreviewed.
 */
export const RunReport = Type.Object({
  sourceSentences: Count,
  sections: Count,
  generated: Count,
  supported: Count,
  partial: Count,
  removed: Count,
  unreviewed: Count,
  /** Removed items that were valid but not needed (extra questions beyond five, duplicates). */
  surplus: Count,
  byType: Type.Object({
    summary_point: OutcomeCounts,
    glossary: OutcomeCounts,
    question: OutcomeCounts,
  }),
  /** Share of sections that have at least one shown summary point. */
  coveragePercent: Type.Number({ minimum: 0, maximum: 100 }),
  repairsAttempted: Count,
  repairsSucceeded: Count,
  usage: Type.Object({
    inputTokens: Count,
    outputTokens: Count,
    costUsd: Type.Number({ minimum: 0 }),
  }),
  reconciles: Type.Boolean(),
});
export type RunReport = Type.Static<typeof RunReport>;
