const INVISIBLE = /[​-‍⁠﻿­]/g;
const SINGLE_QUOTES = /[‘’‚‛′´]/g;
const DOUBLE_QUOTES = /[“”„‟″]/g;
const DASHES = /[‐-―−]/g;
const LIST_MARKER = /^[ \t]*(?:[-*+•▪◦‣]|\d{1,3}[.)])[ \t]+/gm;
// Emphasis/code markers. Underscores only at word edges so snake_case survives.
const MARKUP = /[*`]+|~~|(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu;

function step(input: string): string {
  return input
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, "-")
    .replace(LIST_MARKER, "")
    .replace(MARKUP, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Canonical form for comparing a model's quote with source text. Used by ingestion and by the
 * quote-existence check, so both sides are always reduced the same way. Idempotent: stripping a
 * marker can expose another (`- - x`), so it runs to a fixed point.
 */
export function normalizeForMatch(input: string): string {
  let out = step(input);
  for (let i = 0; i < 8; i++) {
    const next = step(out);
    if (next === out) return out;
    out = next;
  }
  return out;
}
