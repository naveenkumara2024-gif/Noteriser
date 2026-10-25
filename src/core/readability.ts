import { splitSentences } from "./segment";

const WORD = /\p{L}[\p{L}\p{N}'’]*/gu;

/**
 * English syllable estimate: vowel groups, minus a silent final "e". Rough (it is a heuristic, not a
 * dictionary), but consistent, which is what a before/after comparison needs.
 */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

export interface Readability {
  words: number;
  sentences: number;
  /** Words per sentence. */
  averageSentenceLength: number;
  /** Flesch-Kincaid grade level, never below 0. */
  grade: number;
}

/**
 * Flesch-Kincaid grade: 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59. Computed
 * locally, so it costs nothing and does not depend on a model. Empty text scores 0.
 */
export function readability(text: string): Readability {
  const words = text.match(WORD) ?? [];
  const sentences = Math.max(1, splitSentences(text).length);
  if (words.length === 0) return { words: 0, sentences: 0, averageSentenceLength: 0, grade: 0 };

  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  const grade = 0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59;
  return {
    words: words.length,
    sentences,
    averageSentenceLength: words.length / sentences,
    grade: Math.max(0, Math.round(grade * 10) / 10),
  };
}

export const gradeOf = (text: string): number => readability(text).grade;
