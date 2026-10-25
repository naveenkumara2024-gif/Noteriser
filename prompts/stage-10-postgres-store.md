# Stage 10 — Postgres run store (Prisma)

**Goal:** runs can be stored in Prisma Postgres. `src/core` does not change, the pipeline does not change, and with `DATABASE_URL` unset the app behaves exactly as it does today (SQLite live, memory in fake mode). No UI change in this stage.

**Status:** DRAFT, waiting for the user's approval. Do not start until it is approved and the preconditions below are met.

## Preconditions (ask; do not assume)
1. **Stage 6 is still 🟦** (manual screen-reader pass open). CLAUDE.md §6 allows one 🟦 at a time. Get the user's written go-ahead (as was done for stages 7–9) and record it in `STAGE.md`.
2. **A database to point at.** Either the user puts `DATABASE_URL` for their Prisma Postgres in `.env.local` themselves, or they agree to a local `prisma dev` database for this stage. Never ask the user to paste a connection string or key into chat. Never print it or log it: it contains a password.
3. **Baseline.** Record `git diff --stat -- src/core` and `npm run check` / `npm run e2e` counts at the start (the tree already has uncommitted work). The acceptance criterion "src/core untouched" is measured against this baseline. Do not commit unless the user asks (memory: no commits).

## Read first
`CLAUDE.md` §1 (invariants 3, 7, 8), §2, §6, §7, §8 · `src/core/ports/store.ts` · `src/store/sqlite.ts` (its two migrations are the schema to mirror) · `src/store/{memory,jsonl,purge}.ts` · `tests/store/` (the contract tests) · `tests/app/privacy.test.ts` · `src/app/server/runtime.ts` · the installed Prisma docs/README under `node_modules`. Memory of Prisma's API is not evidence: Prisma 7 changed config, generator and adapter handling, so read what is installed before writing anything.

## Versions (checked 2026-10-25; re-check with `npm view`)
- The `prisma` CLI's `latest` dist-tag is **8.0.0-rc.27, a release candidate. Do not use it.** `@prisma/client` `latest` is **7.10.1**, and `prisma@7.10.1` exists (tag `prev`).
- Pin all three to exactly 7.10.1 with `--save-exact`: `@prisma/client`, `@prisma/adapter-pg` (pulls `pg` 8), and `prisma` (devDependency). Engines allow Node ≥ 22.12.
- TypeScript stays 6.0.3. If the generated client does not typecheck under it, stop and report; do not change TypeScript.

