# Stage 11 — Accounts and run ownership

**Goal:** people can create an account and sign in. A signed-in user owns the runs they create, sees them in "My runs", and is the only one who can delete them or download their audit file. Guests keep working exactly as today unless `AUTH_REQUIRED=true`. The verifier, pipeline and `src/core` are untouched.

**Status:** DRAFT, waiting for the user's approval. Needs Stage 10 ✅ (Postgres store). Same preconditions as Stage 10 (Stage 6 go-ahead, no secrets in chat, baseline numbers, no commits).

## Decisions to confirm at approval (recommended answer first)
1. **Library: Better Auth** (`better-auth` 1.7.12, the stable `latest`). Auth.js v5 is still a beta (`next-auth@5.0.0-beta.32`; its `latest` is v4) and we do not pin betas. Pin exactly; read its installed docs before writing the integration.
2. **Method: email + password only.** No OAuth (a Google redirect would break the "every request goes to our own origin" test and add a data processor). **No email verification and no emailed password reset** (both need a mail provider, another processor). Consequence, to be written in the README and residual risks: anyone can register any email address, and a forgotten password cannot be recovered by the user (provide an operator script, see 9).
3. **Guests allowed by default** (`AUTH_REQUIRED=false`). A run link stays a read capability, as in Stage 5/9: instructors share results with students, and students are this tool's audience. `AUTH_REQUIRED=true` makes `POST /api/runs` answer 401 `auth_required` for guests. If you want login-only from day one, say so before approval; the existing 110 e2e tests would then need a login step.
4. **Run read access unchanged** (anyone with the link). What changes is who may *delete* and who may download the *audit* file (below).

## Read first
`CLAUDE.md` §1 (6, 7, 8), §7, §9 (accounts are listed there as out of scope: amend it now) · `src/app/server/{runs,owner,runtime,export,feedback,errors}.ts` · `tests/app/*` · `e2e/security.spec.ts` · `e2e/helpers.ts` · Better Auth's installed docs · `node_modules/next/dist/docs/` for Next 16 request interception (**Next 16 may have renamed `middleware.ts`; check, do not assume**).

## Build
1. **Amend `CLAUDE.md` §9** (accounts are now in scope; roles and an instructor dashboard still are not), §2 table (auth row), §3 (`src/auth/`), §8 (gotchas). Decisions-log rows in `STAGE.md`.
2. **Schema.** Generate Better Auth's models (`User`, `Session`, `Account`, `Verification`) into `prisma/schema.prisma` with its CLI, then review the result by hand. Add `Run.ownerId String?` → `User`, **`onDelete: Cascade`** (deleting an account deletes its runs and their source text). Add nullable `Run.title` and summary counts (`generated`, `supported`, `partial`, `removed`) filled in `saveResult`, so "My runs" never loads whole result documents. New migration; never edit a shipped one.
3. **`src/auth/`** (adapter layer, not core): `createAuth({ database, secret, baseUrl, secureCookies })` with the Prisma adapter in live mode and Better Auth's in-memory adapter in fake mode (verify it exists), so `LLM_MODE=fake` and the e2e suite need **no database**. Password hashing: use the library's default if it is a pure-JS/WASM scrypt (no native module; no install script). Cookies HttpOnly, SameSite=Lax, Secure on https. Sessions 7 days, sliding. `trustedOrigins` = our own base URL only. Passwords 10–128 characters, no composition rules, paste allowed. Enable the library's rate limit on sign-in and sign-up (≈5/min/IP) in addition to the run limiter.
4. **Route** `src/app/api/auth/[...all]/route.ts` with `runtime = "nodejs"`.
5. **Env** (TypeBox, in `src/config/env.ts`, fail fast, all errors at once): `BETTER_AUTH_SECRET` (≥ 32 chars, required in live mode with `DATABASE_URL`), `BETTER_AUTH_URL`, `AUTH_REQUIRED`. Live mode without `DATABASE_URL` → auth is **off**, the UI shows no sign-in controls, and the app is exactly today's app. Placeholders only in `.env.example`.
6. **Viewer and ownership, without touching core.**
   - `getViewer(request): Promise<{ kind: "user"; id: string; email: string } | { kind: "guest" }>` is an injected dependency on `Runtime` (like `store`), so handler tests use a fake. Route files only wire it.
   - New port `src/core/ports/ownership.ts`: `ownerOf(runId)`, `listByOwner(userId, { limit, cursor })` → `RunSummary[]`; implementations in `src/store/` (Prisma, memory).
   - In `createRun`, wrap the store for that request in a small decorator (`src/app/server/owned-store.ts`) whose `createRun` calls the real one and then records the owner. `runPipeline` receives the decorated store and never learns about users.
