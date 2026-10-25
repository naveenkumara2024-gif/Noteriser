# Stage 13 — Restyle the remaining pages

**Goal:** the pages Stage 12 did not redesign (progress/results, removed panel, export menu, read-aloud bar, plain-language toggle, and the Stage 11 pages: sign-in, sign-up, My runs, Account) adopt the visual language Stage 12 established (see `prompts/stage-12-app-shell-main-page.md` and the reference in `docs/reference/main-page.webp`), with **no change to behaviour, to what a verdict means, or to any accessibility gate**.

**Status:** DRAFT, waiting for the user's approval. Needs Stage 12 ✅ (and Stage 11 ✅ for the account pages). Same preconditions as Stage 10. The design direction is the reference image; there is nothing left to invent. If a page needs a pattern the reference does not show (a verdict card, a source panel), design it from Stage 12's tokens and show a screenshot for approval before wiring it.

## Read first
`CLAUDE.md` §1 (6, 7), §7 (accessibility is a gate), §8 (display settings, print, reflow notes) · `src/app/globals.css` · `src/app/layout.tsx` · `src/ui/{copy,settings,StatusBadge,DisplaySettings,HomeForm}.ts*` · `src/ui/results/*` · `docs/screenshots/` (the "before") · `docs/screen-reader-checklist.md`.

## Constraints (a change that breaks one is a bug, whatever else it improves)
- **Invariant 6:** flags are text + icon, never colour alone (`StatusBadge`, selected chips, cited sentences keep their non-colour cues). The persistent trust notice appears on **every** page, including auth pages, in words.
- **Invariant 3 on screen:** the Removed panel stays reachable, and the report counts keep showing `generated = supported + partial + removed`.
- Display settings keep working and stay the single mechanism: `<html>` attributes set by the head script before paint (`src/ui/settings.ts`); text size scales the root rem; 200% text at 320 px reflows (WCAG 1.4.4/1.4.10); text-spacing overrides (1.4.12) do not clip; targets ≥ 24 px; visible focus; skip link; one `<h1>` per page, no skipped levels; landmarks (`header`, `nav` with a label, `main`).
- Contrast 4.5:1 normal and 7:1 in high contrast; `forced-colors` and `prefers-contrast` still handled; dark mode and the Atkinson readable font still offered.
- Everything stays on our own origin: **no CDN, no web fonts, no icon fonts, no analytics.** Fonts are local files; icons are inline SVG. The network-hosts e2e test stays untouched.
- Print: the nav/shell is hidden in print; the Stage 7 print layout and goldens are unchanged. Exports are pure core functions and are not touched.
- Strings stay in `src/ui/copy.ts`. No change to `src/core`, `src/app/api`, `src/app/server`, `src/store`, `src/auth`. If a design needs data the API does not give, stop and ask.

## Build (in this order; run the e2e suite after each step, not only at the end)
1. **Results page**: item cards, status badges, source panel with citation highlight, report card, Removed panel, export menu, read-aloud bar, plain-language toggle, in the Stage 12 tokens. Restyle only; same DOM semantics and the same accessible names. Decide with a screenshot whether the Source column stays in the page or moves into the activity panel as a third tab; if it moves, the citation-highlight e2e tests must pass unchanged.
2. **Auth pages, My runs, Account**: same components as the rest.
3. **Empty, error, loading, 404 and degraded-mode states** (the "verifier degraded" banner must remain unmissable).
4. For a signed-out visitor, an optional short section on the home page that explains the product honestly (flags, citations, what is removed). No testimonials, stats or claims that `eval/RESULTS.md` does not support; quote its real numbers or none.

## Tests
- All existing e2e files pass; edit only selectors for controls that moved, and **list every edit** in the report with the reason. Assertions about behaviour, names and axe results may not be weakened.
- New: landmark/heading-order test; screenshots at 320, 768, 1280 px × light, dark, high-contrast, forced-colours for home, progress, results, removed, sign-in, My runs, written to `docs/screenshots/stage13-*.png` and **viewed** (read the images, do not assume they look right); token-contrast test; a test that no new network host or storage key appears.
- `npm run test` snapshots for `copy.ts` change only deliberately.

## Gate
`npm run check` · `npm run e2e` (all prior tests + new) · `npm run build` · screenshots reviewed · `git diff --stat -- src/core src/app/api src/app/server src/store src/auth` empty.

## Report
Before/after screenshots, every e2e edit and why, what could not be checked (real screen readers, Firefox/Safari), and an updated `docs/screen-reader-checklist.md` for the new shell, which the user must run (as with Stage 6).
