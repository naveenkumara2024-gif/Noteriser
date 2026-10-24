# Stage 6 — Accessibility, text-to-speech, plain-language mode

**Goal:** make the "accessible format" half of the brief real and *tested*, not decorative.

**Read first:** `CLAUDE.md` §1 (invariant 6), §2 (TTS row), §8; lore §3.6, §7.5; `docs/RESEARCH.md` §3. Protocol: CLAUDE.md §6.

## Build
1. **Display settings** (client, persisted in `localStorage`, wrapped in try/catch, applied via CSS variables on `<html>` so there is no flash — set before hydration with a tiny inline script):
   - Theme: system / light / dark / high-contrast; honour `prefers-color-scheme`, `prefers-contrast`, `forced-colors` (system colours, keep borders/focus visible), `prefers-reduced-motion`.
   - Text size 100–200 %; font: system / a readable face loaded with `next/font` (Atkinson Hyperlegible or Lexend). Label it “Readable font”; **make no dyslexia-efficacy claim**.
   - Spacing controls (line-height, paragraph spacing, letter, word) defaulting to ≥ WCAG 1.4.12 minimums (1.5× / 2× / 0.12em / 0.16em) as a “Comfortable” preset.
   - Max line length ≈ 70ch for body text.
2. **Structure**: landmarks (`header/main/nav/aside`), one `h1`, strict heading order, skip link, visible `:focus-visible`, target size ≥ 24×24 CSS px, labels tied to inputs, flags announced as text (“Warning: partial support”). Sections as `<details>`-based chunked disclosures with “Expand all”.
3. **Text-to-speech** (`src/ui/tts.ts`, browser `speechSynthesis`, feature-detected; hide controls if unsupported): play / pause / stop, rate, voice; “Read aloud” per item and for whole Summary or Glossary; **question mode** reads the question, then waits for “Reveal answer”. Item-level highlighting always. Word-level highlighting from `boundary` events only if you confirm in a real browser that events fire; otherwise skip it and note this in STAGE.md. Never read removed items.
4. **Plain-language mode**: pipeline option `plain: true`. After normal acceptance, rewrite each shown item once at a target of ≤ 15 words per sentence and common vocabulary (separate prompt, same evidence fields), then run the **full verifier again** on the rewritten text. Items whose rewrite is not SUPPORTED keep their original text and show “kept original: simplified version could not be verified”. `core/readability.ts` computes Flesch-Kincaid grade locally; the UI shows before → after.
5. Keep the trust notice and flag semantics identical in all modes.

## Tests
- Playwright + axe in each theme (light, dark, high-contrast, forced-colors emulation), each text size extreme, and with the Removed panel and a flagged item open: **zero serious/critical**.
- **WCAG 1.4.12 test**: inject the four spacing overrides via `addStyleTag` (`!important`) and assert no horizontal clipping/overlap on key containers (`scrollWidth <= clientWidth`, bounding boxes of adjacent blocks don't intersect) on the results page.
- **Reflow**: viewport 320 px wide (and 400 % zoom equivalent) → no horizontal scrolling of the page.
- Keyboard-only path through settings, TTS controls and disclosures.
- TTS logic unit-tested against a mocked `speechSynthesis` (queueing, pause/resume, cancel on unmount, skips removed items).
- Plain mode (fake LLM/NLI): readability grade strictly lower on the fixture; every displayed rewritten item is SUPPORTED by the full verifier; a deliberately bad rewrite falls back to the original with the notice.

## Manual step (cannot be automated — mark in STAGE.md, ask the user)
A short checklist for a human to run with NVDA (Windows) or VoiceOver: landmarks navigation, flag announcements, reveal-answer flow, TTS buttons. Stage 6 is ✅ only after the user reports the result or explicitly waives it; record which.

## Constraints
- No colour-only meaning. No auto-playing audio. No new dependencies beyond fonts.

## Gate
`npm run check` · `npm run e2e` (includes the spacing, reflow, axe suites) · readability before/after numbers · screenshots of default and high-contrast.

## Report
Settings model, whether word-level TTS highlighting is supported and in which browsers you tested, plain-mode fallback rate on the fixture.
