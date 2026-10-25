# Master prompt: NoteBridge presentation

Paste everything below the line into an AI that can build slides (Claude, Gamma, ChatGPT, Copilot,
Gemini). Attach the screenshots listed under "ATTACHMENTS". Edit the [BRACKETS] first.

---

## ROLE
You are an expert presentation designer and technical communicator. Build a slide deck for a final-year
project review (viva) of **NoteBridge**, a source-grounded study-aid generator. The speaker is
[YOUR NAME], [COLLEGE / DEPARTMENT], guide [GUIDE NAME], date [DATE].

## GOAL AND AUDIENCE
- Audience: examiners, mixed technical and non-technical. Time: **12 minutes of slides + a 3-minute live
  demo + Q&A**. (Edit if different.)
- After the talk they should remember three things:
  1. **The problem:** AI-written study notes sound right but can be wrong, and a student cannot tell which parts.
  2. **The idea:** every generated item is tied to the exact source sentence, independently verified, and
     if the notes cannot support it, it is flagged or shown as removed. Nothing disappears silently.
  3. **The evidence:** measured results, honest limits, and accessibility built in from the start.
- Tone: confident, plain, honest. No hype. Never claim the system "eliminates hallucination"; say it
  makes unsupported claims **visible** and rejects most of them.

## OUTPUT FORMAT
- 16:9. **16 main slides + 5 backup slides.** If you can create files, produce a `.pptx`. Otherwise output,
  for every slide, exactly this block:
  `Slide n | Title (max 8 words, states the takeaway) | On-slide text (max 3 bullets, max 25 words total) |
  Visual (precise: what, where, which attachment, which callouts) | Speaker notes (60-90 words, written to
  be spoken) | Fact used (which line of the FACT BANK)`.
- Ask me at most 3 questions, and only if something is truly missing. Otherwise proceed with the defaults above.

## FACT BANK (authoritative: use only these facts and numbers; never invent statistics, quotes, users or logos)
**What it is.** Input: instructor-approved lecture notes (paste, .txt, .md, .pdf, .docx). Output: a summary,
a glossary and five practice questions. Every item cites exact source sentences (ids like S2.4).

**Why.** Example drafts the verifier was built to catch (from the lecture on CPU scheduling): an
unsupported claim ("most widely used..."), a reversed claim ("SJF is impossible..."), an invented number
("10 to 100 ms"), and an item that goes beyond the source ("Preemption: forcibly...").

**Pipeline.** Parse notes into numbered sentences -> generate summary, glossary and questions (at the same
time) -> verify every item with four checks -> repair weak items once -> assemble a run report.
**Four checks:** (1) the quoted evidence really exists in the cited sentences; (2) entailment: a local NLI
model (DeBERTa-v3-small, int8) says the claim follows from the evidence; (3) a scan for invented facts
(numbers, names, formulas, unseen words); (4) an independent judge: a different model, ideally a different
company, that sees only the source and the claim.
**Verdicts:** SUPPORTED, PARTIAL (shown, flagged "Check against source" with the reason), UNSUPPORTED,
CONTRADICTED (both removed and listed with the reason).
**Rules that cannot be broken:** nothing is SUPPORTED unless all four checks ran and passed; if a check cannot
run the item is at most PARTIAL and a "verifier degraded" banner shows; counts always reconcile
(generated = supported + partial + removed); flags are text plus an icon, never colour alone; the model sees
only numbered source sentences (closed book); API keys and source text stay on the server and are never
logged; the notes are treated as data, so "ignore previous instructions" inside them is tested and has no effect.

