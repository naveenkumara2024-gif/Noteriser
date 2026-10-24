# Stage 3 — Verifier: four checks + decision table

**Goal:** given a draft item and the source, return a verdict with scores and human-readable reasons. This is the core of the product — optimise for *never SUPPORTED when it shouldn't be*, then for low over-flagging.

**Read first:** `CLAUDE.md` §1, §4, §8; lore §3.4, §6.5, §7.1, §8.2; `docs/RESEARCH.md` §1 and §4. Check the installed `@huggingface/transformers` docs/types for text-pair classification before writing the wrapper.

## Build
1. `core/verify/quote.ts` — **Check 1.** `quoteExists(quote, sentences, sourceIds)`: every cited ID exists; `normalizeForMatch(quote)` is a substring of the normalised concatenation of the cited sentences (so a quote may span two adjacent cited sentences). Return `{ ok, missingIds, reason }`.
2. **Check 2 (wrapper).** Port `src/core/ports/nli.ts`: `Nli { score(premise, hypothesis): Promise<{entailment, neutral, contradiction}> }` (and `Embedder` in `ports/embed.ts`). Real impl in `src/nlp/nli.ts`. First settle the install-script question from CLAUDE.md §8: try loading the model *without* approving `onnxruntime-node`'s postinstall; only if it fails, run `npm approve-scripts onnxruntime-node` and record it in STAGE.md. Impl: lazy singleton, `Xenova/nli-deberta-v3-small`, int8, cache `.cache/models`, labels read from `config.id2label` (do not hard-code order). If the premise+hypothesis exceed 512 tokens, window the premise by sentences with overlap and take the **max** entailment across windows (and the max contradiction). `fake.ts` returns scripted scores.
3. `core/verify/entailment.ts`: split the claim into sentences (Stage 1 segmenter); score each sub-claim against the premise; item entailment = **min** over sub-claims, contradiction = **max**. (AlignScore/MiniCheck-style aggregation.)
4. `nlp/embed.ts`: `Xenova/all-MiniLM-L6-v2`, `bestMatches(claim, doc, k)` by cosine; fake provided. Used for reasons/repair hints only ("closest source sentence is S3.4, not the cited S3.2") — never to grant SUPPORTED.
5. `core/verify/entities.ts` — **Check 3.** Extract from the claim: numbers (incl. `10 ms`, `2x`, percentages, ranges), dates, capitalised proper nouns not sentence-initial, acronyms, and technical terms (tokens ≥ 4 chars absent from source vocabulary after normalisation, minus a stop/function-word list). A *hard* novel entity is a number, date, proper noun or acronym absent from the source → forces UNSUPPORTED. A *soft* novel term only lowers to PARTIAL.
6. `core/verify/overgeneral.ts`: absolute/comparative/hedge lexicon (*always, never, all, every, most, only, best, worst, typically, usually, generally, in practice, widely, impossible, guarantees, …*); report any present in the claim but absent from the cited text. Feeds PARTIAL.
7. `core/verify/judge.ts` — **Check 4.** Uses `LlmClient` with `role: "judge"`. Prompt contains only the cited source text and the claim; schema `{ verdict: "pass" | "fail" | "contradiction", unsupported_parts: string[] }`. For MCQs, a second call asks "is this option **wrong** according to the source, without adding facts?" for each distractor.
8. Questions: verify `answerStatement` (not the question text) through checks 1–4 against `answerSourceIds`; MCQ distractors go through check 3 (no new entities) and the distractor-wrong judge call.
9. `core/verify/thresholds.ts` (single source of numbers) and `core/verify/decide.ts`: pure `decide(inputs, thresholds) → { verdict, reasons[] }` implementing the lore §3.4 table exactly, plus invariant 1 (a check with `not_run` caps the verdict at PARTIAL with reason "verifier degraded").
10. `core/verify/verify.ts`: runs all checks for an item (checks 1, 3, 6 are deterministic; 2 and 4 async, bounded concurrency 4 across items), returns the filled envelope.

## Tests
- `decide`: table-driven, one case per lore §3.4 row and each boundary of the thresholds, plus the `not_run` cap.
- Entities: `"10 ms"`, `"O(n log n)"`, `"Linux"`, `"in 1998"`, `"50%"`, fractional numbers; source-present numbers pass; sentence-initial capitals ignored.
- Overgeneral: each lexicon word flagged only when absent from the source.
- Windowing: a long premise is split, max is taken (fake NLI asserts call count).
- **Lore §6.5 drafts** (4 of them) through the full verifier with fake NLI/judge returning the *expected-failure* scores → verdicts match the table; plus a fixture asserting a correct item is `SUPPORTED`.
- `npm run test:slow` (real NLI, `*.slow.test.ts`): the four §6.5 drafts and the six correct summary points from lore §6.2 against the real model. Record per-item entailment/contradiction probabilities in the report. **If the real model fails to separate them, do not adjust the test or thresholds to hide it** — record the numbers under STAGE.md "Open questions" for Stage 8.

## Constraints
- Thresholds only in `thresholds.ts`. No threshold tuning against the §6.5 examples.
- No repair logic or pipeline here.

## Gate
`npm run check` · `npm run test:slow` (paste the probability table) · architecture test still green.

## Report
Probability table for the real model, whether it separates good from bad on the fixture, any model-size trade-off (small vs xsmall), latency per item.
