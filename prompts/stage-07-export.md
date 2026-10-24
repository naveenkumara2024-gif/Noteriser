# Stage 7 — Export

**Goal:** students can take the output elsewhere without losing citations or flags. Exports are pure functions of a stored result.

**Read first:** `CLAUDE.md` §1 (invariants 3, 6), §9; lore §3.6 (Export), §6; `docs/RESEARCH.md` §1 (spaced-repetition gap). Protocol: CLAUDE.md §6.

## Build (`src/core/export`, pure; routes in `src/app/api/runs/[id]/export`)
1. `renderMarkdown(result, opts)`: title, generation notice (lore §10), run report, Summary, Glossary, Questions (answer key in a separate section after the questions), **Removed items appendix**, and a **Source appendix** listing every cited sentence once as `S2.4 — text`. Citations render as `[S2.4]`. Flagged items carry a literal line `⚠ Check against source — <reason>`. Removed items never appear outside the appendix.
2. `renderText(result)`: same content, no markup, flags as `WARNING:` lines (screen-reader/TTS friendly).
3. `renderAnkiTsv(result, { includeFlagged: false })`: tab-separated `front<TAB>back<TAB>source_ids`, glossary terms and questions only, tabs/newlines escaped; flagged items excluded by default.
4. `renderAuditJson(result)`: drafts, verdicts, scores, rejections, usage (for reviewers; includes source, so labelled and downloadable only by the run's owner session).
5. **Print/PDF**: a dedicated `@media print` stylesheet on the results page (no sidebar, citations expanded to include the quoted source sentence, flags as text, page-break rules, links shown) and a “Print / Save as PDF” button calling `window.print()`. No PDF library.
6. UI: Export menu with the four formats + print; downloads named `notebridge-<date>-<runId8>.<ext>`; filenames sanitised.
7. Route: `GET …/export?format=md|txt|tsv|json` with correct `Content-Type` and `Content-Disposition`, 404 after TTL.

## Tests
- Golden files (`tests/golden/`) for the fixture result in md/txt/tsv; update only deliberately.
- **Citation round-trip:** parse every `[S…]` in the Markdown; each must exist in the Source appendix and match the stored sentence text exactly.
- No removed item text appears outside the appendix; every flagged item has its warning line; TSV round-trips through a TSV parser with embedded tabs/newlines/quotes in fixtures.
- Playwright: export menu downloads, filename pattern, axe clean with the menu open; print emulation (`page.emulateMedia({media:'print'})`) hides chrome and shows source quotes.

## Constraints
- Exports must not re-run any model. No new dependencies.

## Gate
`npm run check` · `npm run e2e` · attach the generated Markdown for the fixture to the report.

## Report
Format decisions (e.g. how answer keys are separated), anything lossy, TSV import tested in Anki if available (else say untested).
