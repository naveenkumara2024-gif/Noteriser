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
- [ ] Landmarks list (NVDA: `D` / rotor): banner, main, and the Source region are announced.
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
