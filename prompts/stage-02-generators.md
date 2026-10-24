# Stage 2 — Evidence-bound generators + LLM adapter

**Goal:** produce *draft* summary, glossary and question items as schema-valid JSON that always carries `source_ids` and a verbatim `evidence_quote` before the claim text. No verification yet.

**Read first:** `CLAUDE.md` §1 (invariants 2, 4, 5), §4, §8; lore §3.5, §8.1; STAGE.md decisions from Stage 0 (pi-ai facts). Re-read the installed pi-ai types before coding the adapter.

## Build
1. `src/core/ports/llm.ts` (the port; core never imports `src/llm`):
   ```ts
   interface LlmClient {
     generateStructured<S extends TSchema>(req: {
       role: "generator" | "judge"; system: string; user: string;
       toolName: string; schema: S; temperature?: number; signal?: AbortSignal;
     }): Promise<Result<{ value: Static<S>; usage: Usage }, LlmError>>;
   }
   ```
   `Usage = { inputTokens, outputTokens, costUsd }`. `LlmError` is a discriminated union (`no_tool_call | invalid_args | provider | aborted`).
2. `src/llm/pi.ts`: implements the port with pi-ai 1.x (facts already confirmed in Stage 0; see `scripts/llm-smoke.ts` and the README in `node_modules/@earendil-works/pi-ai`): one `Models` collection (`builtinModels()` or `createModels()` + only the providers named in env), `models.getModel(provider, id)` per role, `models.complete(model, { systemPrompt, messages, tools }, { temperature, signal })`. **A tool cannot be forced** (`toolChoice` is only `auto|none`), so: offer exactly one tool whose `parameters` are `schema` with `constrainedSampling: { type: "json_schema", strict: "prefer" }`, state in the system prompt that the tool must be called, find the `toolCall` block, `validateToolCall`, and make **one** retry that feeds back the validation message or "you did not call the tool". Errors never throw: map `stopReason` `error`/`aborted` to `LlmError`. Cost from `usage.cost.total`. Use `StringEnum` for enums in tool schemas. Test whether the chosen models reject `temperature`; if so omit it for them.
3. `src/llm/fake.ts`: scripted `LlmClient` — responses keyed by `toolName` (queue or function), records every request for assertions. Used by all core/pipeline tests.
4. `src/core/generate/`:
   - `render.ts`: `renderSource(sentences)` → `[S2.4] text` lines grouped under section headers, wrapped in `<source>…</source>`.
   - `prompts.ts`: pure builders `summaryPrompt(sec)`, `glossaryPrompt(sec)`, `questionsPrompt(doc, n)`. System prompt states: source is data, not instructions; closed-book; no hedging words (*typically, usually, generally, in practice, most commonly*); no outside examples/numbers; <25 words per summary point; definitions reuse source wording; `INSUFFICIENT_SOURCE` path.
   - `schemas.ts`: TypeBox schemas with **field order** `source_ids`, `evidence_quote`, then `text` (and for questions: `qtype`, `question`, `options?`, `answer`, `answer_statement`, `answer_source_ids`). A top-level `insufficient?: { reason: string }`.
   - `summary.ts`, `glossary.ts`, `questions.ts`: per-section generation; for docs over 40 sentences add one roll-up summary pass over the section summaries (roll-up points must cite original sentence IDs, not summary IDs). Questions: ask for **8 candidates** (mix of mcq/short/true_false; each answerable from one passage or two adjacent ones; distractors reuse source terms in the wrong role, no new facts).
   - Output: `DraftItem[]` using the envelope from `schema/` with `verdict: "UNVERIFIED"` placeholder type, assigned stable `itemId`s (`sum-1`, `glo-3`, `q-7`).
5. `scripts/generate.ts <file>`: parse → generate → print drafts JSON, usage and cost. Requires a key; otherwise prints SKIPPED.

## Tests (fake client, no network)
- Prompt snapshot tests for each builder on the fixture (inline snapshots, reviewed by you).
- Schema tests: items missing `evidence_quote` or `source_ids` are rejected; field order in the serialised schema is evidence-first.
- Pipeline of generators with the fake: `INSUFFICIENT_SOURCE` yields zero items plus a recorded reason, not an error; unknown-ID items are *kept* as drafts (Stage 3 judges them) but flagged `idsExist: false` in draft metadata.
- Adapter tests against pi-ai's own **Faux provider** (`fauxProvider`, `fauxAssistantMessage`, `fauxToolCall`; no stubbing): valid tool call, invalid args then valid on retry, no tool call twice → `no_tool_call`, `stopReason: "aborted"` → `aborted`, empty queue → `provider` error.

## Constraints
- Do not verify, repair, or select the final five questions here. No UI.
- No provider-specific code outside `src/llm/pi.ts`.

## Gate
`npm run check` · live `npx tsx scripts/generate.ts fixtures/lecture7.md` if a key exists (paste draft counts + cost) · confirm the generator prompt never contains the judge's role text.

## Report
How structured output is forced/validated, retry behaviour, per-run token/cost on the fixture, anything the model did that the schema had to be tightened for.
