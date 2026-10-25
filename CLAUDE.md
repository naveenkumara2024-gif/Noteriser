# CLAUDE.md — NoteBridge (repo: Noteriser)

Source-grounded study-aid generator. Input: instructor-approved lecture notes. Output: summary,
glossary, five practice questions — every item cited to exact source sentences, independently
verified, and flagged or removed if the source cannot support it.

**Behavioural spec (the "why" and the demo data):** `Q9_Accessible_Lecture_Notes_Design.md`.
**Research behind the stack choices:** `docs/RESEARCH.md`.
**Build plan + live status:** `STAGE.md`. **Per-stage prompts:** `prompts/stage-NN-*.md`.

Precedence when files disagree: this file (tech, tooling, conventions) > the lore file (behaviour,
verdict rules, sample I/O, checklist, metrics). The lore file's Python/Streamlit/FastAPI/spaCy/FAISS
choices are **superseded** by §2; its behaviour is not.

---

## 1. Non-negotiable invariants

These are the product. A change that weakens one is a bug, whatever else it improves.

1. **No item reaches the user as `SUPPORTED` unless all four checks ran and passed** (quote
   existence, entailment, novel-fact scan, independent judge). A check that could not run (model
   missing, API down) means the item is at best `PARTIAL` and the run shows a "verifier degraded" banner.
2. **Generator and judge are separate calls with separate prompts; the judge sees only source + claim.**
   Prefer a different model/provider for the judge (`GEN_MODEL` ≠ `JUDGE_MODEL`); warn at startup if equal.
3. **Nothing disappears silently.** Every removed item is listed with its reason. Run-report counts
   must reconcile: `generated = supported + partial + removed`.
4. **Evidence-first schemas:** `source_ids` and `evidence_quote` precede the claim text in every LLM output schema.
5. **Closed-book:** the model sees only numbered source sentences. Missing evidence → `INSUFFICIENT_SOURCE`, never a guess.
6. **Flags are text + icon, never colour alone.** A persistent notice says output is generated and flagged items must be checked.
7. **API keys and source text stay server-side.** Source text is never written to application logs.
8. **Deterministic core.** `src/core` is pure TypeScript with injected dependencies (LLM, NLI, clock, store) so the whole pipeline is testable with fakes.

---

## 2. Tech stack (replaces the lore file's Python stack)

