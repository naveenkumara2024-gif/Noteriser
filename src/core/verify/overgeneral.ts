/** Absolute, comparative and hedge words that quietly change how far a claim reaches (lore §8.2 #10). */
export const OVERGENERAL_LEXICON = [
  "always",
  "never",
  "all",
  "every",
  "most",
  "mostly",
  "only",
  "best",
  "worst",
  "typically",
  "usually",
  "generally",
  "commonly",
  "most commonly",
  "often",
  "widely",
  "universally",
  "impossible",
  "guarantees",
  "guaranteed",
  "inevitably",
  "necessarily",
  "entirely",
  "completely",
  "in practice",
] as const;

const wordRegex = (word: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu");

const PATTERNS = OVERGENERAL_LEXICON.map((w) => [w, wordRegex(w)] as const);

/**
 * Check 5 (deterministic): lexicon words the claim uses but the cited text does not. A word the
 * source itself uses ("only", "all") is the source's claim, not an embellishment.
 */
export function findOverGeneral(claim: string, citedText: string): string[] {
  const found: string[] = [];
  for (const [word, pattern] of PATTERNS) {
    if (pattern.test(claim) && !pattern.test(citedText)) found.push(word);
  }
  // "most commonly" also contains "most"; report the longest match only.
  return found.filter((w) => !found.some((other) => other !== w && other.includes(w)));
}
