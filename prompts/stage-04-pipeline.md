# Stage 4 — Repair loop, pipeline, audit store, run report

**Goal:** one function `runPipeline(input, deps)` that goes raw text → parse → generate → verify → repair-once → assemble, emitting typed events, persisting an audit trail, and producing a run report that reconciles.

**Read first:** `CLAUDE.md` §1 (invariant 3), §4; lore §3.1, §3.4, §6.5–6.6, §8.3, §12. Protocol: CLAUDE.md §6.

## Build
1. `core/repair/repair.ts`: `repairItem(item, verdictReasons, doc, llm)` — one regeneration of that single item. The prompt includes the original item, each failure reason verbatim (e.g. "mentions *typically*, absent from S3.2"; "closest source sentence is S3.4"), and stricter rules: extractive wording, cite only the sentences that contain the content, narrow rather than extend. Same schema as the generator. A `CONTRADICTED` item is never repaired. Max one attempt per item.
2. `core/pipeline/pipeline.ts`:
   - `RunEvent` union: `stage` (parse|generate|verify|repair|assemble), `draft`, `verdict`, `repaired`, `removed`, `warning`, `done`, `error` — each with `runId` and a monotonic `seq`.
   - Flow per lore §12: SUPPORTED → accept; PARTIAL/UNSUPPORTED → repair once → re-verify; then SUPPORTED shown, PARTIAL shown flagged, UNSUPPORTED/CONTRADICTED removed with reasons.
   - Question selection: from verified candidates choose **exactly five** with a mix of `qtype` where possible (prefer SUPPORTED, then flagged-PARTIAL only if needed). If fewer than five survive, emit a visible `warning` ("only N questions could be supported") — never pad.
   - Coverage: every section must be represented by ≥1 shown summary point; if not, one targeted per-section regeneration, re-verified.
   - Dedupe near-identical items (normalised text equality or cosine ≥ 0.95).
   - Degrade honestly: if NLI or judge is unavailable, mark `not_run` (so `decide` caps at PARTIAL) and emit a `warning` that the verifier is degraded.
   - Cancellation via `AbortSignal` at every await boundary.
   - Dependencies injected: `{ llm, nli, embed, store, clock, ids }`.
3. `core/report/report.ts`: `makeReport(final, removed, usage)` → counts (`generated, supported, partial, removed`, per type), `sourceSentences`, `sections`, coverage %, token/cost totals, and `reconciles: boolean` (`generated === supported + partial + removed`). Matches lore §6.6 wording.
4. `RunStore` port in `src/core/ports/store.ts` (`createRun, appendEvent, saveDrafts, saveVerdicts, saveResult, getRun, deleteRun, purgeOlderThan`) + `node:sqlite` implementation in `src/store/`, database file `data/noteriser.db` (gitignored), WAL, schema migrations as numbered SQL strings. Persist: source (needed for audit), drafts, verdicts, rejections, usage. `purgeOlderThan(RUN_TTL_HOURS)` runs on startup and hourly. JSONL export of a run.
5. `scripts/run.ts <file> [--fake]`: runs the pipeline, streams events to stderr, prints assembled Markdown-ish text + the report. `--fake` uses scripted fake LLM/NLI so it is runnable without keys.

## Tests
- Pipeline with fakes scripted to reproduce lore §6.5: unsupported "most widely used" removed; contradicted removed and never repaired; narrow-able glossary item repaired → PARTIAL flagged; unsupported question replaced by another candidate → five questions.
- Invariants as properties over several scripted scenarios: report reconciles; no removed item in shown output; every shown SUPPORTED item has all four checks run; every removed item has ≥1 reason; repair attempted at most once per item; event `seq` strictly increasing.
- Degraded verifier → no SUPPORTED items, warning emitted.
- Abort mid-run → `error` event with `aborted`, partial results persisted and marked incomplete.
- Store: create/get/delete/purge; migration idempotence; source text absent from pino output (inject a capture stream).

## Constraints
- No HTTP, no React. Do not reach into pi-ai from here.
- No silent fallbacks: every degradation is an event.

## Gate
`npm run check` · `npx tsx scripts/run.ts fixtures/lecture7.md --fake` pasted · live run if a key exists (paste report incl. cost).

## Report
Final report block for the fixture, events per stage, what the repair step changed in each repaired item, and run latency (fake vs live).
