import type { SourceSentence } from "../schema/source";
import { normalizeForMatch } from "../text";

export interface QuoteCheck {
  ok: boolean;
  /** Cited ids that are not in the notes. */
  missingIds: string[];
  /** Why it failed, written for the person reading the flag; null when ok. */
  reason: string | null;
}

const WORD = /[\p{L}\p{N}]+/gu;
const MIN_QUOTE_WORDS = 2;

const WRAPPERS: [string, string][] = [
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"],
  ["«", "»"],
];

/** Removes ONE pair of quote marks that wraps the whole string; otherwise returns it unchanged. */
export function unwrapQuotes(quote: string): string {
  const q = quote.trim();
  for (const [open, close] of WRAPPERS) {
    if (q.length >= 2 && q.startsWith(open) && q.endsWith(close)) return q.slice(1, -1).trim();
  }
  return q;
}

/** Consecutive cited sentences of one section form a run: the only places a quote may span. */
function runsOf(cited: SourceSentence[]): SourceSentence[][] {
  const runs: SourceSentence[][] = [];
  for (const s of cited) {
    const run = runs.at(-1);
    const prev = run?.at(-1);
    if (run && prev && s.section === prev.section && s.position === prev.position + 1) run.push(s);
    else runs.push([s]);
  }
  return runs;
}

/**
 * Check 1 (deterministic): every cited id exists, and the quote is an unbroken passage of the cited
 * text. It may cross from one cited sentence into the next only if they are neighbours in the notes;
 * a quote stitched across a gap (S1.1 + S1.4) is a splice, not a quote, and fails.
 *
 * The plain form is tried first, then the form with one pair of outer quote marks removed, because
 * `normalizeForMatch` keeps quote marks (a source sentence may itself begin with one).
 */
export function quoteExists(
  quote: string,
  sentences: readonly SourceSentence[],
  sourceIds: readonly string[],
): QuoteCheck {
  const byId = new Map(sentences.map((s) => [s.id, s]));
  const ids = [...new Set(sourceIds)];

  if (ids.length === 0) {
    return { ok: false, missingIds: [], reason: "No source sentence is cited." };
  }
  const missingIds = ids.filter((id) => !byId.has(id));
  if (missingIds.length > 0) {
    return {
      ok: false,
      missingIds,
      reason: `Cites ${missingIds.join(", ")}, which ${missingIds.length === 1 ? "is" : "are"} not in the notes.`,
    };
  }

  const wanted = [normalizeForMatch(quote)];
  const unwrapped = normalizeForMatch(unwrapQuotes(quote));
  if (unwrapped !== wanted[0]) wanted.push(unwrapped);
  const candidates = wanted.filter((w) => w !== "");
  const mostWords = Math.max(0, ...candidates.map((c) => (c.match(WORD) ?? []).length));
  if (mostWords === 0) {
    return { ok: false, missingIds: [], reason: "No evidence quote was given." };
  }
  // A single word like "the" matches almost any sentence and proves nothing.
  if (mostWords < MIN_QUOTE_WORDS) {
    return {
      ok: false,
      missingIds: [],
      reason: `The quote is too short to be evidence (needs at least ${MIN_QUOTE_WORDS} words).`,
    };
  }

  const cited = ids
    .map((id) => byId.get(id))
    .filter((s): s is SourceSentence => s !== undefined)
    .sort((a, b) => a.position - b.position);

  for (const run of runsOf(cited)) {
    const haystack = normalizeForMatch(run.map((s) => s.text).join(" "));
    if (candidates.some((c) => haystack.includes(c))) {
      return { ok: true, missingIds: [], reason: null };
    }
  }

  const citedList = ids.join(", ");
  const elsewhere = sentences.find((s) => {
    const text = normalizeForMatch(s.text);
    return candidates.some((c) => text.includes(c));
  });
  return {
    ok: false,
    missingIds: [],
    reason: elsewhere
      ? `The quote is in ${elsewhere.id}, not in the cited sentence(s) ${citedList}.`
      : `The quote does not appear, word for word, in the cited sentence(s) ${citedList}.`,
  };
}