7. **Access rules** (one table in code and in the docs; the test in "Tests" walks every row):

   | Action | Guest-made run | User-made run |
   |---|---|---|
   | create run | allowed (401 if `AUTH_REQUIRED`) | owner = that user |
   | read page, GET, md/txt/tsv/print export, feedback | link | link |
   | audit JSON | owner cookie (as today) | that user only |
   | **DELETE** | **owner cookie (tightened: today anyone with the id can delete)** | that user only |
   | list | n/a | "My runs", that user only |

   A guest run is not adopted when the person later signs up. Say so in the UI copy.
8. **Account deletion:** `/account` has "Delete my account and all my runs", requiring the password again. It reuses the cascade; nothing is soft-deleted.
9. **Operator script** `scripts/auth-reset-password.ts <email>`: prints a new random password once to the terminal. Documented as the only recovery path.
10. **Pages (functional, existing design tokens; Stage 12 restyles them):** `/sign-in`, `/sign-up`, `/runs` (My runs; empty state), `/account`; header shows "Sign in" or the account menu; the persistent trust notice stays on every page including these. Rules: real `<label>`s; `autocomplete` values `email`, `current-password`, `new-password` (WCAG 1.3.5); errors named in words with an icon, `role="alert"`, focus moved to the first error, `aria-describedby` on the field (3.3.1); a show-password toggle that is a real button; **no CAPTCHA or puzzle** (3.3.8); never disable the submit button, use `aria-busy`. `?next=` accepts relative same-origin paths only (test open-redirect attempts: `//evil.com`, `https://evil.com`, `/\evil.com`). All strings in `src/ui/copy.ts`.
11. **Optimistic redirect** (only when `AUTH_REQUIRED`): Next's request interceptor may redirect guests from `/runs` to sign-in, but a cookie-presence check there is not authorisation. Every handler and server component re-checks the viewer.
12. **Privacy and logging (invariant 7):** extend pino `redact` with `email`, `password`, `token`, `cookie`, `authorization`, `secret`; auth route bodies are never logged; log user id only. Add a sentinel-based redaction test. Update the README privacy section (what an account stores: email, password hash, sessions, run ownership; deleting the account deletes runs) and the e2e storage assertion in `e2e/security.spec.ts` to allow the session cookie, **and nothing else**.

## Tests
- **Unit, table-driven:** access matrix = every row above × {guest, run owner, other user, anonymous with the owner cookie} → expected status. `getViewer` fakes. Env validation (short secret, missing URL). Owned-store decorator (owner recorded once; failure to record does not lose the run, and is a visible warning). Ownership contract on memory and Prisma (the latter under `test:db`). Open-redirect cases. Redaction sentinel.
- **Architecture:** Better Auth imported only in `src/auth` and the one route; never in `src/core` or `src/ui`.
- **E2E (fake mode, in-memory auth):** sign up → start a run → it appears in My runs → sign out → the run link still opens → as a guest, DELETE is refused → sign in as a second user: audit refused, run not listed, DELETE refused → sign back in, delete → 404. A second Playwright project/web server on port 3101 with `AUTH_REQUIRED=true`: guest `POST /api/runs` → 401 and the form says why.
- **Accessibility:** axe zero serious/critical on sign-in, sign-up, My runs, account (empty and error states) in light, dark, high-contrast and 320 px; keyboard-only sign-in and sign-up; text-spacing test on the forms.
- The **existing e2e files pass unmodified** except the delete-by-guest and storage assertions, which change deliberately; list each edit in the report.

## Gate
`npm run check` · `npm run test:db` · `npm run e2e` (baseline count + new tests, nothing removed) · `npm run build && npm start` with `LLM_MODE=fake`, walk sign-up → run → My runs → delete by hand · `git diff --stat -- src/core` shows only the new `ports/ownership.ts` · `npm run eval -- --judge=fake` and `npm run eval:ci` unchanged.

## Report
Access table as built, residual risks (no email verification, no recovery by email, sign-up reveals whether an email exists unless the library prevents it: say which, in-memory run limiter not shared across instances), what was not run.
