import type { JudgeOutcome, Verdict } from "../schema/items";
import { THRESHOLDS, type Thresholds } from "./thresholds";

export interface DecideInputs {
  /** Check 1. */
  quote: { ok: boolean; reason: string | null };
  /** Check 2. `failed` means it should have run and could not (degraded); `skipped` means it was not needed. */
  nli:
    | { status: "ok"; entailment: number; contradiction: number }
    | { status: "failed"; reason: string }
    | { status: "skipped" };
  /** Check 3. */
  entities: { hard: string[]; soft: string[] };
  /** Wording the claim adds beyond the cited text. */
  overGeneral: string[];
  /** Check 4. */
  judge:
    | { status: "ok"; outcome: Exclude<JudgeOutcome, "not_run">; unsupportedParts: string[] }
    | { status: "failed"; reason: string }
    | { status: "skipped" };
  /** Multiple-choice options that were meant to be wrong. */
  distractors: { ambiguous: string[]; novel: string[] };
}

export interface Decision {
  verdict: Verdict;
  /** Plain-language findings, most important first. Empty for SUPPORTED. */
  reasons: string[];
  /** A check that should have run did not: the run must show a "verifier degraded" notice. */
  degraded: boolean;
}

/** The entailment model says the notes contradict the claim. Such items are removed, never repaired. */
export function isContradicted(nli: DecideInputs["nli"], t: Thresholds = THRESHOLDS): boolean {
  return (
    nli.status === "ok" &&
    nli.contradiction >= t.contradiction &&
    nli.contradiction > nli.entailment
  );
}

const f = (n: number): string => n.toFixed(2);
const quoted = (xs: string[]): string => xs.map((x) => `"${x}"`).join(", ");

/**
 * Lore §3.4 as code, as a pure function of the check results.
 *
 *   CONTRADICTED  the entailment model says the notes contradict the claim (never repaired)
 *   UNSUPPORTED   no usable citation/quote, an invented number or name, a neutral entailment, an
 *                 ambiguous multiple-choice question, or (an extension, not in the lore) a second
 *                 reviewer saying the notes say the opposite
 *   PARTIAL       moderate entailment, a reviewer's objection to part of the claim, several unseen
 *                 words, extra wording, or any check that did not run
 *   SUPPORTED     every check ran and passed
 *
 * Invariant 1: SUPPORTED requires all checks to have actually run. A check that is not `ok` can never
 * be ignored; at best it caps the verdict at PARTIAL.
 */
export function decide(inputs: DecideInputs, t: Thresholds = THRESHOLDS): Decision {
  const blockers: string[] = [];
  const cautions: string[] = [];
  let degraded = false;

  const { quote, nli, entities, judge, distractors } = inputs;

  const contradicted = isContradicted(nli, t);

  // Check 1
  if (!quote.ok)
    blockers.push(quote.reason ?? "The quote could not be matched to the cited sentences.");

  // Check 3
  if (entities.hard.length > 0) {
    blockers.push(`Mentions ${quoted(entities.hard)}, which the notes never state.`);
  }

  // Check 2
  if (nli.status === "ok") {
    if (nli.entailment < t.entailmentPartial) {
      blockers.push(`The cited text does not support this (entailment ${f(nli.entailment)}).`);
    } else if (nli.entailment < t.entailmentSupported) {
      cautions.push(`Only partly supported by the cited text (entailment ${f(nli.entailment)}).`);
    }
    // Long premises are scored in windows, so one window can support a claim while another
    // contradicts it. Conflicting evidence is never a clean SUPPORTED.
    if (!contradicted && nli.contradiction >= t.contradiction) {
      cautions.push(
        `Part of the cited text may contradict this (contradiction ${f(nli.contradiction)}).`,
      );
    }
  } else if (nli.status === "failed") {
    degraded = true;
    cautions.push(`Verifier degraded: the entailment check did not run (${nli.reason}).`);
  }

  // Check 4
  if (judge.status === "ok") {
    const parts = judge.unsupportedParts.length > 0 ? `: ${judge.unsupportedParts.join("; ")}` : "";
    if (judge.outcome === "contradiction") {
      blockers.push(`A second reviewer found the notes say the opposite of part of this${parts}.`);
    } else if (judge.outcome === "fail") {
      cautions.push(`A second reviewer found parts the notes do not support${parts}.`);
    }
  } else if (judge.status === "failed") {
    degraded = true;
    cautions.push(`Verifier degraded: the second review did not run (${judge.reason}).`);
  }

  // Wording
  if (entities.soft.length >= t.softNovelPartial) {
    cautions.push(`Uses words the notes never use: ${quoted(entities.soft)}.`);
  }
  if (inputs.overGeneral.length > 0) {
    cautions.push(`Adds wording the cited text does not use: ${quoted(inputs.overGeneral)}.`);
  }

  // Multiple choice
  if (distractors.ambiguous.length > 0) {
    blockers.push(
      `These options were meant to be wrong but the notes could support them: ${quoted(distractors.ambiguous)}.`,
    );
  }
  if (distractors.novel.length > 0) {
    cautions.push(`Wrong options introduce facts not in the notes: ${quoted(distractors.novel)}.`);
  }

  // A check that was skipped is only acceptable when something already settled the verdict.
  const settled = contradicted || blockers.length > 0;
  if (!settled) {
    if (nli.status === "skipped") cautions.push("The entailment check did not run.");
    if (judge.status === "skipped") cautions.push("The second review did not run.");
  }

  if (contradicted && nli.status === "ok") {
    return {
      verdict: "CONTRADICTED",
      reasons: [
        `The notes say the opposite (contradiction ${f(nli.contradiction)}).`,
        ...blockers,
        ...cautions,
      ],
      degraded,
    };
  }
  if (blockers.length > 0) {
    return { verdict: "UNSUPPORTED", reasons: [...blockers, ...cautions], degraded };
  }
  if (cautions.length > 0) return { verdict: "PARTIAL", reasons: cautions, degraded };
  return { verdict: "SUPPORTED", reasons: [], degraded };
}
