import type { DraftItem } from "../generate/types";

export interface Claim {
  /** The one proposition the verifier checks: what the item asserts. */
  text: string;
  /** The sentences that must support it. */
  citedIds: string[];
}

/**
 * "The component that..." / "Forcibly taking..." -> "the component..." / "forcibly taking...", so a
 * definition reads naturally after "X is". Acronyms and mixed-case words ("RR", "CPU", "iPhone") are
 * kept. Lowercasing an ordinary capitalised word is the safe direction: left capitalised, the entity
 * scan would mistake it for a proper noun and reject a valid definition.
 */
export function lowerFirst(text: string): string {
  return /^\p{Lu}\p{Ll}/u.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/**
 * What to verify for each kind of item.
 *  - summary point: its text.
 *  - glossary entry: "<term> is <definition>", because a bare noun phrase is not a proposition and
 *    entailment models score propositions.
 *  - question: the answer statement (never the question), supported by the answer's own sentences.
 */
export function claimOf(item: DraftItem): Claim {
  switch (item.type) {
    case "summary_point":
      return { text: item.text, citedIds: item.sourceIds };
    case "glossary":
      return { text: `${item.term} is ${lowerFirst(item.text)}`, citedIds: item.sourceIds };
    case "question":
      return {
        text: item.answerStatement,
        citedIds: item.answerSourceIds.length > 0 ? item.answerSourceIds : item.sourceIds,
      };
  }
}
