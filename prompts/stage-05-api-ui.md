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
