# Stage 0 — Scaffold, tooling, env, pi-ai smoke

**Goal:** an empty-but-green Next.js + TypeScript project with the quality gate, import boundaries, validated env, and a proven pi-ai call path.

**Read first:** `CLAUDE.md` (all), `STAGE.md`. Follow the stage protocol in CLAUDE.md §6.

## Build
1. Scaffold Next.js (App Router, `src/`, TypeScript, Tailwind, alias `@/*`, **no ESLint**) without overwriting `CLAUDE.md`, `STAGE.md`, `Q9_*.md`, `docs/`, `prompts/`. If `create-next-app` refuses the non-empty folder, scaffold in a temp dir and move files in.
2. Install with `--save-exact`, resolving each version with `npm view` first (CLAUDE.md §2 table): runtime `@earendil-works/pi-ai`, `typebox`, `@huggingface/transformers`, `unpdf`, `mammoth`, `pino`; dev `vitest`, `@playwright/test`, `@axe-core/playwright`, `@biomejs/biome`, `tsx`. Set `engines.node >= 22.19` and `.nvmrc`.
   If TypeScript 7 breaks Next, Biome or Vitest, use the newest 5.x/6.x and record it in STAGE.md decisions.
3. `tsconfig`: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. Biome config (format + lint). Scripts exactly as CLAUDE.md §5; `check = typecheck && lint && test`. `eval` and `e2e` may be stubs that print "not implemented (stage N)" and exit 0.
4. Create the directory skeleton from CLAUDE.md §3 (empty `index.ts` barrels are fine; no empty-file churn elsewhere).
5. `src/config/env.ts`: TypeBox schema for `GEN_MODEL`, `JUDGE_MODEL` (`provider:model`), `LLM_MODE` (`live|fake`, default `fake`), `RUN_TTL_HOURS` (default 24). Parse once, throw a readable error listing every bad variable. `warnIfJudgeEqualsGenerator()` returns a message (invariant 2). Provider API keys are read by pi-ai, not by us.
6. `src/llm/smoke` path: **read `node_modules/@earendil-works/pi-ai` README and `.d.ts` first.** Write `scripts/llm-smoke.ts` that resolves `GEN_MODEL`, makes one tiny completion, prints text + `usage` + `usage.cost.total`. With no key set it prints `SKIPPED (no key for <provider>)` and exits 0.
7. `tests/architecture.test.ts`: walk `src/core/**` and fail if any file imports `next`, `react`, `@earendil-works/pi-ai`, `node:sqlite`, `@huggingface/transformers`, or anything under `src/app|ui|llm|nlp|store`. Also fail if any file outside `src/llm` imports `@earendil-works/pi-ai`.
8. `.env.example` (placeholders only), `.gitignore` (`.env*`, `.cache/`, `data/`, `.next/`, `node_modules/`), minimal home page that renders the product name and the trust notice text (lore §10).

## Constraints
- No product logic yet. No `any`. Do not add libraries not listed in CLAUDE.md §2.
- Do not run `git init`.

## Gate (run and show output)
`npm run check` · `npm run build` · `npx tsx scripts/llm-smoke.ts` (real call if a key exists, SKIPPED otherwise) · `npm run dev` then confirm `GET /` returns 200.

## Report
Installed versions table, any version deviations, smoke result, and the exact pi-ai call signatures you confirmed (model resolution, context shape, how temperature is passed, whether tool choice can be forced) — write those four facts into STAGE.md decisions; Stage 2 depends on them.