Versions verified against the npm registry on 2026-10-24. Pin exact versions on install
(`npm install --save-exact`), re-check with `npm view <pkg> version` if the scaffold is later than that.

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node ≥ 22.19 (dev machine: 24.13), ESM only | pi-ai requires ≥22.19 |
| Package manager | **npm** (v11 installed; pnpm is not) | scripts in §5 |
| Framework | **Next.js 16.4** App Router, React 19.3 | `cacheComponents` is **off** (it forbids the `runtime`/`dynamic` route exports and sync IO during prerender; this app is request-time dynamic). Route handlers set `runtime = "nodejs"` (NLI cannot run on Edge) |
| Language | **TypeScript 6.0.3**, `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` | TS 7.0.2 does not resolve Next's generated global `LayoutProps`; 5.9.3 and 6.0.3 do. Revisit when Next supports 7 |
| LLM access | **`@earendil-works/pi-ai`** 1.4.x | **Not** `@mariozechner/pi-ai` (deprecated → renamed). 1.x API is a `Models` collection: `builtinModels()` from `/providers/all` (or `createModels()` + per-provider factories), `models.getModel(provider, id)`, `models.getAuth(model)`, `models.complete(model, context, opts)`. Multi-provider: generator and judge can use different providers |
| Schemas | **TypeBox** (`typebox` pinned to **1.3.27** so it dedupes with pi-ai's copy) | one schema lib everywhere: LLM tool schemas, API validation, env. No zod. API: `import Type from "typebox"`, `import Value from "typebox/value"` |
| Structured output | pi-ai has no JSON mode and **cannot force a tool** (`toolChoice` is only `"auto" \| "none"`) → offer one tool whose TypeBox params *are* the output schema, set `constrainedSampling: { type: "json_schema", strict: "prefer" }`, say in the system prompt that the tool must be called, validate with `validateToolCall`, retry once | errors never throw: check `message.stopReason` (`error`/`aborted`) |
| NLI (entailment) | **`@huggingface/transformers`** 4.x in Node, `Xenova/nli-deberta-v3-small` (int8, ~161 MB) | read labels from `config.id2label` (order: contradiction, entailment, neutral); 512-token limit → window the premise, aggregate by max |
| Embeddings | same library, `Xenova/all-MiniLM-L6-v2`, plain cosine | confirms best-matching source sentence; no vector DB |
| Sentence splitting | `Intl.Segmenter` + abbreviation/decimal merge rules | replaces spaCy/nltk |
| Ingestion | `unpdf` (PDF), `mammoth` (DOCX), built-in for `.txt`/`.md` | |
| Storage | built-in **`node:sqlite`** behind a `RunStore` interface | no native build step; module is flagged experimental in Node — keep it behind the interface |
| Styling | Tailwind 4 + CSS variables for themes/typography settings | |
| TTS | browser Web Speech API (client only) | feature-detect; word-boundary highlighting must be tested in a real browser, not assumed |
| Logging | `pino` with `redact` for any source/claim fields | |
| Tests | Vitest 5 (unit/integration), Playwright 1.64 + `@axe-core/playwright` (e2e, a11y) | |
| Lint/format | Biome 2 | |

Explicitly **not** used: Python, Streamlit, FastAPI, FAISS/vector DBs, spaCy, LangChain, Vercel AI SDK,
an ORM, Bespoke-MiniCheck (CC BY-NC 4.0 licence; 7B weights).

---

## 3. Repository layout

```
CLAUDE.md  STAGE.md  Q9_Accessible_Lecture_Notes_Design.md
docs/RESEARCH.md          prompts/stage-NN-*.md
fixtures/lecture7.md      the lore §6.1 sample, byte-for-byte content
eval/                     labelled cases, runner, sweep, CI check, report, review sheet, regressions, RESULTS.md
scripts/                  CLI entry points run with tsx (parse, generate, run, llm-smoke)
src/
  core/                   PURE. No imports from next, react, pi-ai, transformers, node:sqlite, or src/{app,ui,llm,nlp,store,config}.
    ports/                interfaces core depends on: LlmClient, Nli, Embedder, RunStore, Result (adapters below implement them)
    schema/  text/  ingest/  segment/  generate/  verify/  repair/  plain/  pipeline/  report/  export/  readability.ts
  llm/                    the ONLY place pi-ai is imported: pi adapter implementing core/ports/llm, plus fake
  nlp/                    Transformers.js NLI + embedding adapters implementing core/ports, plus fakes
  store/                  RunStore implementations: node:sqlite (data/noteriser.db, WAL, numbered migrations), in-memory, JSONL export, hourly retention purge
  demo/                   scripted fakes for fixtures/lecture7.md (lore §6 situation): powers `scripts/run.ts --fake`, the tests and Stage 5 fake mode
  config/                 env.ts (TypeBox-validated, fail fast)
  app/                    Next.js routes, pages, route handlers; app/server = request logic (input, SSE, rate limit, runtime/deps) kept out of the route files so it is unit-testable
  ui/                     React components (copy.ts, StatusBadge, results/…) and pure helpers (sse parser, progress reducer)
    shell/                the window around every page (Stage 12): top bar, history sidebar, activity panel, RunSession (owns the run), Pane (dialog-based column/drawer)
    home/                 the main page: headline + composer; dictation.ts is on-device only and behind an interface
tests/                    mirrors src/; tests/architecture.test.ts enforces import boundaries
```

---

## 4. Data contracts (summary — the schemas in `src/core/schema` are authoritative)

- `SourceSentence { id: "S{section}.{n}", section, sectionTitle, text, position }`
- `ItemEnvelope { itemId, type: "summary_point" | "glossary" | "question", sourceIds[], evidenceQuote, text, verdict, scores, flagReason }`
  - `scores { quoteFound: boolean, entailment: number | null, novelEntities: string[], overGeneral: string[], judge: "pass" | "fail" | "contradiction" | "not_run" }`
- Question adds `qtype: "mcq" | "short" | "true_false"`, `options?`, `answer`, `answerStatement` (a declarative
  restatement of the answer — this, not the question, is what NLI and the judge verify), `answerSourceIds[]`.
- `Verdict = SUPPORTED | PARTIAL | UNSUPPORTED | CONTRADICTED`; rules in lore §3.4. Thresholds live
  in one file (`src/core/verify/thresholds.ts`), start at entailment ≥ 0.85 supported / ≥ 0.5 partial,
  and are tuned only against the **dev** split in stage 8.
- Source rendered to the model as `[S2.4] Waiting time is …`, one sentence per line, grouped by section.
- Pipeline emits typed `RunEvent`s (progress, item, verdict, done) — consumed by the CLI, SSE route and tests alike.

---

## 5. Commands

```
npm run dev | build | start
npm run typecheck | lint | test           # unit + integration, fakes only, no network
npm run test:slow                         # real NLI model (downloads once to .cache/models)
npm run e2e                               # Playwright (builds, then serves on :3100 with LLM_MODE=fake); stop `npm run dev` first, both use .next
npm run check                             # typecheck + lint + test   ← the gate for every stage
npm run eval -- --judge=fake              # verifier evaluation on the dev cases, offline (see eval/RESULTS.md)
npm run eval:ci                           # offline regression check against eval/baseline.fake.json
npm run models:fetch | feedback:export    # pre-fetch local models; instructors' feedback -> candidate regression cases
npx tsx scripts/<name>.ts <args>               # run.ts <file> [--fake] [--profile p] [--verbose] [--export f.jsonl]
```

Env (`.env.local`, template in `.env.example`). **Provider switch: `LLM_PROFILE=nararouter|openrouter`.**
A profile is a prefix group: `<NAME>_BASE_URL`, `<NAME>_GEN_MODEL`, `<NAME>_JUDGE_MODEL`, `<NAME>_API_KEY`
(`my-proxy` -> `MY_PROXY_*`); the name is the provider id. A name pi-ai knows (`openrouter`) uses its
catalog; any other name plus a base URL is a custom OpenAI-compatible provider. `GEN_PROFILE` /
`JUDGE_PROFILE` put the two roles on different profiles. `--profile <name>` on the CLI scripts overrides
the flag for one command. Generic variables (`LLM_PROVIDER`, `GEN_PROVIDER`/`JUDGE_PROVIDER`, `GEN_MODEL`,
`JUDGE_MODEL`, `LLM_BASE_URL`/`GEN_BASE_URL`/`JUDGE_BASE_URL`, `LLM_API_KEY`) still work and always win over
a profile's value. Keys: pi-ai's own (`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` for `google`, …)
or `<PROVIDER>_API_KEY` / `LLM_API_KEY` for custom ones. Also `LLM_MODE=live|fake`, `RUN_TTL_HOURS`. Tests must never need a key.

---

## 6. Stage protocol (how work is done here)

Work proceeds one stage at a time from `STAGE.md`, using that stage's prompt in `prompts/`.

1. Read `STAGE.md`, this file, and the stage prompt. Confirm the previous stage is ✅.
2. Set the stage to 🟦 in `STAGE.md` **before** writing code.
3. Implement exactly the prompt's scope; no features from later stages.
4. Run the stage's gate commands for real and read the output. Fix until green. If a gate genuinely
   cannot pass, set ⛔, write the blocker under "Open questions", and stop — do not weaken the gate.
5. Set ✅ only after the gate is green, with date, the gate result in one line, and decisions made.
6. Commit only when the user asks (the folder is not yet a git repo; ask before `git init`).

Verify, don't assume: when a prompt says "read the installed package", read `node_modules` types/README
before writing the adapter. pi-ai and Transformers.js APIs move quickly; memory of them is not evidence.

---

## 7. Conventions

- Named exports, no default exports except Next.js pages/routes. No `any`; `unknown` + TypeBox `Value.Check`/`Value.Parse` at every boundary.
- Pure functions in `core`; side effects only at edges (`llm`, `nlp`, `store`, `app`). Core declares the interface it needs in `core/ports`; the edge implements it (enforced by `tests/architecture.test.ts`).
- Errors are values at pipeline boundaries (`Result`-style) so a failed item becomes a logged, visible verdict, not a crashed run.
- Prompts live in `src/core/generate/prompts.ts` as pure builders, covered by snapshot tests.
- One text-normalisation function (`core/text/normalize.ts`) is shared by ingestion and quote matching.
- Comments explain *why*; match surrounding density. UI strings in one `src/ui/copy.ts` for later localisation.
- Accessibility is a gate, not polish: axe must stay at zero serious/critical from stage 5 onward.

---

## 8. Known gotchas

- **pi-ai rename:** install `@earendil-works/pi-ai`; older blog posts and the 0.x README show a global `getModel`/`complete` API that no longer exists in 1.x. In a browser pi-ai needs an explicit `apiKey`; we never run it client-side. Its read-only `README.md` in `node_modules/@earendil-works/pi-ai` is the reference (Faux provider for tests is documented there).
- `temperature` and `maxTokens` are plain stream options; APIs that cannot apply a value ignore it. Target 0–0.2. Whether a specific reasoning model *rejects* it is unverified: test per model in Stage 2.
- Tool-schema enums: use pi-ai's `StringEnum`, not `Type.Enum` (README: `Type.Enum` emits `anyOf`/`const`, which Google's API does not support). Plain TypeBox unions are fine outside LLM-facing schemas.
- DeBERTa NLI: premise ≤ 512 tokens including hypothesis. Always window; never silently truncate.
- First NLI/embedding run downloads models; `.cache/models` is gitignored; CI/Docker must pre-fetch.
- `node:sqlite` prints an ExperimentalWarning on Node 24 — expected.
- npm 11 blocks dependency install scripts by default (`allow-scripts`). Verified in Stage 3: the NLI and embedding models run **without** approving `onnxruntime-node`'s postinstall, so leave it unapproved. The first real-model run downloads ~160 MB (NLI) + ~23 MB (embeddings) into `.cache/models`, which takes a minute or two; later runs load in seconds.
- The NLI model (`Xenova/nli-deberta-v3-small`) is context-sensitive: the same claim can entail against one sentence and not against that sentence plus others. The verifier therefore scores the claim against several *views* of the cited evidence and takes the best (`premiseViews`), prefixes the real section heading, and never truncates. Do not simplify this back to one concatenated premise; Stage 3 measured the difference (lore §6.2 point 3: 0.016 -> 0.99).
- `npm run typecheck` runs `next typegen` first: `LayoutProps`/route types are generated into `.next/types` and a fresh clone has none. Never add `.next` to tsconfig `exclude`.
- `next dev` rewrites `AGENTS.md` (Next's agent-rules block). Leave it; read `node_modules/next/dist/docs/` before using a Next API, as the bundled docs match the installed version.
- `turbopack.root` is pinned to the project dir in `next.config.ts` (a stray lockfile in the home directory otherwise breaks root detection). Tailwind goes through the `@tailwindcss/turbopack` loader rule in the same file.
- Display settings (theme, text size, font, spacing) are `<html>` attributes set by a head script before paint (`src/ui/settings.ts`); the script duplicates the parsing in miniature and a test keeps the two in step. Change one, change both.
- The shell (`src/ui/shell`) is a three-column window of `<dialog>` panes: columns when the frame is wide, modal drawers when not. Breakpoints are **container queries in rem** (they follow the Text size setting; media queries in rem do not) and `use-frame-mode.ts` mirrors the same thresholds, so change shell.css and that file together. Layout choices (sidebar, panel, history view) live in the same settings object as the display settings; `sidebar` and `panel` also reach `<html>` before paint as `data-*-pref`. The run belongs to `RunSession`, not to the page that started it. A hidden pane renders nothing (otherwise its text duplicates the page's for tests and screen readers).
- Dictation never calls the browser's cloud speech service: the button exists only if `SpeechRecognition.available({processLocally: true})` says `available`, and recognition refuses to start unless the browser accepts `processLocally`. Measured in Stage 12: that `available()` call **crashes headless Chromium**, so automation (`navigator.webdriver`) never probes; a headed Chromium answers `downloadable` for a missing local pack.
- Speed: summary, glossary and questions are generated together; `limitInFlight` caps model calls across the whole run (`LLM_MAX_IN_FLIGHT`, default 8, wrapped *outside* the cost guard so queued calls are not counted); a used-up provider quota (`isQuotaExhausted` in `src/llm/pi.ts`) is never retried. `src/instrumentation.ts` loads the models at server start. The floor is the stage chain (generate -> verify -> repair), so a slower provider, not more parallelism, is what dominates live runs.
- `GET /api/runs` lists the runs this browser holds an owner cookie for (titles and counts only, via the `RunIndex` port that both stores implement). Never add source or item text to it.
- Read-aloud (`src/ui/tts.ts`) talks to an injected speech interface, so tests never need audio. Word-level highlighting relies on `boundary` events (confirmed in Chromium with local voices only); keep item-level highlighting working without them.
- Plain-language mode never loosens the verifier: a rewrite is shown only if the full verifier says SUPPORTED. Do not tune thresholds for it.
- Exports (`src/core/export`) are pure functions of a stored result; Markdown and text share `buildModel`. Goldens in `tests/golden/` change only deliberately (`UPDATE_GOLDEN=1 npx vitest run tests/core/export`, then read the diff). The audit file contains the source text and is owner-cookie gated.
- The evaluation's test split is reported on, never tuned on: `npm run eval -- --split test` needs `--final`. Do not change thresholds to improve a number you have seen on the test split.
- Per-run limits (`RunLimits`) stop a run through the shared abort signal; any new long-running stage must honour `signal`.
- Source text may contain instructions ("ignore the above"). It is data: always inside delimiters, system prompt says so, tested in stage 9.
- The verifier can be wrong. Never present a score as truth; report its measured recall and over-flag rate (stage 8).

---

## 9. Out of scope (this build)

Tables/equations/images (flag as "not processed"), multilingual output, spaced-repetition scheduling
(a plain Anki TSV export is in scope), accounts/roles, instructor dashboard. Listed in lore §13 as future work.
