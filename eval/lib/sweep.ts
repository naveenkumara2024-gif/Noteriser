import { THRESHOLDS, type Thresholds } from "../../src/core/verify";
import { computeMetrics, type DraftResult, type Metrics, redecide } from "./metrics";

/** Coarse on purpose: a fine grid on ~70 drafts would only fit noise. */
export const GRID = {
  entailmentSupported: [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.97, 0.99],
  entailmentPartial: [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
  contradiction: [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95],
  /** 99 means "never downgrade for unseen ordinary words". */
  softNovelPartial: [1, 2, 3, 4, 5, 6, 99],
} as const;

export interface Candidate {
  thresholds: Thresholds;
  metrics: Metrics;
  /** Normalised distance from the current thresholds; smaller means a smaller change. */
  distance: number;
}

export interface SweepResult {
  gridSize: number;
  feasible: number;
  maxOverFlag: number;
  current: Candidate;
  /** The chosen point, or null when nothing meets the over-flag limit. */
  best: Candidate | null;
  /**
   * For information when `best` is null: the grid point with the lowest over-flag rate among those
   * that still catch at least 90% of bad drafts. It is not a recommendation.
   */
  lowestOverFlag: Candidate | null;
  top: Candidate[];
  /** The chosen point with each threshold moved one grid step either way. */
  neighbours: { change: string; candidate: Candidate }[];
}

function distance(t: Thresholds): number {
  return (
    Math.abs(t.entailmentSupported - THRESHOLDS.entailmentSupported) / 0.5 +
    Math.abs(t.entailmentPartial - THRESHOLDS.entailmentPartial) / 0.7 +
    Math.abs(t.contradiction - THRESHOLDS.contradiction) / 0.65 +
    Math.abs(Math.min(t.softNovelPartial, 7) - Math.min(THRESHOLDS.softNovelPartial, 7)) / 6
  );
}

const score = (results: readonly DraftResult[], t: Thresholds): Candidate => ({
  thresholds: t,
  metrics: computeMetrics(results, (r) => redecide(r, t)),
  distance: distance(t),
});

/**
 * Chooses thresholds on one split: maximise recall (bad drafts not SUPPORTED) subject to an
 * over-flag rate of at most `maxOverFlag`. Ties go to the higher balanced accuracy, then the
 * higher rate of outright rejection, then the smaller change from today. It reads stored check
 * results only; no model is called, and no other split is looked at.
 */
export function runSweep(
  results: readonly DraftResult[],
  options: { maxOverFlag?: number; current?: Thresholds } = {},
): SweepResult {
  const maxOverFlag = options.maxOverFlag ?? 0.15;
  const current = score(results, options.current ?? THRESHOLDS);

  const all: Candidate[] = [];
  for (const entailmentSupported of GRID.entailmentSupported) {
    for (const entailmentPartial of GRID.entailmentPartial) {
      if (entailmentPartial >= entailmentSupported) continue;
      for (const contradiction of GRID.contradiction) {
        for (const softNovelPartial of GRID.softNovelPartial) {
          all.push(
            score(results, {
              entailmentSupported,
              entailmentPartial,
              contradiction,
              softNovelPartial,
            }),
          );
        }
      }
    }
  }

  const feasible = all.filter((c) => c.metrics.overFlag.rate <= maxOverFlag);
  const ranked = [...feasible].sort(
    (a, b) =>
      b.metrics.recall.rate - a.metrics.recall.rate ||
      b.metrics.balancedAccuracy - a.metrics.balancedAccuracy ||
      b.metrics.hardRecall.rate - a.metrics.hardRecall.rate ||
      a.distance - b.distance,
  );
  const best = ranked[0] ?? null;
  const lowestOverFlag =
    [...all]
      .filter((c) => c.metrics.recall.rate >= 0.9)
      .sort(
        (a, b) =>
          a.metrics.overFlag.rate - b.metrics.overFlag.rate ||
          b.metrics.recall.rate - a.metrics.recall.rate ||
          a.distance - b.distance,
      )[0] ?? null;

  const neighbours: SweepResult["neighbours"] = [];
  if (best) {
    for (const key of Object.keys(GRID) as (keyof Thresholds)[]) {
      const values = GRID[key] as readonly number[];
      const at = values.indexOf(best.thresholds[key]);
      for (const step of [-1, 1]) {
        const next = values[at + step];
        if (next === undefined) continue;
        const t = { ...best.thresholds, [key]: next };
        if (t.entailmentPartial >= t.entailmentSupported) continue;
        neighbours.push({
          change: `${key} ${best.thresholds[key]} -> ${next}`,
          candidate: score(results, t),
        });
      }
    }
  }

  return {
    gridSize: all.length,
    lowestOverFlag,
    feasible: feasible.length,
    maxOverFlag,
    current,
    best,
    top: ranked.slice(0, 10),
    neighbours,
  };
}

export function diffThresholds(from: Thresholds, to: Thresholds): string {
  return (Object.keys(from) as (keyof Thresholds)[])
    .map((k) =>
      from[k] === to[k] ? `  ${k}: ${from[k]} (unchanged)` : `- ${k}: ${from[k]}\n+ ${k}: ${to[k]}`,
    )
    .join("\n");
}
