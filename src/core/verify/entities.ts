import { splitSentences } from "../segment";
import { normalizeForMatch } from "../text";

/** What the notes contain, prepared once per document and reused for every item. */
export interface SourceVocab {
  /** All notes text, normalised. */
  text: string;
  /** Lowercased words. */
  tokens: ReadonlySet<string>;
  /** Crude word stems, so "selects" matches "selecting". */
  stems: ReadonlySet<string>;
  /** Numbers with thousands separators removed ("3,500" -> "3500"). */
  numbers: ReadonlySet<string>;
  /** Initials of 2-5 consecutive words ("operating system" -> "os"), which make an acronym legitimate. */
  initialisms: ReadonlySet<string>;
}

export interface NovelEntities {
  /** Numbers, formulas, proper nouns and acronyms absent from the notes: forces UNSUPPORTED. */
  hard: string[];
  /** Ordinary content words absent from the notes: only a weak signal on their own. */
  soft: string[];
}

const WORD = /\p{L}[\p{L}\p{N}'’]*/gu;
const NUMBER = /\d+(?:[.,]\d+)*/g;
const FORMULA = /\b[A-Za-z]\([^()]{1,30}\)/g;
const ACRONYM = /^[A-Z]{2,}s?$/;
const MAX_INITIALISM_WORDS = 5;

/** Common function and filler words that are never "technical terms". */
const STOP = new Set(
  (
    "about above after again against also among another because been before being below between both " +
    "cannot come could does doing done down during each either else even ever every from further give gives " +
    "given have having here hers into itself just keep known less like made make makes many might more most " +
    "much must never nor only onto other ours ourselves over same shall should since some such than that " +
    "their theirs them themselves then there these they this those through thus under until upon using uses " +
    "used very want wants well were what when where whether which while whom whose will with within without " +
    "would your yours yourself also called based include includes included including help helps allow allows " +
    "different various several certain particular specific general whole part parts one two three four five " +
    "first second third next last new old way ways time times thing things case cases"
  ).split(" "),
);

const tokenOf = (raw: string): string => raw.toLowerCase().replace(/['’]s$/, "");

/** "selects", "selected", "selection" -> "select". Deliberately crude; recall matters more than precision here. */
export function stem(word: string): string {
  let s = word;
  for (const suffix of [
    "ations",
    "ation",
    "ings",
    "ing",
    "ers",
    "er",
    "ions",
    "ion",
    "ed",
    "es",
    "ly",
    "s",
  ]) {
    if (s.length - suffix.length >= 4 && s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length);
      break;
    }
  }
  return s.slice(0, 6);
}

const normaliseNumber = (n: string): string => n.replace(/,/g, "");

export function buildVocab(sentences: readonly { text: string }[]): SourceVocab {
  const tokens = new Set<string>();
  const stems = new Set<string>();
  const numbers = new Set<string>();
  const initialisms = new Set<string>();

  for (const { text } of sentences) {
    const words = [...text.matchAll(WORD)].map((m) => tokenOf(m[0]));
    for (const w of words) {
      tokens.add(w);
      stems.add(stem(w));
    }
    for (let i = 0; i < words.length; i++) {
      let initials = "";
      for (let j = i; j < Math.min(words.length, i + MAX_INITIALISM_WORDS); j++) {
        initials += words[j]?.[0] ?? "";
        if (j > i) initialisms.add(initials);
      }
    }
    for (const m of text.matchAll(NUMBER)) numbers.add(normaliseNumber(m[0]));
  }

  return {
    text: normalizeForMatch(sentences.map((s) => s.text).join(" ")),
    tokens,
    stems,
    numbers,
    initialisms,
  };
}

/**
 * Check 3 (deterministic): things the claim says that the notes never mention. A paraphrase may
 * choose different ordinary words (soft), but a number, formula, name or acronym with no source is
 * an invented fact (hard).
 *
 * Sentence-initial capitals are not treated as names (every sentence starts with one); an unseen
 * sentence-initial word still counts as a soft novelty if it is an ordinary word.
 */
export function findNovelEntities(claim: string, vocab: SourceVocab): NovelEntities {
  const hard = new Set<string>();
  const soft = new Set<string>();
  const known = (w: string): boolean => vocab.tokens.has(w) || vocab.stems.has(stem(w));

  for (const m of claim.matchAll(FORMULA)) {
    if (!vocab.text.includes(normalizeForMatch(m[0]))) hard.add(m[0]);
  }
  for (const m of claim.matchAll(NUMBER)) {
    if (!vocab.numbers.has(normaliseNumber(m[0]))) hard.add(m[0]);
  }

  for (const sentence of splitSentences(claim).length > 0 ? splitSentences(claim) : [claim]) {
    const words = [...sentence.matchAll(WORD)];
    for (const [i, m] of words.entries()) {
      const raw = m[0];
      const lower = tokenOf(raw);
      if (lower.length < 2) continue; // "I", "O" (as in O(n)), list letters

      if (ACRONYM.test(raw)) {
        // Only a lowercase plural "s" is dropped ("CPUs"); the S of "OS" is part of the acronym.
        const bare = raw.endsWith("s") ? lower.slice(0, -1) : lower;
        const seen = (a: string): boolean => vocab.tokens.has(a) || vocab.initialisms.has(a);
        if (!seen(lower) && !seen(bare)) hard.add(raw);
        continue;
      }
      if (i > 0 && /^\p{Lu}/u.test(raw)) {
        if (!STOP.has(lower) && !known(lower)) hard.add(raw);
        continue;
      }
      if (lower.length >= 4 && !STOP.has(lower) && !known(lower)) soft.add(lower);
    }
  }
  return { hard: [...hard], soft: [...soft] };
}
