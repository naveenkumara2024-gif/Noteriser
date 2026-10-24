const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

/**
 * Abbreviations that never end a sentence on their own. ICU splits after them when the next word
 * is capitalised ("Dr. Smith", "e.g. A queue"); it already keeps them joined before lowercase/digits.
 * "etc." and "et al." are deliberately absent: they can legitimately end a sentence.
 *
 * Titles and section words match case-sensitively: lowercase "ms." is milliseconds and "sec." is
 * seconds, and both routinely end a sentence.
 */
const CAPITALISED = new Set([
  "Dr",
  "Mr",
  "Mrs",
  "Ms",
  "Prof",
  "St",
  "Jr",
  "Sr",
  "Fig",
  "Figs",
  "Eq",
  "Eqs",
  "Sec",
]);
const ANY_CASE = new Set(["vs", "cf", "viz", "e.g", "i.e"]);

const TRAILING_TOKEN = /(?:^|[\s("'])([A-Za-z]+(?:\.[A-Za-z]+)*)\.$/;
// Only initials ("J." / "J. R."). "Vitamin C." is not matched, so it can still end a sentence.
const ONLY_INITIALS = /^(?:[A-Z]\.\s*)+$/;
const HAS_CONTENT = /[\p{L}\p{N}]/u;

function endsWithAbbreviation(segment: string): boolean {
  const token = TRAILING_TOKEN.exec(segment)?.[1];
  return token !== undefined && (CAPITALISED.has(token) || ANY_CASE.has(token.toLowerCase()));
}

function shouldMergeWithNext(segment: string): boolean {
  return ONLY_INITIALS.test(segment) || endsWithAbbreviation(segment);
}

/** Split one logical line (already joined across soft wraps) into trimmed sentences. */
export function splitSentences(text: string): string[] {
  const raw = [...segmenter.segment(text)]
    .map((s) => s.segment.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);

  const out: string[] = [];
  let pending: string | undefined;
  for (const piece of raw) {
    const current = pending === undefined ? piece : `${pending} ${piece}`;
    if (shouldMergeWithNext(current)) {
      pending = current;
      continue;
    }
    pending = undefined;
    // A fragment with no letters or digits ("—", ".") is punctuation debris, not content.
    if (HAS_CONTENT.test(current)) out.push(current);
  }
  if (pending !== undefined && HAS_CONTENT.test(pending)) out.push(pending);
  return out;
}
