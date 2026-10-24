# Stage 8 — Evaluation harness and threshold tuning

**Goal:** measure the verifier and the pipeline honestly, tune thresholds without overfitting, and publish real numbers — including failures.

**Read first:** `CLAUDE.md` §4, §8; lore §8.4–8.5, §9; `docs/RESEARCH.md` §1 (SummaC/MiniCheck practice: tune on validation, report on test). Protocol: CLAUDE.md §6.

## Build
1. **Cases** `eval/cases/*.json` (≥ 20, original text written by you — no copied copyrighted material; subjects spread across CS, biology, history, physics, economics, law/ethics; include numbers, definitions, negations, near-synonyms, conditionals):
   ```json
   { "id": "bio-03", "split": "dev|test", "notes": "…lecture text…",
     "drafts": [ { "type": "summary_point", "text": "…", "sourceIds": ["S1.2"], "evidenceQuote": "…",
                   "label": "good|bad", "failureType": "invented_stat|outside_fact|reversed_meaning|overgeneralisation|fake_quote|number_altered|negation_dropped|scope_shift|null" } ] }
   ```
   Per case: ≥ 2 good and ≥ 2 bad drafts; every `failureType` appears ≥ 5 times overall. Assign `split` by a fixed alternating rule (even index → dev, odd → test) so it is reproducible; **never inspect test results while tuning**.
2. `eval/run-verifier.ts` (`npm run eval -- --judge=live|fake|off`): parse each case, run **verification only** on the static drafts (no generation), with real NLI and the chosen judge. Output per draft: verdict, scores, reasons.
3. **Metrics** (lore §8.5): verifier recall on bad drafts (overall and per `failureType`), over-flag rate on good drafts (PARTIAL or worse), balanced accuracy, citation validity, plus latency and cost. A good draft counts as “correct” if SUPPORTED; a bad draft is “caught” if not SUPPORTED. Report separately for `PARTIAL` as a catch.
4. **Threshold sweep** (dev split only): grid over entailment-supported and entailment-partial thresholds and contradiction threshold; choose the point maximising recall subject to over-flag ≤ 15 %. Write `eval/thresholds.recommended.json`. **Do not auto-apply** — print the diff for the human; apply to `thresholds.ts` only after the user agrees, then re-run on the test split.
5. **Pipeline eval** (`--e2e`, live keys): generate from each case's notes, run the full pipeline, export `eval/review-sheet.csv` (item, text, cited sentence, verdict) for two human reviewers to fill `reviewer1/reviewer2` (supported/unsupported/unclear). `eval/kappa.ts` computes Cohen's κ and the lore metrics (faithfulness, unsupported-slip rate, question quality) once the sheet is filled.
6. **Regression** `eval/regressions/`: every confirmed error becomes a case file automatically loadable by the same runner; `npm run eval:ci` runs the fake-judge subset plus regressions and fails on any regression.
7. `eval/RESULTS.md`: generated table with dev and test numbers side by side, per-failure-type recall, comparison against lore targets (recall ≥ 90 %, over-flag ≤ 15 %, citation validity 100 %), and a plain-language “what the verifier misses” section.

## Constraints
- Report the numbers you get. If targets are missed, say so and list the misses; do not tune on test, relabel cases to fit, or loosen metrics.
- Cases are data files; no case-specific logic in the verifier.

## Gate
`npm run check` · `npm run eval -- --judge=fake` (CI-safe) · live run with a real judge if a key exists · `eval/RESULTS.md` committed to the working tree with real numbers.

## Report
The results table, threshold recommendation + diff, top three failure patterns, and which Stage 3/4 changes the findings suggest (as proposals, not silent edits).
