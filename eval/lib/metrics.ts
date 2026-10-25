import type { Verdict } from "../../src/core/schema/items";
import { type DecideInputs, decide, type Thresholds } from "../../src/core/verify";
import type { FailureType } from "./cases";

/** One verified draft, with everything needed to re-score it later. */
export interface DraftResult {
  id: string;
  caseId: string;
  split: string;
  type: "summary_point" | "glossary";
  label: "good" | "bad";
  failureType: FailureType | null;
  text: string;
  verdict: Verdict;
  reasons: string[];
  degraded: boolean;
  scores: {
    quoteFound: boolean;
    entailment: number | null;
    novelEntities: string[];
    overGeneral: string[];
    judge: string;
  };
  /** What `decide` was given; re-deciding from this is how thresholds are swept offline. */
  checks: DecideInputs;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

/** A rate with its 95% Wilson score interval, which is honest about small samples. */
export interface Rate {
  n: number;
  k: number;
  rate: number;
  lo: number;
  hi: number;
}

export function rate(k: number, n: number): Rate {
  if (n === 0) return { n, k, rate: 0, lo: 0, hi: 0 };
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { n, k, rate: p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

export interface TypeRecall {
  /** Caught = any verdict other than SUPPORTED. */
  caught: Rate;
  /** Caught as UNSUPPORTED or CONTRADICTED (not merely flagged PARTIAL). */
  hardCaught: Rate;
}

export interface Metrics {
  good: number;
  bad: number;
  /** Bad drafts the verifier did not pass as SUPPORTED. The lore's "verifier recall". */
  recall: Rate;
  /** Bad drafts rejected outright (UNSUPPORTED or CONTRADICTED); PARTIAL is not counted. */
  hardRecall: Rate;
  /** Good drafts that were not SUPPORTED (PARTIAL or worse). The lore's "over-flag rate". */
  overFlag: Rate;
  /** Good drafts rejected outright, a stricter kind of over-flagging. */
  overReject: Rate;
  /** Mean of recall and (1 - over-flag rate). */
  balancedAccuracy: number;
  /** Of the drafts the verifier lets through (SUPPORTED or PARTIAL), the share with a valid citation and quote. */
  citationValidity: Rate;
  /** Bad drafts that were let through as SUPPORTED: the harmful misses. */
  slipped: number;
  byType: Record<string, TypeRecall>;
}

const isRejected = (v: Verdict): boolean => v === "UNSUPPORTED" || v === "CONTRADICTED";

/** Metrics for results scored with `verdictOf` (the verdict each draft actually got, or one re-decided). */
export function computeMetrics(
  results: readonly DraftResult[],
  verdictOf: (r: DraftResult) => Verdict = (r) => r.verdict,
): Metrics {
  const good = results.filter((r) => r.label === "good");
  const bad = results.filter((r) => r.label === "bad");

  const caught = bad.filter((r) => verdictOf(r) !== "SUPPORTED").length;
  const hard = bad.filter((r) => isRejected(verdictOf(r))).length;
  const flagged = good.filter((r) => verdictOf(r) !== "SUPPORTED").length;
  const rejected = good.filter((r) => isRejected(verdictOf(r))).length;

  const shown = results.filter((r) => !isRejected(verdictOf(r)));
  const valid = shown.filter((r) => r.checks.quote.ok).length;

  const byType: Record<string, TypeRecall> = {};
  for (const r of bad) {
    if (!r.failureType) continue;
    byType[r.failureType] ??= { caught: rate(0, 0), hardCaught: rate(0, 0) };
    const slot = byType[r.failureType];
    if (!slot) continue;
    slot.caught.n++;
    slot.hardCaught.n++;
    if (verdictOf(r) !== "SUPPORTED") slot.caught.k++;
    if (isRejected(verdictOf(r))) slot.hardCaught.k++;
  }
  for (const slot of Object.values(byType)) {
    slot.caught = rate(slot.caught.k, slot.caught.n);
    slot.hardCaught = rate(slot.hardCaught.k, slot.hardCaught.n);
  }

  const recall = rate(caught, bad.length);
  const overFlag = rate(flagged, good.length);
  return {
    good: good.length,
    bad: bad.length,
    recall,
    hardRecall: rate(hard, bad.length),
    overFlag,
    overReject: rate(rejected, good.length),
    balancedAccuracy: (recall.rate + (1 - overFlag.rate)) / 2,
    citationValidity: rate(valid, shown.length),
    slipped: bad.length - caught,
    byType,
  };
}

/** The verdict these thresholds would give, from the stored check results (no model is called). */
export const redecide = (r: DraftResult, t: Thresholds): Verdict => decide(r.checks, t).verdict;

export const pct = (x: number, digits = 1): string => `${(x * 100).toFixed(digits)}%`;
export const fmtRate = (r: Rate): string =>
  r.n === 0 ? "n/a" : `${pct(r.rate)} (${r.k}/${r.n}; 95% CI ${pct(r.lo, 0)}-${pct(r.hi, 0)})`;

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}
