import type { Nli } from "../ports/nli";
import { err, ok, type Result } from "../ports/result";
import { splitSentences } from "../segment";

/** [CLS], two [SEP] and a little slack for tokenizer differences. */
const SPECIAL_TOKENS = 8;
/** Neighbouring pairs add little for long citations; skip them beyond this many sentences. */
const MAX_UNITS_FOR_PAIRS = 8;

/** One cited source sentence plus the heading it sits under (null when the heading is not source text). */
export interface PremiseUnit {
  text: string;
  section: number;
  heading: string | null;
}

export interface Entailment {
  /** Lowest entailment over the claim's sentences, each at its best-supporting view. */
  entailment: number;
  /** Highest contradiction seen over any sentence and view. */
  contradiction: number;
  /** Number of model calls made. */
  calls: number;
}

const stripEndPunctuation = (heading: string): string => heading.replace(/[.:;!?\s]+$/, "");

/**
 * Premise text for some units: consecutive units of one section share one "Heading: " prefix. The
 * heading is part of the approved notes (the generator and the judge both see it) and often carries
 * context a summary relies on, such as "Scheduling criteria" for a list of measures.
 */
export function composePremise(units: readonly PremiseUnit[]): string {
  const parts: string[] = [];
  let section: number | undefined;
  for (const u of units) {
    const prefix = u.section !== section && u.heading ? `${stripEndPunctuation(u.heading)}: ` : "";
    section = u.section;
    parts.push(`${prefix}${u.text}`);
  }
  return parts.join(" ");
}

/**
 * The different ways of presenting the cited evidence to the model, each within `budget` tokens:
 *  - everything together (or overlapping windows of consecutive sentences when that is too long),
 *    for claims that combine several sentences;
 *  - neighbouring pairs and every sentence on its own, because small entailment models can lose a
 *    claim that one sentence supports once other sentences are added to the premise.
 * If one cited sentence supports a claim, so does the whole set, so taking the best view is sound.
 * Returns null when a single sentence cannot fit (the caller must report that, never truncate).
 */
export function premiseViews(
  units: readonly PremiseUnit[],
  budget: number,
  count: (text: string) => number,
): string[] | null {
  const fits = (text: string): boolean => count(text) <= budget;
  const views = new Set<string>();

  const singles = units.map((u) => composePremise([u]));
  if (!singles.every(fits)) return null;

  const all = composePremise(units);
  if (fits(all)) {
    views.add(all);
  } else {
    let start = 0;
    while (start < units.length) {
      let end = start + 1; // a single unit fits (checked above)
      while (end < units.length && fits(composePremise(units.slice(start, end + 1)))) end++;
      views.add(composePremise(units.slice(start, end)));
      if (end >= units.length) break;
      start = Math.max(start + 1, end - 1); // overlap by one sentence
    }
  }

  if (units.length <= MAX_UNITS_FOR_PAIRS) {
    for (let i = 0; i + 1 < units.length; i++) {
      const pair = composePremise(units.slice(i, i + 2));
      if (fits(pair)) views.add(pair);
    }
  }
  for (const s of singles) views.add(s);
  return [...views];
}

/**
 * Check 2: does the cited text entail the claim? A multi-sentence claim is split and every sentence
 * must be supported, so the weakest one decides (MiniCheck-style); each is scored against every view
 * of the evidence and the best view counts (SummaC/AlignScore-style). Contradiction is the worst seen.
 * Failures come back as a message, not an exception.
 */
export async function scoreEntailment(
  nli: Nli,
  units: readonly PremiseUnit[],
  claim: string,
): Promise<Result<Entailment, string>> {
  const split = splitSentences(claim);
  const claims = split.length > 0 ? split : [claim];

  let entailment = 1;
  let contradiction = 0;
  let calls = 0;

  for (const sub of claims) {
    const budget = nli.maxTokens - nli.countTokens(sub) - SPECIAL_TOKENS;
    const views = premiseViews(units, budget, (t) => nli.countTokens(t));
    if (!views) {
      return err("The claim or one cited sentence is too long for the entailment model.");
    }

    let bestEntailment = 0;
    for (const view of views) {
      try {
        const s = await nli.score(view, sub);
        calls++;
        bestEntailment = Math.max(bestEntailment, s.entailment);
        contradiction = Math.max(contradiction, s.contradiction);
      } catch (e) {
        return err(`The entailment model failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    entailment = Math.min(entailment, bestEntailment);
  }
  return ok({ entailment, contradiction, calls });
}
