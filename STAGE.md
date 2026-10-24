# STAGE.md — build status

Legend: ⬜ not started · 🟦 in progress · ✅ done (gate green) · ⛔ blocked
Rules: one 🟦 at a time · set 🟦 before coding · set ✅ only after the gate output is green · protocol in `CLAUDE.md` §6.

| # | Stage | Status | Prompt | Gate (all must pass) | Done on | Evidence |
|---|---|---|---|---|---|---|
| 0 | Scaffold, tooling, env, pi-ai smoke | ✅ | [stage-00](prompts/stage-00-scaffold.md) | `npm run check`, `npm run build`, architecture test | 2026-10-24 | check: typecheck+biome+24 tests green; build ok; `GET /` 200 on dev; smoke SKIPPED (no key) |
| 1 | Schemas, ingestion, segmentation | ⬜ | [stage-01](prompts/stage-01-ingest-segment.md) | `npm run check`; fixture → exactly 3 sections / 15 IDs `S1.1…S3.6` | | |
| 2 | Evidence-bound generators + LLM adapter | ⬜ | [stage-02](prompts/stage-02-generators.md) | `npm run check`; prompt snapshots; live draft schema-valid (if key) | | |
| 3 | Verifier (4 checks + decision table) | ⬜ | [stage-03](prompts/stage-03-verifier.md) | `npm run check`, `npm run test:slow`; lore §6.5 drafts never `SUPPORTED` | | |
| 4 | Repair loop, pipeline, audit store, report | ⬜ | [stage-04](prompts/stage-04-pipeline.md) | `npm run check`; report reconciles; CLI run on fixture | | |
| 5 | API (SSE) + core UI | ⬜ | [stage-05](prompts/stage-05-api-ui.md) | `npm run check`, `npm run e2e`; axe 0 serious/critical | | |
| 6 | Accessibility + TTS + plain-language mode | ⬜ | [stage-06](prompts/stage-06-accessibility.md) | `npm run check`, `npm run e2e`; text-spacing + reflow tests; manual SR pass | | |
| 7 | Export (MD, TXT, print-PDF, Anki TSV) | ⬜ | [stage-07](prompts/stage-07-export.md) | `npm run check`; golden exports; citation round-trip | | |
| 8 | Evaluation harness + threshold tuning | ⬜ | [stage-08](prompts/stage-08-evaluation.md) | `npm run eval` → `eval/RESULTS.md` with real numbers | | |
| 9 | Hardening, privacy, feedback, demo docs | ⬜ | [stage-09](prompts/stage-09-hardening-demo.md) | full gate + injection test + degraded-mode test + `npm run build && npm start` | | |

## Stage checklists

Tick items as they land; the status column above only flips when every box and the gate are green.

- **0** ☑ Next 16 + TS strict · ☑ deps pinned exact · ☑ Biome · ☑ Vitest · ☑ env validation · ☑ pi-ai smoke script (lookup + skip verified; **live call not run, no key**) · ☑ architecture test · ☑ `.env.example`, `.gitignore`
- **1** ☐ TypeBox schemas · ☐ normalize · ☐ txt/md · ☐ pdf · ☐ docx · ☐ segmenter · ☐ fallbacks · ☐ not-processed warnings · ☐ `fixtures/lecture7.md` · ☐ `scripts/parse.ts`
- **2** ☐ `LlmClient` · ☐ pi adapter · ☐ fake client · ☐ summary/glossary/question prompts · ☐ evidence-first schemas · ☐ per-section + roll-up · ☐ snapshots
- **3** ☐ quote check · ☐ NLI wrapper + windowing · ☐ embeddings · ☐ novel entities · ☐ over-generalisation · ☐ judge · ☐ `decide` table-driven tests · ☐ question/distractor checks · ☐ slow real-model test
- **4** ☐ repair · ☐ question selection to 5 · ☐ coverage check · ☐ `RunEvent`s · ☐ `RunStore` (node:sqlite) · ☐ TTL purge · ☐ run report · ☐ `scripts/run.ts`
- **5** ☐ `POST /api/runs` SSE · ☐ `GET`/`DELETE` · ☐ input limits · ☐ input page · ☐ results page · ☐ source panel + highlight · ☐ removed panel · ☐ trust notice · ☐ e2e (fake LLM)
- **6** ☐ themes + HC + forced-colors · ☐ font/size/spacing controls · ☐ WCAG 1.4.12 test · ☐ reflow 320px · ☐ TTS · ☐ plain-language + re-verify + readability · ☐ chunked `<details>` · ☐ axe all states · ☐ **manual NVDA/VoiceOver pass (user)**
- **7** ☐ Markdown · ☐ TXT · ☐ print stylesheet · ☐ JSON audit · ☐ Anki TSV · ☐ golden tests
- **8** ☐ ≥20 excerpts · ☐ planted-error drafts · ☐ dev/test split · ☐ metrics · ☐ threshold sweep · ☐ review sheet + kappa · ☐ regression folder · ☐ `RESULTS.md`
- **9** ☐ prompt-injection test · ☐ degraded mode · ☐ cost/size guards · ☐ abort on disconnect · ☐ log redaction · ☐ feedback button · ☐ Dockerfile · ☐ README + viva runsheet

