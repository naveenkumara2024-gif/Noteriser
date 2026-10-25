# Stage 12 — App shell and main page (from the reference image)

**Goal:** the main page and the frame around every page look like the reference design (a soft, monochrome, embossed three-column app: history on the left, a large headline and composer in the middle, an activity panel on the right), and **every control in it does something real in NoteBridge**. No behaviour of the pipeline, the API contracts that exist today, the verifier, the exports or the results page content changes.

**Status:** ✅ built 2026-10-25 (approved by the user the same day); see "As built" at the end. Replaces the earlier generic "UI refresh" draft (now Stage 13, "restyle the remaining pages"). Does **not** need Stage 10 or 11: the account items appear only when Stage 11 exists (see "Viewer states"). Same working rules as before: Stage 6 go-ahead recorded, no secrets in chat, baseline numbers recorded first, no commits unless asked.

Reference image: `C:\Users\navas\AppData\Local\Temp\claude\c--Users-navas-Downloads-vibecode-Noteriser\02a578b2-1001-449b-ac62-c7c090ed6a74\images\1.webp` (1504 × 1128). **Copy it to `docs/reference/main-page.webp` first** and read it again before each step; do not work from this text alone.

## Decisions this prompt makes (approving it approves them; say so if you disagree)
| # | Decision | Why |
|---|---|---|
| D1 | Brand is **NoteBridge** (from `copy.productName`), not "CHAT.LY". The logo mark is a simple inline SVG drawn for NoteBridge (outlined rounded square holding a small arch/bridge over two lines), in the same 1.5 px line style. Send a logo if you have one. | The reference's brand is someone else's. |
| D2 | **"Plus" plan label and "Upgrade to Pro" are not built.** There are no plans or billing, and a fake upgrade button would be dishonest. The slot becomes a real **"New study aid"** button; the account card shows real information (below). | Truthfulness. |
| D3 | The **Project** tab groups your runs by their source document's title (derived; no folders, no new tables). | The app has no projects; this is useful and costs no data model. |
| D4 | **History for guests** = the runs this browser started (found through the existing per-run owner cookies). With Stage 11 a signed-in user's list is added. | Works today with no new storage in the browser. |
| D5 | The **microphone** is *on-device* dictation only, and is **hidden** when the browser cannot do that. | Browser cloud speech recognition would send the lecture's audio to a third party, which breaks invariant 7 and the no-third-party promise. |
| D6 | Headline: "What are you / studying / today?" (three staggered lines, one `<h1>`). | The reference's words are chat-specific. |
| D7 | Default font becomes a **locally bundled Inter Variable** (SIL OFL, licence file kept beside it, latin subset, `next/font/local`); "Readable font (Atkinson Hyperlegible)" stays an option. | Closest match to the reference's neutral grotesque with no network. |
| D8 | Icons come from `lucide-react` (ISC licence, inline SVG, no network), pinned exactly after `npm view`; if it does not work with React 19.3 / Turbopack, hand-copy the used icons into `src/ui/icons.tsx` with the licence notice. | Same thin outline style as the reference; no icon font. |
| D9 | The **results page content is not redesigned here** (it moves into the new frame unchanged and is restyled in Stage 13). On results pages the right panel starts closed so the results layout keeps today's width. | Limits risk to the 110 existing e2e tests. |

## Read first
`CLAUDE.md` §1 (invariants 1–8), §7, §8 (display settings, reflow, print) · `src/app/layout.tsx`, `globals.css` · `src/ui/{HomeForm,RunProgress,use-run,progress,copy,settings,SettingsProvider,DisplaySettings,StatusBadge}.ts*` · `src/ui/results/{ResultsView,DeleteRun,ReportCard}.tsx` · `src/app/server/{runs,owner,runtime}.ts`, `src/app/limits.ts` · `src/store/{sqlite,memory}.ts` · `e2e/helpers.ts` and a skim of every e2e file (231 locators depend on names; see "Compatibility contract").

---

## 1. What the reference shows (analysis; measurements are estimated by eye at 1504 × 1128, not measured)

