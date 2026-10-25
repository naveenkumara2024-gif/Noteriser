# Screen-reader check (manual, about 15 minutes)

Automated tests (axe, keyboard-only, reflow, spacing, target size, forced colours) cannot tell you
whether the page *makes sense* when heard. This list is the part only a person can do. Use **NVDA**
on Windows (free, with Firefox or Chrome) or **VoiceOver** on macOS/iOS (Safari).

Run the app in demo mode so the results are the same every time:

```
LLM_MODE=fake npm run dev        # PowerShell:  $env:LLM_MODE="fake"; npm run dev
```

Open http://localhost:3000, press **Use sample lecture**, tick **Also write plain-language
versions**, press **Make study aids**. Tick each line as you go; write down anything that was
confusing, even if it "works".

## 1. Landmarks and headings
- [ ] Skip link: first Tab says "Skip to main content"; Enter lands on the page content.
- [ ] Landmarks list (NVDA: `D` / rotor): banner, navigation "History", main, complementary
      "Verification activity" and the Source region are announced (Stage 12 shell).
- [ ] Headings list (NVDA: `H`, or Insert+F7): one level-1 heading ("Lecture 7: CPU Scheduling
      Basics"), then level-2 headings: Reading level, Read aloud, Summary, Glossary, Practice
      questions, Source, Run report. No skipped levels.

## 2. Flags and status
- [ ] Each item announces its status in words ("Supported" / "Warning: Check against source
      (partial)"), not just a colour or icon.
- [ ] The one flagged item (Preemption) reads its reason ("Check against source: Only partly
      supported by the cited text...").
- [ ] The trust notice at the top is read ("Generated from instructor-approved notes...").
- [ ] Open **Removed items (5)**: each entry says why it was removed and which check failed.

## 3. Sources
- [ ] Source references (S1.1, S1.2...) are announced as buttons ("Source sentence S1.1, toggle
      button, not pressed"). Pressing one: the state changes to pressed, and the Source column
      sentence is marked "(Cited)".
- [ ] On a narrow window (or phone), "Show source" opens the sentences under the item.

## 4. Practice questions
- [ ] A multiple-choice question reads as a question followed by a lettered list of four options.
- [ ] **Reveal answer** announces "expanded"; the answer text is read right after it. Pressing again
      says "collapsed".

## 5. Reading level (plain language)
- [ ] The "Reading level" group announces its two choices; the counts and reading grades are read.
- [ ] Choosing **Plain language** changes the wording; each simplified item says it was "checked
      against the source". The FCFS summary point says "Kept original: The simplified version could
      not be verified".

## 6. Read aloud
- [ ] "Read aloud" group is present (it is hidden only if the browser has no speech).
- [ ] **Read summary aloud** starts speech. Your screen reader and the page's voice may talk at once:
      that is expected; use the page's **Pause**, **Stop** and **Speed** controls.
- [ ] While it reads, the current item shows "Reading aloud" and (in Chrome/Edge with a local voice)
      the current word is marked.
- [ ] After pressing **Pause**, focus stays on the same button, which is now called **Resume**.

## 7. Display settings
- [ ] "Display settings" opens and closes (announced expanded/collapsed).
- [ ] Theme radio buttons, the Text size slider ("Text size: 130%"), Font and Spacing are all
      reachable and labelled. Reset display settings works.

## 8. Chunked sections
- [ ] "Collapse all sections" / "Expand all sections" changes its own name and keeps focus.
- [ ] Each section heading toggles its section from the keyboard (Enter or Space).

## Result
Record in STAGE.md (Stage 6): who ran it, which screen reader and browser, and every problem found.
If it was not possible to run, say so explicitly: Stage 6 is only marked done once the result is
recorded or the check is waived in writing.

## Stage 12 shell (history, composer, activity panel): added 2026-10-25
Run with a window at least 1280 px wide first, then again at 800 px (columns become drawers).

- [ ] Home: the one level-1 heading reads "What are you studying today?" as a single sentence (not
      three fragments). The composer is announced as "Paste your lecture notes, edit text".
- [ ] "Upload a file" and "Make study aids" are buttons with those names. While a run is going the
      round button is called "Cancel" and there is exactly one Cancel.
- [ ] Press **Use sample lecture**: focus moves into the notes box and "Sample lecture loaded" is
      read. Tab once: you land on "Make study aids".
- [ ] **Enter** adds a line in the notes box; **Ctrl+Enter** starts the run.
- [ ] While running, the status line "Step n of 5: ..." is announced once per stage, not once per
      item. The activity panel's list shows each stage with "(done)", "(in progress)" or "(waiting)".
- [ ] Activity panel, Details tab: the log is a list of short lines (ids, kinds, verdict words) and is
      not announced while you are elsewhere. It never reads the notes' own sentences.
- [ ] History: "History" navigation; the tabs "Timeline" and "Project" announce selected state and
      move with the arrow keys; the search box says "Search your runs, search"; **Ctrl+K** jumps to it
      and typing announces "n results" or "No runs match ...".
- [ ] Each history row reads title, status (only if not an ordinary run), then the time in words
      ("3 hours ago"). The open run is announced as the current page.
- [ ] Row delete: the trash button is reachable by Tab, announces which run it deletes, and the
      confirmation reads "Delete this run and its source text permanently?".
- [ ] Bell: the button says "Notifications, 1 new" after a run; the popover reads the finished run as
      a link; Escape closes it and focus returns to the bell.
- [ ] At 800 px: "Show history" opens a dialog named "History"; focus stays inside it; Escape closes it
      and focus returns to the button.
- [ ] Microphone: in a browser with an installed on-device speech pack the button "Dictate notes"
      appears and says "Listening..."; in a browser without one there is no microphone button at all.