## Decisions log
| Date | Decision | Why |
|---|---|---|
| 2026-10-24 | Use `@earendil-works/pi-ai`, not `@mariozechner/pi-ai` | Old package deprecated in registry |
| 2026-10-24 | npm, `node:sqlite`, TypeBox-only schemas, no ORM | Fewest moving parts on Windows dev machine |
| 2026-10-24 | Over-generate 8 question candidates, keep best 5 verified | Lore §6.5 replaces dropped questions |
| 2026-10-24 | `cacheComponents` / `partialPrefetching` **off** (template default was on) | Next docs: it rejects `runtime` and `dynamic` route exports and throws on `Date.now()`/`Math.random()` during prerender; app is request-time dynamic |
| 2026-10-24 | **TypeScript 6.0.3**, not 7.0.2 | TS 7.0.2 fails `Cannot find name 'LayoutProps'` (Next's generated global); 5.9.3 and 6.0.3 pass |
| 2026-10-24 | `typebox` pinned **1.3.27** | pi-ai 1.4.0 nests 1.3.27; matching it gives one copy (`npm ls typebox` deduped) |
| 2026-10-24 | Ports (`LlmClient`, `Nli`, `Embedder`, `RunStore`) live in `src/core/ports`; adapters implement them | `src/core` may not import `src/llm|nlp|store`; prompts 2–4 and CLAUDE.md updated |
| 2026-10-24 | `react`/`react-dom` stay at 19.3.0 (template pairing), not registry 19.3.1 | Next 16.4.3 was generated and built against 19.3.0 |
| 2026-10-24 | `turbopack.root = process.cwd()`; `typecheck` runs `next typegen` first | Stray lockfile in `C:\Users\navas` confused root detection; fresh clones have no `.next/types` |
| 2026-10-24 | `onnxruntime-node` postinstall **not approved** (npm 11 `allow-scripts`) | Not needed until Stage 3; test without it first, approve only if the model fails to load |

### pi-ai 1.4.0 facts confirmed in Stage 0 (Stage 2 depends on these)
1. **Model resolution:** `builtinModels()` from `@earendil-works/pi-ai/providers/all` (or `createModels()` + per-provider factories from `/providers/<id>`); `models.getModel(provider, id)` is synchronous and returns `undefined` if absent. Verified: `anthropic:claude-sonnet-5-5` resolves, `anthropic:not-a-model` does not.
2. **Context:** `{ systemPrompt?, messages: [{ role: "user", content, timestamp }], tools? }`; call `models.complete(model, context, options)`; auth via `models.getAuth(model)` (`undefined` = no key).
3. **Temperature:** plain stream option (`temperature`, `maxTokens`); APIs that cannot apply it ignore it. Whether specific models reject it is untested.
4. **Tool choice cannot be forced:** `ToolChoice = "auto" | "none"`. Use one tool + `constrainedSampling: { type: "json_schema", strict: "prefer" }` + `validateToolCall` + one retry. Results: `usage.input/output/cost.total`; failures surface as `stopReason: "error" | "aborted"`, not exceptions. `fauxProvider` exists for deterministic adapter tests.

## Open questions / blockers
- Live pi-ai call untested: no provider key or `GEN_MODEL` in this environment. Run `npx tsx scripts/llm-smoke.ts <provider:model>` after adding a key to `.env.local`.
- Playwright browsers not installed yet (`npx playwright install`) — needed from Stage 5.

## Run log
- 2026-10-24 · stage 0 · `npm run check` · green (typecheck, biome 29 files, vitest 24 tests)
- 2026-10-24 · stage 0 · `npm run build` · green (Next 16.4.3 Turbopack, 2 static routes)
- 2026-10-24 · stage 0 · dev server `GET /` · 200, page text and Tailwind CSS present
- 2026-10-24 · stage 0 · `npx tsx scripts/llm-smoke.ts` · SKIPPED (no model/key); catalog lookup verified
