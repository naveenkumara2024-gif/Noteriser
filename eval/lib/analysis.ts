import { THRESHOLDS, type Thresholds } from "../../src/core/verify";
import type { DraftResult } from "./metrics";

export type Cause = "entailment" | "contradiction" | "judge" | "wording list" | "unseen words";

/** Which checks fired on a draft (several can). Read from the stored check results. */
export function causesOf(r: DraftResult, t: Thresholds = THRESHOLDS): Cause[] {
  const out: Cause[] = [];
  const nli = r.checks.nli;
  if (nli.status === "ok" && nli.entailment < t.entailmentSupported) out.push("entailment");
  if (nli.status === "ok" && nli.contradiction >= t.contradiction) out.push("contradiction");
  if (r.checks.judge.status === "ok" && r.checks.judge.outcome !== "pass") out.push("judge");
  if (r.checks.overGeneral.length > 0) out.push("wording list");
  if (r.checks.entities.soft.length >= t.softNovelPartial) out.push("unseen words");
  return out;
}

export interface OverFlagBreakdown {
  flagged: number;
  good: number;
  /** Flagged good drafts per cause (a draft can count under several). */
  byCause: Partial<Record<Cause, number>>;
  /** Flagged by exactly one cause, so fixing that cause alone would clear them. */
  onlyOne: number;
  /** How many good drafts would still be flagged if one cause were removed entirely. */
  remainingWithout: Partial<Record<Cause, number>>;
}

export function overFlagBreakdown(
  results: readonly DraftResult[],
  t: Thresholds = THRESHOLDS,
): OverFlagBreakdown {
  const good = results.filter((r) => r.label === "good");
  const flagged = good.filter((r) => r.verdict !== "SUPPORTED");
  const byCause: OverFlagBreakdown["byCause"] = {};
  let onlyOne = 0;
  for (const r of flagged) {
    const causes = causesOf(r, t);
    for (const c of causes) byCause[c] = (byCause[c] ?? 0) + 1;
    if (causes.length === 1) onlyOne++;
  }
  const remainingWithout: OverFlagBreakdown["remainingWithout"] = {};
  for (const drop of Object.keys(byCause) as Cause[]) {
    remainingWithout[drop] = flagged.filter((r) => {
      const others = causesOf(r, t).filter(
        (c) => c !== drop && !(drop === "entailment" && c === "contradiction"),
      );
      return others.length > 0;
    }).length;
  }
  return { flagged: flagged.length, good: good.length, byCause, onlyOne, remainingWithout };
}
