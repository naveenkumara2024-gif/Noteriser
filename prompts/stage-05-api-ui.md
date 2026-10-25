# Stage 5 — API (SSE) + core UI

**Goal:** a working app: paste/upload/sample → live progress → results with source side-by-side, visible flags and a Removed-items panel. Deterministic e2e with `LLM_MODE=fake`.

**Read first:** `CLAUDE.md` §1 (invariants 3, 6, 7), §7; lore §1.3, §3.6 (layout only), §6, §10. Check the Next.js 16 docs bundled in `node_modules/next/dist/docs` (or the official site) for route-handler streaming and `params` typing before writing routes.

## Build
1. **Routes** (`src/app/api/runs/…`, `export const runtime = "nodejs"`, `dynamic = "force-dynamic"`):
   - `POST /api/runs` — JSON `{ text, options }` or multipart file. Validate with TypeBox. Limits: text ≤ 200 KB, file ≤ 5 MB, `.txt/.md/.pdf/.docx` only; clear 4xx messages. Responds `text/event-stream`: each `RunEvent` as `event:`/`data:` JSON, heartbeat comment every 15 s, final `done`. Client disconnect aborts the pipeline (`request.signal`).
   - `GET /api/runs/[id]` — stored result (404 after TTL). `DELETE /api/runs/[id]`.
   - Naive in-memory per-IP rate limit (e.g. 6 runs/10 min), returning 429 with `Retry-After`.
   - Dependencies come from one `src/app/server/deps.ts` that builds real or fake deps from `LLM_MODE`; keys never leave the server.
2. **Fake mode**: `LLM_MODE=fake` wires scripted LLM/NLI/embed reproducing the lore §6 outputs (including the four removed/flagged drafts) so the UI and e2e are deterministic and key-free.
3. **UI** (`src/ui`, Tailwind, Server Components where static; client only for the SSE reader and interactions):
   - Home: textarea, file picker, “Use sample lecture” button (loads `fixtures/lecture7.md`), start button, input-warning list (`DocWarning`).
   - Progress: stage list with `aria-live="polite"` updates, cancel button.
   - Results: sections **Summary / Glossary / Questions** each as semantic lists. Every item shows: text, source citation chips `S2.4`, a status label with icon **and** words (“Supported”, “Check against source — partial”), and the flag reason when present. Selecting a chip or “Show source” highlights and scrolls the numbered sentence in a sticky **Source** column (on narrow screens it becomes a disclosure under the item). Questions: “Reveal answer” button; answer shows its citations.
   - **Removed items** panel (collapsed by default, count in the heading) listing every removed draft with failing check and reason. **Run report** card (lore §6.6) with reconciliation shown.
   - Persistent trust notice (lore §10 wording) and “verifier degraded” banner when applicable.
   - “Delete this run” button.
4. Strings in `src/ui/copy.ts`; status/icon mapping in one component (`StatusBadge`) so colour is never the only signal.

## Tests
- Route handlers: validation errors, size limits, rate limit, SSE ordering, abort-on-disconnect (unit with fake deps).
- Playwright (`npm run e2e`, `LLM_MODE=fake`, starts the app via `webServer`): sample → results; five questions; one flagged item with visible text label; Removed panel lists the three removed drafts; citation click highlights the right sentence; delete run → 404 on reload.
- `@axe-core/playwright` on home, progress, results, and Removed-panel-open states: **zero serious/critical**.
- Keyboard-only test: complete the whole flow with Tab/Enter/Space only; visible focus on every stop.

## Constraints
- No themes/TTS/plain-language/export yet (Stages 6–7), but use CSS variables and semantic HTML so they slot in.
- No source text in server logs (pino redact).

## Gate
`npm run check` · `npm run e2e` · `npm run build` · screenshot of results page in the report.

## Report
Route contract (request/response/event shapes), limits chosen, a11y findings fixed, anything deferred.

## As built (2026-10-24) — what differs from the plan above
- **Layout:** route files are thin; the logic is in `src/app/server/` (`input.ts` validation and caps, `rate-limit.ts`, `sse.ts`, `runs.ts` handlers, `runtime.ts` deps from `LLM_MODE`, cached on `globalThis`, a failed start is not remembered). Handlers take a `Runtime` so tests run them with fakes, no HTTP server.
- **Contract.** `POST /api/runs`: JSON `{ text, options?: { format?: "plain"|"markdown" } }` (text <= 200 KB in UTF-8 bytes) or multipart field `file` (<= 5 MB; `.txt .md .pdf .docx`). Errors are JSON `{ error: { code, message } }`: 400 `invalid_request`/`empty`, 413 `too_large`, 415 `unsupported_type`, 429 `rate_limited` (+ `Retry-After`), 503 `not_configured` (reason logged, never sent). Success is `text/event-stream` with header `X-Run-Id`; each `RunEvent` is `event: <type>`, `id: <seq>`, `data: <json>`; `: heartbeat` every 15 s. The stream closes only after the run is stored. An unreadable document is an `error` event (`parse_failed`) inside a 200 stream, because parsing happens in the pipeline. `GET /api/runs/{id}` -> 200 `{ runId, status, createdAt, result }` (202 while running, 404 once deleted or purged); `DELETE` -> 204/404. Malformed ids are 404.
- **Limits:** bodies are read with a byte cap, so an oversize upload is rejected without being held in memory. Rate limit is a sliding window (default 6 runs per 10 min per `X-Forwarded-For` first hop, else one shared bucket); only accepted runs count, not rejected input. It is in memory, resets on restart and is not a security boundary.
- **Disconnect:** `request.signal` and the stream's `cancel()` both abort the pipeline; the run is stored as `incomplete`.
- **Pages:** `/` (form + progress, client), `/runs/[id]` (server loads the stored run, client `ResultsView`), `not-found`. After the stream ends with a `done` event the browser navigates to the run page, so results are reloadable and deletable. A `parse_failed` run keeps the person on the form with the reason.
- **Source column** is a sticky `aside` on `lg`+; below that each item has its own `<details>` (same state, so a citation chip opens it). Both are driven by one `Selection` state. DOM ids exist only in the sticky column.
- **Fake mode** (`LLM_MODE` unset or `fake`) shows a "Demo mode" notice. `FAKE_DELAY_MS` slows each scripted model call so progress and cancel can be seen and tested.
- **Deferred:** `DocWarning`s appear on the results page ("Parts of your notes were not processed"), not on the home page, because they only exist after parsing. No per-IP trust of proxies, no auth: a run id (UUID) is the only capability needed to read or delete that run.