**Product features.** Main page with a composer (paste, upload, drag and drop, Ctrl+Enter); history column
(Timeline and Project views, search, delete); a verification-activity panel showing each stage and a log of
ids and verdict words (never the notes' text); results with flagged items, clickable source citations that
highlight the sentence, a Removed panel, a run report; plain-language mode where every rewrite is re-verified
and is shown only if fully SUPPORTED and not harder to read; read aloud with word highlighting; exports:
Markdown, plain text, Anki flashcards (TSV), print/PDF, audit JSON (owner only); per-item "report a problem".
**Accessibility.** Light, dark and high-contrast themes; text size 100-200%; readable font option; WCAG
text-spacing support; no horizontal scroll at 320 px; keyboard only; forced-colours mode; axe automated
checks at zero serious/critical violations. A manual screen-reader pass is **still to be done** (say so).
**Privacy.** Runs are deleted after 24 hours or on request; no analytics; no third-party requests; dictation
(if offered) is on-device only.

**Stack.** Next.js 16, React 19, TypeScript (strict), Tailwind 4, TypeBox schemas, pi-ai for model access,
Transformers.js for the local NLI and embeddings, node:sqlite behind a store interface, pino logging,
Vitest, Playwright with axe, Biome. Architecture: a **pure, deterministic core** (no framework imports,
everything injected: model, NLI, clock, store) so the whole pipeline is tested with fakes; adapters for
models, NLP and storage; the web app on top.

**Testing and evaluation (measured).**
- 842 unit and integration tests; 8 real-model tests; 134 browser end-to-end tests (including accessibility
  checks in light, dark, high contrast, 320 px and 200% text).
- Evaluation set: 24 labelled cases, 144 drafts including planted errors, split into development and test.
  The test split is reported on, never tuned on.
- On the held-out test split with a live judge: **all 36 of 36 planted errors caught** (33 rejected outright),
  **citation validity 100%**, but the **over-flag rate is 27.8%** (good items wrongly flagged), which **misses
  the 15% target**. A threshold sweep found no setting that reaches 15%.
- Offline run with a scripted judge over 153 drafts: recall 91.7% (66 of 72).
- Not measured: human-reviewed faithfulness and inter-reviewer agreement.

**Speed and cost (one live run per setup on the sample lecture; indicative, n = 1).**
- Free models: about 12 minutes per run, and free tiers hit daily quotas.
- Now: **24 seconds, $0.0081 per run**: Claude Haiku 5.5 writes, GPT-4o-mini checks (different companies).
  27 items generated: 24 supported, 0 flagged, 3 valid-but-unneeded questions removed; counts reconcile;
  100% of sections covered. About 600 runs per $5.
- What changed: the three generators now run at the same time; a cap of 8 model calls in flight; a used-up
  provider quota is not retried; models load at server start. (At a fixed simulated 300 ms per call the
  pipeline went from 3.43 s to 2.49 s.)
- Two cheaper pairs were tried and rejected: one wrote only 13 items and 1 question; the other was twice as slow
  with more flagged items.

**Honest limitations.** Over-flagging (27.8%); recall rests on errors planted by one author; the judge model
is nondeterministic and was run once per configuration; scope-shift errors depend on the judge being good;
content security policy still allows inline scripts; run links are readable by anyone who has the link;
`node:sqlite` is experimental; Docker image not built; manual screen-reader pass pending; only Chromium tested.
**Next steps (planned, not done):** Postgres store, user accounts and run ownership, restyle of the results
page in the new design, human review to measure faithfulness, screen-reader pass.

## SLIDE PLAN (16 main)
1. **Title.** "NoteBridge: study aids you can check." Subtitle: source-grounded study aids with independent
   verification. Name, college, guide, date.
2. **AI notes sound right, and can be wrong.** The four example drafts above as fake "cards", each stamped with
   what is wrong (unsupported / reversed / invented number / beyond source). Visual: four cards, one idea.
3. **The idea in one sentence.** Instructor notes in -> summary, glossary, five questions out; each item points
   to the exact sentence. Visual: input page -> output page with a citation chip and an arrow to the source line.
4. **How it works.** Horizontal flow with icons: Parse, Generate, Verify, Repair, Report. Mark that generation
   runs three artefacts at once.
5. **Four checks decide every verdict.** Four tiles (quote exists, entailment, no invented facts, independent
   judge) and the four verdict chips with icon + word (check Supported, warning Check against source,
   cross Removed). Callout: "all four must pass to be SUPPORTED".
6. **Trust is built in, not added.** Five short rules (nothing disappears silently, counts reconcile, flags are
   words + icon, closed-book, secrets and notes stay on the server). Visual: a reconcile equation
   generated = supported + partial + removed with the real numbers 27 = 24 + 0 + 3.
7. **The product.** Screenshot of the main page (annotate: composer, history, activity panel, trust notice).
8. **What the student sees.** Screenshot of a results page; callouts: flagged item with reason, citation chip,
   Removed panel, run report.
9. **Verification is visible.** Screenshot of the running state with the activity panel; one line: "ids and
   verdict words only, never the notes' text".
10. **Accessible by design.** Icon grid (themes, text size, readable font, keyboard, reflow, read aloud, plain
    language). Small honest note: manual screen-reader pass pending.
11. **From screen to study routine.** Exports: Markdown, text, Anki TSV, print/PDF, audit JSON. One screenshot
    or icon row.
12. **Architecture.** Layer diagram: pure core in the middle; ports; adapters (models, NLI, store) on one side;
    web app and UI on the other. Tagline: "the whole pipeline is tested without a network".
13. **Evidence.** KPI tiles: 842 + 8 + 134 tests; 36/36 planted errors caught; 100% citation validity; and, **at
    the same size and prominence**, 27.8% over-flag vs the 15% target. Footnote on the test-split rule.
14. **Fast and cheap enough to use.** Before/after bar chart (about 12 min -> 24 s) and cost per run $0.0081;
    one line on the two-company writer/checker pair; footnote "one live run per setup, n = 1".
15. **LIVE DEMO (3 min).** Run-sheet on the slide: 1 load the sample lecture; 2 Make study aids; 3 watch the
    activity panel; 4 open results, point at the flagged item and its reason; 5 click a citation; 6 open
    Removed; 7 toggle plain language; 8 export. Speaker notes include a fallback: open the run already in the
    history, or run in demo mode (scripted, instant).
16. **Limits, next steps, thank you.** Left: the honest limitations (3 bullets). Right: next steps (3 bullets).
    Bottom: Q&A and repository.

**Backup slides (after the end):** B1 verdict decision table; B2 prompt-injection and degraded-mode behaviour;
B3 how the evaluation was built (planted errors, dev/test split, threshold sweep found no feasible setting);
B4 privacy (24 h purge, delete on request, no analytics, own-origin only); B5 likely examiner questions with
short answers (why a local NLI model, why a separate judge, why over-flag happens, what is not measured).

## DESIGN SYSTEM
- Match the product: calm light-grey surfaces (about #E4E4E4 to #C6C6C6), near-black text (#171717), one dark
  grey accent (#4A4A4A). Status colours only for status, and **always with an icon and a word**.
- Font: Inter (fallback Segoe UI / Calibri). Titles 40-44 pt, body at least 20 pt, captions at least 14 pt.
  Left-aligned, generous white space, one idea per slide, takeaway title on every slide.
- Contrast at least 4.5:1 for text. Outline icons (Lucide style), 1.5 px stroke. No stock photos, no clip art,
  no emoji, no gradients behind text.
- Screenshots: rounded corners, thin border, numbered callouts. Every image has alt text. Use the same slide
  grid, and put the slide number bottom right.
- Charts: label values directly, no 3D, one accent colour; the limitation (over-flag) is shown as plainly as
  the strengths.

## ATTACHMENTS (screenshots in the repo, `docs/screenshots/`)
`stage12-home.png` (main page) · `stage12-running.png` and `stage12-running-details.png` (activity panel) ·
`stage12-results.png`, `stage12-results-panel.png`, `stage12-project.png`, `stage12-bell.png` (results and
history) · `stage12-home-dark.png`, `stage12-home-contrast.png`, `stage12-home-text200.png`,
`stage12-home-narrow.png` (accessibility modes) · `stage5-removed.png` (Removed panel) ·
`stage6-default-plain.png` (plain-language view) · `stage7-print.png` (print/PDF export).

## RULES
- Use only the FACT BANK. If a slide needs a fact that is not there, write [MISSING: what] instead of inventing it.
- Keep "n = 1" on the speed numbers. Present results as measured on this project's own evaluation set.
- Do not use the words "guaranteed", "eliminates", "100% accurate" or "hallucination-free".
- Slide text must never be a paragraph; put explanations in the speaker notes.

## SELF-CHECK BEFORE YOU ANSWER
Every number traces to the FACT BANK; no slide has more than 3 bullets; every screenshot has alt text; the
limitations slide is as visible as the evidence slide; speaking time is about 12 minutes (about 45 seconds per
main slide, the demo slide excluded); the deck works in black and white.