**Canvas.** Flat dark charcoal backdrop (≈ #4b4b4b). The app is one rounded window (radius ≈ 28 px) inset 75 px left/right and 56 px top/bottom (≈ 1353 × 1016), with a faint drop shadow. Inside, a vertical gradient from light grey at the top (≈ #e3e3e3) to mid grey at the bottom (≈ #bdbdbd). Everything is grey: no accent colour anywhere. Depth comes from soft raised/inset shadows plus 1 px white highlights (a "neumorphic / frosted clay" look).

**Zones (left to right).**
| Zone | x range | Size | Contents |
|---|---|---|---|
| Top bar | full width, y 56–112 | 56 px high, thin bottom rule | left: logo mark + wordmark "CHAT.LY" (uppercase, ~17 px); right: bell icon, gear icon, user pill (black circular avatar with a white asterisk glyph, "Marcin K.", chevron-down) |
| History sidebar | 75–355 | 280 px wide, 22 px padding, hairline right border | title "History" + collapse icon (panel-left) · segmented pill **Timeline** (clock icon, raised/active) / **Project** (folder icon) · search pill (magnifier, "Search", "⌘ K" hint) · label "Your Chats" · 10 rows (title left, relative time "1h 3h 1d … 1w" right; first row highlighted as a pill) · bottom: account card pill (avatar, name, "Plus", up/down chevrons) and outlined pill button with crown icon "Upgrade to Pro" |
| Centre | 355–1073 | ≈ 718 px | huge headline over three staggered lines, **the composer pill sits between line 1 and line 2**; faint 1 px construction lines (two horizontal at y ≈ 450 and 627, two vertical at x ≈ 467 and 962) behind them |
| Activity panel | 1075–1428 | ≈ 353 px, hairline left border | title "Tool Execution" + close X · segmented pill **Summary** (document icon) / **Details** (info-in-circle icon) · empty body |

**Headline.** ~90 px, medium weight, tight tracking (−0.02 em), line-height ≈ 1.0, letter-pressed (debossed) grey-on-grey with a light lower edge and dark upper edge. Lines are staggered: line 1 starts at the left of a centred block, line 2 is shifted right ≈ 75 px, line 3 right-aligned under line 2's end.

**Composer.** 658 × 60 px pill (radius 30), double rim (white highlight outside, soft dark inside). Left: 32 px circular "+" button. Placeholder "Ask AI anything…" (13 px, grey). Right: microphone icon (18 px), then a 34 px round, darker gradient button with a white waveform (audio-bars) glyph.

**Icon style.** Thin (≈ 1.5 px) outline, 16–18 px, near-black (#2b2b2b), rounded caps: Lucide-like.

**Type.** Neutral grotesque (looks like SF Pro/Inter): row text 13 px, section labels 11–12 px, times 10 px, "Plus" 9 px.

### Defects of the reference that must **not** be copied (they fail this project's accessibility gate)
| Reference | Problem | Required here |
|---|---|---|
| Headline ≈ 1.6:1 against its background | fails WCAG 1.4.3 (large text needs 3:1) | Fill chosen so it is **≥ 3:1 against the lightest and the darkest background behind it** in light and dark, **≥ 7:1** in high contrast. The emboss comes from text-shadow highlights, not from low contrast. |
| Placeholder, "Your Chats", row times, "Plus": ≈ 2–2.5:1, 9–10 px | fails 1.4.3, unreadable | ≥ 4.5:1 (≥ 7:1 high contrast), ≥ 12 px for anything that carries information. The row time keeps its short form visually and carries the full phrase in `aria-label`/`title` ("3 hours ago"). |
| Pill outlines ≈ 1.2:1 | fails 1.4.11 (control boundaries 3:1) | Every control has a 1 px border (or equivalent) at **≥ 3:1** against what is next to it, *in addition to* the soft shadows. |
| Active state shown only by a raised pill / lighter fill | colour/shadow-only cue (invariant 6 spirit) | Active tab, active row: `aria-selected` / `aria-current="page"` **plus** a non-colour cue (bold + a 3 px leading bar or check). |
| Icon-only buttons | no names | Every icon-only control has an accessible name and a tooltip (see 4) |
| Depth drawn with box-shadow | shadows disappear in `forced-colors` | Real `border` on every control so forced-colors still shows edges. |
| Fixed pixel layout, overlapped text | breaks at 200 % text / 320 px | Stacked fallback layout (see 6). |

---

## 2. Icons required (inline SVG, 1.5 px stroke, `aria-hidden` unless the icon is the only content)
Logo mark (custom) · **bell** · **settings** (gear) · **panel-left** (history toggle; same glyph as the reference) · **panel-right** (activity toggle) · **chevron-down** (menus) · **chevrons-up-down** (account card) · **clock** (Timeline) · **folder** (Project; **folder-open** for an expanded group) · **search** · **plus** (upload; and "New study aid") · **file-text** (Summary tab, file chip, sample lecture) · **info** (Details tab) · **x** (close panel, remove file, clear search) · **mic** and **mic-off** · **arrow-up** (make study aids) · **square** (cancel) · **audio-lines** (animated "working" bars inside the round button while a run is active, static under `prefers-reduced-motion`) · **trash-2** (delete run) · status icons for runs and stages: **check-circle**, **alert-triangle** (flagged/degraded), **x-circle** (failed/removed), **minus-circle** (cancelled/incomplete), **loader** (running; spins, static under reduced motion) · **circle-dashed** (stage waiting) · **user**, **log-in**, **log-out** (account menu; used from Stage 11) · **menu** (opens the history drawer on narrow screens) · **command** glyph for the ⌘ hint on Apple devices (text "Ctrl K" elsewhere).

## 3. Every control and what it does

### 3.1 Top bar (`<header>`, role banner, hidden in print)
| Control | Behaviour | Notes |
|---|---|---|
| Logo + "NoteBridge" | Link to `/`. | Wordmark text from `copy.productName`. |
| **History toggle** (panel-left; on narrow screens "menu") | Shows/hides the sidebar (inline column ≥ 64 rem container; modal drawer below). `aria-expanded`, `aria-controls`. | Choice remembered in the display-settings object (see 5.5). |
| **Activity toggle** (panel-right) | Shows/hides the right panel (inline ≥ 80 rem; modal drawer below). | Auto-opens when a run starts. |
| **Trust notice** | The persistent notice (invariant 6) moves from the old header into a slim `role="note"` strip directly under the top bar, full width, with an info icon, on **every** page, not dismissible, wraps at any width. | Words, not colour. Printed text unchanged. |
| **Bell** | Opens a popover "Recent activity": the last five run outcomes for this viewer from the history list ("Lecture 7 finished: 18 supported, 1 to check, 5 removed"), plus any notice from the current session (limit reached, verifier degraded, run failed). Empty state: "Nothing new." The accessible name includes the unread count ("Notifications, 2 new"); an unread dot is never the only cue. | Client-side only: it reads data the history API already returns and events the run already emitted; **no new persistence**. "Unread" = finished while this tab was open and not yet viewed. |
| **Gear** | Opens **Display settings** (theme, text size, font, spacing, reset: the existing component, moved into a popover). It **stays a `<details>` whose `<summary>` text content is "Display settings"** (icon + visually hidden text) so `openSettings()` in `e2e/helpers.ts` keeps working. Esc and outside click close it and return focus to the summary. | |
| **User pill** | Not shown when auth is off. Guest + auth available (Stage 11): "Sign in". Signed in: avatar (initials in a circle, never an image fetched from elsewhere) + short name + chevron → menu: My runs, Account, Sign out. | Hidden entirely until Stage 11 exists. |

### 3.2 History sidebar (`<nav aria-label="History">`; the "History" heading is an `<h2>`)
| Control | Behaviour | Data / notes |
|---|---|---|
| Collapse icon (panel-left, in the sidebar header) | Same state as the top-bar toggle. | |
| **Timeline / Project** segmented control | `role="tablist"` with roving tabindex, Left/Right/Home/End, `aria-selected`. **Timeline** = newest first. **Project** = runs grouped by source title (group heading with the run count, each group a disclosure; a group of one just lists it). Remembered. | Active tab has bold + underline/leading bar, not only a raised look. |
| **Search** (`role="search"`, `type="search"`, visually hidden label "Search your runs") | Filters the loaded list by title as you type (case-insensitive, diacritics-insensitive); clear button; a polite live region says "7 results" / "No runs match “x”". **Ctrl+K / ⌘K** focuses it from anywhere (`aria-keyshortcuts`); Esc clears then blurs. | The hint shows ⌘K on Apple platforms and "Ctrl K" elsewhere; decide it **after mount** (no hydration mismatch). Do not trap focus. |
| "Your runs" label | Section label (the reference's "Your Chats"). | `copy.ts`. |
| **Run rows** (≤ 50, newest first) | A link to `/runs/{id}`. Title (truncated to one line with the full title in `title`), status icon + visually hidden status word for anything that is not a normal complete run (running, flagged items present, failed, cancelled/incomplete, verifier degraded), and the relative time as `<time datetime>`: `now`, `5m`, `3h`, `1d`, `6d`, `1w`, then a short date. The current run has `aria-current="page"`, bold and a leading bar. | Pure `relativeShort(now, then)` with tests; computed on the client after mount; refreshed each minute. |
| **Row delete** (trash-2) | Appears on row hover and keyboard focus within, and is **always visible on touch** (`pointer: coarse`). Opens an inline confirm that reuses the existing text ("Delete this run and its source text permanently?", "Yes, delete", "Keep it") and `DELETE /api/runs/{id}`. Deleting the open run navigates to `/?deleted=1`; otherwise the row leaves the list and a status message says so. | One implementation shared with `DeleteRun` (extract, do not duplicate). |
| Empty / loading / error states | "No runs yet. Make your first study aid." / skeleton rows with `aria-busy` / "History could not be loaded. Try again." with a retry button. In guest mode with Stage 11 present: "Sign in to keep a history across devices." | The list never blocks the page. |
| Footer **account card** | Always shows something true. Auth off or guest: avatar placeholder (user icon), "Guest", and "Runs are kept for 24 hours" (value from `RUN_TTL_HOURS`, passed from the server). Signed in (Stage 11): name, email. The up/down chevrons and menu exist **only** when there is a menu (Stage 11); otherwise the card is plain text, not a button. | No dead controls. |
| Footer **New study aid** (plus icon, outlined pill, where "Upgrade to Pro" was) | Link to `/`, focuses the composer on arrival. If a run is in progress, a confirm: "A run is in progress. Leave it running, or cancel it?" is **not** needed because the run continues in the shell (see 5.2); the link just navigates. | |

### 3.3 Centre: headline and composer (home page, `<main>`)
| Element | Behaviour |
|---|---|
| **Headline** (`<h1>` with three `<span>` lines) | Decorative stagger and emboss done in CSS only; the accessible text is one sentence ("What are you studying today?"). Hidden construction lines are `aria-hidden` pseudo-elements, removed in high contrast, forced colours and print. |
| **Composer** (one `<form>`; replaces the textarea / file / checkbox / button blocks of `HomeForm`) | Keeps every current rule: text ≤ 200 KB, file ≤ 5 MB and ≤ .txt .md .pdf .docx, a file wins over pasted text, parse errors keep the form, `copy.home.*` messages, `role="alert"` for problems, `role="status"` for info, `router.push('/runs/{id}')` when the stream ends. |
| **"+" button** | Opens the file picker (name: "Upload a file"). The real `<input type="file">` stays in the DOM, visually hidden, with a `<label>` reading exactly **"Or upload a file"**. Drag and drop onto the composer works too (visible drop state, announced, same validation). |
| **Text field** | `<textarea id="notes">` with a visually hidden label **"Paste your lecture notes"**, placeholder "Paste your lecture notes or drop a file…", `aria-describedby` the hint. Starts one line tall (pill), **grows with content up to 40 vh, then scrolls**, morphing from pill to rounded rectangle (≈ 24 px radius). **Enter inserts a newline** (it is pasted prose); **Ctrl/⌘+Enter** submits (stated in the hint). |
| **File chip** | When a file is chosen: chip with file-text icon, name, size and an X ("Remove file"), plus the existing sentence "It will be used instead of the pasted text." |
| **Mic** | Dictates into the text field at the caret using the browser's speech recognition **only if** it reports on-device processing is available (feature-detect; verify the real API in installed Chromium before coding, do not rely on memory). Button `aria-pressed`, name "Dictate notes" / "Stop dictation"; a status line "Listening…"; interim text is shown but only final text is inserted. If on-device recognition is not available the button is **not rendered**. Never calls a cloud service. |
| **Round button (right)** | `type="submit"`, **accessible name "Make study aids"** (arrow-up). Never disabled for empty input (the existing "Paste your notes…" alert on empty submit stays). While a run is active it becomes **"Cancel"** (square icon, `audio-lines` animation around it) and calls the existing cancel; there is then exactly one "Cancel" button on the page. |
| **Chips under the composer** | (a) **"Use sample lecture"**: a real, always-visible `<button>` (file-text icon) that loads the sample and says so in the status line. (b) a real **checkbox** labelled **"Also write plain-language versions"**, styled as a chip, with its hint available (`aria-describedby`). (c) the demo-mode notice (when `LLM_MODE=fake`) as a small labelled badge: "Demo mode: scripted answers". |
| **Small print** | The tagline (`copy.tagline`) and the limits ("Up to 200 KB of text or a 5 MB file") in muted text below the chips. |
| Post-delete notice (`?deleted=1`) | Same message, shown as a `role="status"` line under the composer. |

### 3.4 Activity panel (`<aside aria-label="Verification activity">`; title "Verification activity" replaces "Tool Execution"; close X)
The reference's "tool execution" is our **pipeline**: reading, drafting, checking every item against the source, repairing, assembling. The panel makes the verification visible, which is the product.

State lives in a client **`RunSession` provider mounted in the shell** (it owns `useRun`), so a run started in the composer keeps going and keeps showing in the panel while the person navigates (the layout is not remounted between routes). The composer reads the same session.

| Tab | While idle (home, no run) | While a run is active | On a results page |
|---|---|---|---|
| **Summary** (file-text icon) | Empty state: "Nothing running. When you make study aids, each step appears here as it happens." | "Step n of N: …" (`role="status"`, the only live region), the stage list with icons + words (waiting / in progress / done; `circle-dashed`, `loader`, `check-circle`), and the running counts "n drafted · n checked · n repaired · n removed so far". **No Cancel button here** (it is on the composer; one Cancel only). | The run's report: generated / supported / to check (partial) / removed, the reconcile line (`copy.report.reconciles` or the mismatch warning), coverage, degraded and incomplete notices in words with icons. Filled by the results page through a small context (`usePanelContent`); the panel itself imports nothing from results. |
| **Details** (info icon) | Same empty state. | A scrolling activity log, newest at the bottom, one line per event: time, event kind, item id and type, verdict word + icon (e.g. "12:04:07 · glossary g-3 · checked · Supported"; "q-5 · removed · surplus"). **Ids, types and verdict labels only: never item text or source text.** Not a live region. Capped at the last 200 lines. | The run's notices (`result.warnings`) and the document warnings, as the results page already words them. |

The panel opens automatically when a run starts (unless the person closed it during that run), and starts **closed on `/runs/{id}`** (D9). Its open/closed choice is remembered.

### 3.5 Viewer states (what the shell shows)
| State | Top-bar user pill | Sidebar list | Account card |
|---|---|---|---|
| Auth does not exist yet / is off | none | runs of this browser (owner cookies) | "Guest · runs kept N hours" (no menu) |
| Stage 11 present, guest | "Sign in" | runs of this browser | "Guest" + "Sign in to keep a history" (menu: Sign in, Create account) |
| Stage 11 present, signed in | avatar + name + menu | the user's runs (server-owned) | name, email (menu: My runs, Account, Sign out) |

Build the shell against a small `Viewer` value passed down from the server layout; **until Stage 11 it is always `guest-no-auth`**, and Stage 11 replaces the source of that value without touching the components.

---

## 4. Visual system (all tokens in `globals.css`; no hard-coded colours in components)
- **Tokens** (light, dark, high-contrast, forced-colours): `--stage` (outer backdrop), `--frame-top` / `--frame-bottom` (window gradient), `--panel-tint` (sidebar/panel overlay), `--raise-hi` / `--raise-lo` (highlight and shadow colours), `--control-border` (≥ 3:1), `--control-fill`, `--control-active-fill`, `--text`, `--text-muted` (≥ 4.5:1), `--headline-fill`, `--headline-hi`, `--headline-lo`, `--radius-frame` (28 px), `--radius-pill` (999 px), `--shadow-raised`, `--shadow-inset`. Keep the existing tokens working for the untouched results page; map them onto the new ones rather than deleting them.
- **Light**: the reference palette, corrected for contrast as in the defects table. **Dark**: the same structure inverted (stage ≈ #0a0a0b, frame ≈ #1d2025 → #121418, highlights as 6–10 % white). **High contrast**: no gradient, no shadow, no construction lines, 2 px solid borders, black/white/yellow as today. **Forced colours**: only system colours; every control has a real border; icons use `currentColor`.
- **Raised / inset** effects are `box-shadow` layers on top of a real 1 px border. Focus is a real `outline` (3 px, offset 2 px), never a box-shadow: `expectVisibleFocus` in the e2e helpers checks `outline-style` and `outline-width`.
- **Hover/focus tooltips** (WCAG 1.4.13): shown on hover and keyboard focus, dismissible with Esc, hoverable, never the only name.
- **Motion**: 120–160 ms transitions on fill/shadow, the stage spinner and `audio-lines` bars; everything off under `prefers-reduced-motion`.
- **Frame**: ≥ 80 rem container: the window look (margins up to 75 px × 56 px, radius 28 px, shadow, dark stage visible). Below that: edge to edge, no radius. Print: no frame, no sidebar, no panel, no top bar (the existing print rules and the e2e `banner` hidden check stay true).
- **Scrolling**: the **document scrolls** (Ctrl+F, scroll restoration, print and 400 % zoom keep working). Sidebar and panel are `position: sticky; top: 0; height: 100dvh` with their own `overflow-y: auto` **and `tabindex="0"` + an accessible name** on the scrollable region (axe `scrollable-region-focusable`).
- **Reflow and text size**: breakpoints use **container queries in rem** (they follow the computed root font size, so the 100–200 % Text size setting moves them; media queries in rem do not). Below the wide threshold the headline is **unstaggered and not overlapped** (headline above composer, left-aligned), sidebar and panel become modal `<dialog>` drawers (focus trapped, Esc closes, focus returns to the toggle, background inert). The headline's size is `clamp()`ed against its container so 200 % text never overflows; body text still obeys the setting. Must hold at 320 px, at 200 % text, and with the WCAG 1.4.12 spacing overrides.

## 5. Architecture (what to add; what not to touch)
1. **No changes** to `src/core` (except one new interface file below), `src/llm`, `src/nlp`, `src/app/api/runs/[id]/*`, exports, eval, scripts, or the semantics of `POST /api/runs`.
2. **Shell:** `src/ui/shell/` → `AppShell.tsx` (client; grid + state), `TopBar.tsx`, `HistorySidebar.tsx` (+ `HistoryList`, `HistoryTabs`, `SearchBox`, `RunRow`), `ActivityPanel.tsx`, `NotificationsMenu.tsx`, `AccountCard.tsx`, `RunSession.tsx` (context hosting `useRun` and the activity log), `PanelContent.tsx` (the context a page fills), `use-history.ts`, `relative-time.ts`, `group-history.ts`, `shortcuts.ts`. `src/app/layout.tsx` stays a server component and renders `<AppShell viewer ttlHours>`. Skip link, `NO_FLASH_SCRIPT`, `SettingsProvider`, font setup stay.
3. **Home:** `src/ui/home/` → `Hero.tsx`, `Composer.tsx` (the form logic moves from `HomeForm.tsx` unchanged: same limits, same `copy.home` strings, same `useRun`), `Chips.tsx`, `dictation.ts` (feature detection + controller, behind an interface so tests use a fake). `src/app/page.tsx` keeps reading the sample fixture and the mode on the server.
4. **`useRun` / `progress.ts`:** `reduceProgress` gains an `activity: ActivityLine[]` field (kind, item id/type, verdict label only, capped at 200); existing fields and the existing `tests/ui/progress.test.ts` expectations are unchanged; add new tests.
5. **Settings object** (`src/ui/settings.ts`): add `sidebar: "open"|"closed"`, `panel: "auto"|"open"|"closed"`, `historyView: "timeline"|"project"`. `parseSettings` stays tolerant; **the pre-paint script duplicates the parsing in miniature and a test keeps them in step: change both** (CLAUDE.md §8). `sidebar` and `panel` are applied as `<html>` attributes before paint so there is no layout jump. No new storage key.
6. **Icons:** one module `src/ui/icons.tsx` re-exporting only the icons used (so the bundle contains only those), each rendering `aria-hidden="true"` and `focusable="false"` by default.
7. **History API (new, additive):** `GET /api/runs` → `{ runs: RunSummary[], ttlHours }`, `Cache-Control: no-store`, ≤ 50 newest. `RunSummary = { runId, title, createdAt, status, counts: { generated, supported, partial, removed } | null, degraded: boolean }`; verify the real `RunReport` field names in `src/core/pipeline/types.ts` before writing the type. Which runs: the ids found in the request's `nb_owner_{id}` cookies (add `ownedRunIds(request)` to `owner.ts`; ignore names that do not match the id pattern; look the ids up; skip ids no longer in the store), plus the signed-in user's runs once Stage 11 exists. Titles come from the stored document (`doc.title`, else the first section title, else "Untitled"), cut at 120 characters. **Never return source sentences, item text, notes or feedback; never log titles.** One new port file `src/core/ports/run-index.ts` (`summaries(ids): Promise<RunSummary[]>`) implemented by `MemoryRunStore` and `SqliteRunStore` (SQLite via `json_extract` so whole result documents are not loaded; Stage 10's `PrismaRunStore` implements it too). The handler lives in `src/app/server/history.ts` and takes a `Runtime`; the route file only wires it (same pattern as `runs.ts`). Rate-limit like other reads only if cheap; it must not count against the run limiter.

## 6. Compatibility contract (the existing 110 e2e tests and 771 unit tests must keep passing)
Keep these exactly, because tests find them by name or structure:
- Buttons/controls and their accessible names: **"Use sample lecture"** (button), **"Make study aids"** (submit), checkbox **"Also write plain-language versions"**, input label **"Or upload a file"**, the notes field label **"Paste your lecture notes"**, **"Cancel"** (exactly one), link **"Start another"** on results, **"Display settings"** as a `<details>`/`<summary>` (text content), the `role="banner"` header hidden in print, `main#main`, the skip link, the persistent trust notice text.
- `role="alert"` for errors (the empty-submit message still contains "Paste your notes"), `role="status"` for progress; Next's route announcer is also `role="alert"`, so keep using the `appAlert` selector pattern.
- Focus: every focusable element shows a real outline ≥ 2 px (`tabTo` checks every stop). The Tab order is header → history → main → activity panel, and "Display settings" is reachable within the helper's 80-stop limit.
- Storage: only the display-settings key and the HttpOnly owner cookies (`security.spec.ts`). Network: own origin only. CSP unchanged (**no inline `<style>` or `style=` for anything that needs `script-src`; fonts and icons are local**).
- If a selector must change because a control moved, change only the selector, keep the assertion, and **list every such edit in the report**.

## 7. Build order (run `npm run check` after every step and `npm run e2e` after steps 3, 5, 7 and 9; stop and fix on the first red)
1. Copy the reference to `docs/reference/`; add `lucide-react` (or the local icon module), the local Inter font, tokens in `globals.css`; add the **contrast test** (script or Vitest) over every foreground/background and border/background token pair in light, dark and high contrast, and fail below the thresholds in the defects table.
2. `GET /api/runs`, `RunIndex` port, the two store implementations, `ownedRunIds`, with unit and store-contract tests. No UI yet.
3. `AppShell` with empty sidebar and panel, top bar, trust-notice strip, drawers, toggles, persisted state, the settings-object extension and its pre-paint sync test. Existing pages render inside it unchanged.
4. History sidebar: list, relative time, tabs, search + shortcut, delete, states, account card, New study aid.
5. Composer and headline; `HomeForm` retired once nothing imports it.
6. `RunSession` + activity panel (Summary and Details while running; empty state), then the results-page content for the panel via `usePanelContent`.
7. Bell popover, gear popover, user pill slot (hidden), dictation (behind the interface).
8. Polish to the reference: side-by-side with `docs/reference/main-page.webp` at a 1504 × 1128 viewport; sidebar 280 ± 8 px, panel 353 ± 8 px, top bar 56 ± 4 px, composer 658 ± 12 × 60 ± 4 px, radii and gaps within ± 8 px; documented deviations only where the defects table requires them.
9. Dark, high-contrast, forced-colours, 320 px, 200 % text, print and reduced-motion passes.

## 8. Tests
- **Unit:** `relativeShort` (boundaries: 59 s, 60 s, 59 m, 23 h, 6 d, 7 d, future timestamps); history grouping by title; search normalisation; reducer `activity` lines never contain item text (feed it items whose text is a sentinel); settings parse + pre-paint script in step for the three new fields; `GET /api/runs` (only cookie-owned runs; malformed cookie names ignored; deleted runs skipped; sorted; capped; no sentinel source sentence in the body; title cut at 120); dictation controller with a fake (hidden when unsupported; inserts only final results); composer rules table (limits, file wins over text, Ctrl+Enter, Enter newline).
- **Store contract:** `summaries()` on memory and SQLite give identical results.
- **E2E (fake mode):** the whole existing suite; plus run the sample twice → both rows appear, newest first, current row `aria-current`; search narrows; Project view groups the two under one title; delete from the sidebar (confirm, row gone, navigation when it was the open run); Ctrl+K focus; toggles persist across reload with no layout jump; activity panel shows stages and counts during a run and the one **Cancel** works; drag-and-drop a file; drawers at 800 px (focus trap, Esc, focus return).
- **Accessibility:** axe zero serious/critical on home (idle, typing, file chosen, running, error), with the sidebar and panel open, drawers open, popovers open, in light / dark / high contrast / forced colours, at 320 px and at 200 % text; keyboard-only run from the composer; text-spacing (1.4.12) on the shell; target size ≥ 24 px for every new control; headings (one `<h1>`, then `<h2>`s) and landmark labels; the contrast test from step 1.
- **Visual:** Playwright mocks `GET /api/runs` with the ten rows from the reference to screenshot the page at 1504 × 1128 → `docs/screenshots/stage12-*.png` (home idle, running, sidebar Project view, popovers, dark, high contrast, 320 px, 200 % text). **Open and look at every screenshot**; compare to the reference and write down differences.

## 9. Gate (paste real output)
`npm run check` · `npm run e2e` (all prior tests + new, none weakened) · `npm run test:slow` and `npm run eval -- --judge=fake` unchanged · `npm run build` clean · `git diff --stat -- src/core` shows only the new `ports/run-index.ts` · `LLM_MODE=fake npm run build && npm start` and walk: home → sample run → panel activity → results → sidebar row → delete.

## 10. Report
Before/after screenshots next to the reference; every e2e edit and why; measured vs reference sizes; every deliberate deviation from the reference with its reason; what was not checked (real screen readers, Firefox/Safari, on-device dictation on a real microphone); an updated `docs/screen-reader-checklist.md` for the new shell (the user must run it, as with Stage 6); the STAGE.md row and decisions D1–D9.

## As built (2026-10-25) — what differs from the plan above
- **Update, same day: the floating-window frame was removed at the user's request** (no dark backdrop, no margins, no rounded corners; the app fills the browser window). The measurements below that mention the frame inset and radius no longer apply; the headline is also bounded by the window height (`11dvh`) so the idle page fits a 1366 × 768 laptop without scrolling.
- **Measured against the reference at 1504 × 1128:** frame inset 75 / 56 px and radius 28 px as in the image; top bar 56 px (plus a ≈ 35 px trust strip the reference does not have); sidebar 280 px; activity panel 352 px; composer ≈ 656 × 60 px, radius 30 px, in the gap between headline lines 1 and 2; headline ≈ 91 px vs ≈ 94 px; row pitch 38 px vs 37 px. Deliberate differences: the headline is darker (3:1 not 1.6:1), borders and muted text are stronger, the logo toggle buttons exist in the top bar, there is no user pill, no "Plus", no crown.
- **Thresholds:** the activity panel is a column from 70 rem of frame width (not 80) so it shows at the usual 1280 px laptop width; the staggered headline needs 28 rem of hero width (not 40), scaling with the container.
- **The "Working on your notes" heading and the one "Step n of N" status line live in the composer area**, not in the panel (the panel shows the stage list, the counts and the log). One heading and one live region keep screen readers and the existing tests unambiguous, and they are visible when the panel is a drawer.
- **After "Use sample lecture" focus moves into the notes box** (the composer sits above the chips in the tab order).
- **The results page** keeps its content; its `lg:` breakpoints became `@3xl:` container queries, and its sticky Source column offsets by the shell's top bar (`--chrome`). The panel starts closed there (D9) and shows the run report and notices when opened.
- **Dictation** is implemented and unit-tested with a fake recognizer, but was not run with a real microphone; automated browsers never probe the API (it crashes headless Chromium: measured).
- **Not done here:** the user pill, account menu and sign-in link (Stage 11), the restyle of the results page and auth pages (Stage 13), a manual screen-reader pass (the user; checklist section "Stage 12 shell").
- **e2e:** one selector edit (`display.spec.ts`, the home h1); 24 new tests in `e2e/shell.spec.ts`; all other existing tests pass unchanged.
