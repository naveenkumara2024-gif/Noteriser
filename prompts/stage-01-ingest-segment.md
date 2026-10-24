# Stage 1 — Schemas, ingestion, segmentation

**Goal:** turn pasted text or an uploaded file into a `SourceDoc` of uniquely identified sentences. This is the single source of truth every later stage cites.

**Read first:** `CLAUDE.md` §3–4, lore §3.3, §4, §6.1. Stage protocol: CLAUDE.md §6.

## Build (all under `src/core` unless stated)
1. `schema/`: TypeBox schemas + `Static` types for `SourceSentence`, `Section`, `SourceDoc { sentences, sections, warnings, stats }`, `DocWarning { kind: "not_processed" | "noisy_extraction" | "no_headings" | "too_short", detail, sentenceRange? }`, plus the item/verdict/scores/report schemas from CLAUDE.md §4 (types only; no logic yet).
2. `text/normalize.ts`: `normalizeForMatch(s)` — NFKC, casefold, curly→straight quotes, dash variants→`-`, strip list bullets/markdown emphasis, collapse whitespace. Pure, idempotent, documented; Stage 3 reuses it for quote matching.
3. `ingest/`: `ingestText`, `ingestMarkdown` (keep headings as structure, strip emphasis/links to text), `ingestPdf` (`unpdf`; warn `noisy_extraction` on empty text, very short average line length, or high symbol ratio — likely scanned), `ingestDocx` (`mammoth`; map `h1–h6` to headings). Each returns `{ text, headings, warnings }`. Reject unknown types with a typed error.
4. `segment/`: 
   - Sections from markdown `#` headings, `Section N:` / `N. Title` lines (no terminal period, short). 
   - No headings → paragraph breaks; if still one block → groups of 6 sentences; emit `no_headings`.
   - Sentences via `Intl.Segmenter("en", { granularity: "sentence" })`, then re-merge false splits: abbreviations (`e.g.`, `i.e.`, `vs.`, `Fig.`, `Dr.`, `et al.`, `etc.`), decimals, initials. Each bullet line is its own sentence.
   - IDs `S{section}.{n}`, 1-based, stable for identical input.
   - Lines that are tables (≥2 pipes), LaTeX (`$$`, `\begin`), or image markers → excluded from sentences, recorded as `not_processed` warnings.
   - `< 10` sentences → `too_short` warning.
5. `fixtures/lecture7.md`: the lore §6.1 notes verbatim (3 sections, 15 sentences) written as normal lecture text, **without** the `S` IDs.
6. `scripts/parse.ts <file>`: prints the numbered view (`S2.4  Waiting time is …`) and warnings.

## Tests (`tests/core/...`, no network)
- Fixture → exactly 3 sections, 15 sentences, IDs `S1.1…S1.4, S2.1…S2.5, S3.1…S3.6`, and each text equals the lore sentence.
- Table-driven splitter cases: abbreviations, decimals (`3.5 ms`), parenthetical periods, quotes, bullets, Unicode punctuation.
- Headless cases: no headings, one paragraph, empty input (typed error), whitespace-only, 3-sentence input.
- `normalizeForMatch` idempotence property on random strings.
- Ingest: markdown with emphasis/links; a generated tiny PDF and DOCX (create in test setup, don't commit binaries) round-trip; noisy-PDF heuristic triggers on a symbol-heavy string.

## Constraints
- No LLM, no network, no UI. Deterministic. Don't add libraries beyond `unpdf`/`mammoth`.
- Never drop text silently: anything excluded must appear in `warnings`.

## Gate
`npm run check` · `npx tsx scripts/parse.ts fixtures/lecture7.md` output pasted in the report.

## Report
Splitter rules implemented, any ambiguity decisions (e.g. heading patterns), warnings produced for the fixture (should be none).