## Build
1. **Amend `CLAUDE.md` first** (the user approves this prompt, which approves the amendment): §2 table gets a Prisma row and "Explicitly not used" changes from "an ORM" to "an ORM other than Prisma, which is used only for the Postgres store"; §3 adds `prisma/` and `src/store/prisma.ts`; §5 adds the `db:*` and `test:db` commands; §8 gets a Prisma gotcha line. Add a decisions-log row in `STAGE.md`. Also update the STAGE.md decision "no ORM".
2. **Schema** `prisma/schema.prisma` mirroring both SQLite migrations: `Run` (id text PK, createdAt, status, `doc` Json?, `result` Json?), `RunEvent` (runId, seq; PK both), `RunDraft` and `RunVerification` (runId, itemId, attempt; PK all three; payload Json), `RunFeedback` (serial id, runId, itemId, kind, note, at). Every child has an FK to `Run` with `onDelete: Cascade`. Index on `Run.createdAt`. Use `Json` (jsonb) for payloads: the core owns their shape, the database does not.
3. **Config and client generation.** `prisma.config.ts` reads `.env.local` for CLI commands (Node's built-in `process.loadEnvFile`, guarded for a missing file; no `dotenv` dependency). Generated client goes to a gitignored folder under `src/store/`; Biome ignores it. npm 11 blocks install scripts, so **do not rely on `postinstall`**: add `db:generate` and make `typecheck` run it first, the same way it already runs `next typegen`. A fresh clone must pass `npm run check` with no database and no network.
4. **`src/store/prisma.ts`: `PrismaRunStore implements RunStore`.** Same observable behaviour as `SqliteRunStore`: duplicate run id rejected; `appendEvent`, `saveDrafts`, `saveVerifications` idempotent per key; `saveResult` sets status; `addFeedback` returns false for an unknown run; `deleteRun` cascades; `purgeOlderThan(cutoff)` returns the count; `exportJsonl` reuses `toJsonl`/`toStoredEvent`; `getRun` ordering matches SQLite (events by seq, drafts and verifications by item id then attempt, feedback by `at` then id). Create one `PrismaClient` with the `PrismaPg` adapter, kept on `globalThis` like the runtime. Import it lazily in the runtime like the SQLite store. Log run ids and counts only; never source text, claims, notes or the URL.
5. **Store selection** as a small pure function with a unit test: fake mode → memory; live with `DATABASE_URL` → Prisma; live without it → SQLite at `NOTERISER_DB`, as today. The startup log names which store was chosen, never the URL. A failed connection at startup gives one message that names the variable (`DATABASE_URL`), not its value, and goes through the existing `runtimeOrError` path (503, reason kept out of the response).
6. **Latency check.** Find out whether the pipeline awaits `appendEvent` for every event (read `src/core/pipeline`; do not change it). Time the fake fixture run with SQLite and with Postgres, once local and once against the user's remote database if they have one. If Postgres adds more than 10% or 2 s, buffer events inside `PrismaRunStore` (flush on `saveResult`, `getRun`, `deleteRun` and a short timer; order by `seq` preserved) and document that a crash can lose the audit tail. Report both timings. Do not tune before measuring.
7. **Privacy honesty.** The SQLite tests prove purged text is gone from the file's bytes (`secure_delete`, WAL checkpoint). That cannot be proven for Postgres. Search `README.md`, `docs/`, `src/ui/copy.ts` and `eval/` for any claim that depends on it and make the wording true for each store. For Postgres test the observable thing instead: after `deleteRun` or a purge, a query finds no row in any table. Say in the README that deletion is logical until the database vacuums and that managed-database backups may keep data for a period; **look up and state the provider's actual retention, do not guess.** Record it under residual risks.
8. **Docker and docs.** Dockerfile build stage runs `prisma generate` (no database access at build); runtime takes `DATABASE_URL`. `.env.example` gets a placeholder-only `DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require`. README storage section. Scripts: `db:generate`, `db:migrate` (`prisma migrate dev`), `db:deploy`, `test:db`. Commit the generated migration SQL files.
9. **`scripts/run.ts`** gains `--store memory|sqlite|postgres` so the fixture run can be done against each store.

## Tests
- **Contract tests** (`tests/store/`) run a third time against `PrismaRunStore`, **only** when `DATABASE_URL_TEST` is set, through `npm run test:db`. `npm run check` stays database-free (tests never need a key or a database).
- Test-database safety: use a dedicated random schema per test file and drop it afterwards; refuse to run if `DATABASE_URL_TEST` equals `DATABASE_URL`.
- `tests/architecture.test.ts`: `@prisma/*` and `pg` forbidden in `src/core` and `src/ui`, allowed only in `src/store`. Add a negative test showing the checker catches them.
- Store-selection unit test; a log test with a sentinel in the connection string proving it never reaches a log line or an error response.

## Gate (all must pass; paste real output)
`npm run check` (no DB) · `npm run test:db` green against `prisma dev` or the user's database · `npm run e2e` with the same pass count as the baseline and **no e2e file edited** · `npm run build` · `npx tsx scripts/run.ts fixtures/lecture7.md --fake --store postgres` reconciles (24 → 18/1/5) · `git diff --stat -- src/core` equals the baseline (empty difference).

## Report
Timings (SQLite vs Postgres), what was proven vs not (physical erasure, backups), what was not run, the updated STAGE.md row.
