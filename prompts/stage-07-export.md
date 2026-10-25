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

## As built (2026-10-25) — what differs from the plan above
- **Core** (`src/core/export`, pure): one shared `buildModel(result, { wording, generatedAt })` that decides what an export says; `renderMarkdown` and `renderText` only format it, so they cannot drift apart. `failedChecks` moved here from the UI; the trust notice and removal labels live in `labels.ts` and the UI imports them. `generatedAt` is passed in (the run's stored creation time), so exports are deterministic.
- **Markdown:** title, notice, banners (degraded / incomplete / failed / plain wording), Summary, Glossary, Practice questions, **Answer key** (a separate section, numbered like the questions), Run report, notes about the run, **Appendix A: Removed items** (with the failed checks), **Appendix B: Source sentences** (only the sentences shown items cite, once each, grouped by section, `S2.4 — text`). Citations are `[S2.4]`; every other `[`/`]` in item text is escaped so the only live citations in a file are real. Flagged items carry the literal line `⚠ Check against source — <reason>`. Removed items appear only in Appendix A, and cite their sentences without brackets.
- **Plain text:** same content, no markup, `WARNING:` lines, `(Source: S1.1, S1.2)`.
- **Anki TSV:** header lines `#separator:tab`, `#html:false`, `#tags column:3`; columns `front<TAB>back<TAB>tags`, where the tags are the source ids (`S2.4 S2.5`). Glossary terms and questions only (a multiple-choice front carries its lettered options on following lines); flagged items excluded unless asked for, and then tagged `check-against-source`. Fields with a tab, line break, quote or a leading `#` are double-quoted (inner quotes doubled), which Anki's importer reads. Whitespace inside an item is collapsed to single spaces, so line breaks only occur in a multiple-choice front. **Not tested in Anki itself** (not installed here); tested against an independent TSV reader.
- **Audit JSON** (`renderAuditJson(StoredRun)`): format `notebridge-audit/1`, `contains_source_text: true`, source, report and usage, shown items with scores, removed items with reasons, every draft and verification with its attempt number, and the event log. Only the **owner browser** can download it: starting a run sets an HttpOnly, SameSite=Strict cookie `nb_owner_<runId>` for the retention period; the audit route is 403 without it. Study-aid formats stay available to anyone with the link, as before. This is a courtesy boundary, not authentication.
- **Route** `GET /api/runs/{id}/export?format=md|txt|tsv|json[&wording=plain][&flagged=1]`: correct `Content-Type`, `Content-Disposition: attachment; filename="notebridge-<date>-<id8>.<ext>"` (id characters outside A-Za-z0-9 dropped, so nothing can break the header or a path), `nosniff`, `no-store`; 400 bad format, 404 unknown/deleted/expired, 409 not finished, 403 audit without cookie. No model is called.
- **UI:** an Export and print disclosure with four download links (plain `<a download>`, so they work without scripts), a plain-wording checkbox (only for runs that have plain versions), an include-flagged checkbox for Anki, and a Print / Save as PDF button.
- **Print:** a `@media print` stylesheet: header, controls, Source column, reading-level, read-aloud, export and delete are hidden; the light palette at normal size whatever the screen settings (the inline text-size variable is bypassed by pinning the root font size); the trust notice is repeated at the top; each item prints the sentences it cites; flags stay text; answers appear as an Answer key after the questions; **removed items print too** (every disclosure is opened on `beforeprint` and restored on `afterprint`, so Ctrl+P and the button behave the same); items do not split across pages; link targets are written out. No PDF library. A PDF produced from the print view in headless Chromium is valid (`%PDF-`, 130 KB for the fixture).
- **Lossy by design:** exports carry the wording and flags, not the interactive highlighting; the Markdown run report is a text block; plain-language items that kept their original say so in a line.
