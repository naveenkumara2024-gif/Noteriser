import { QUESTION_TYPE_LABEL, REMOVAL_LABEL, TRUST_NOTICE } from "@/core/export/labels";
import type { Stage } from "@/core/pipeline";

/** All user-facing strings live here so they can be localised later (CLAUDE.md §7). */
export const copy = {
  productName: "NoteBridge",
  tagline:
    "Turn instructor-approved lecture notes into a summary, a glossary and five practice questions, each tied to the exact source sentence it came from.",
  // Lore §10: persistent label against over-trust.
  trustNotice: TRUST_NOTICE,
  skipToContent: "Skip to main content",

  home: {
    notesLabel: "Paste your lecture notes",
    notesHint: "Plain text or Markdown. Headings (lines starting with #) become sections.",
    sampleButton: "Use sample lecture",
    sampleLoaded: "Sample lecture loaded. Press Make study aids to run it.",
    fileLabel: "Or upload a file",
    fileHint: "Accepted: .txt, .md, .pdf, .docx.",
    submit: "Make study aids",
    plainOption: "Also write plain-language versions",
    plainHint:
      "Shorter sentences, checked against the notes again. Takes longer, and any version that cannot be verified is not used.",
    demoMode:
      "Demo mode: this server answers with scripted model output, so only the sample lecture gives meaningful results.",
    noInput: "Paste your notes, upload a file or use the sample lecture first.",
    deleted: "The run was deleted. Nothing from it is kept.",
    cancelled: "The run was cancelled. Nothing was kept as a result.",
    networkError: "Could not reach the server. Check your connection and try again.",
  },

  progress: {
    heading: "Working on your notes",
    cancel: "Cancel",
    step: (n: number, total: number, label: string): string => `Step ${n} of ${total}: ${label}`,
    counts: (d: number, c: number, r: number, x: number): string =>
      `${d} drafted · ${c} checked · ${r} repaired · ${x} removed so far`,
    stageLabel: {
      parse: "Reading your notes",
      generate: "Drafting the summary, glossary and questions",
      verify: "Checking every item against the source",
      repair: "Repairing weak items",
      assemble: "Putting the results together",
      plain: "Writing and checking plain-language versions",
    } satisfies Record<Stage, string>,
    stageState: { waiting: "waiting", active: "in progress", done: "done" },
  },

  results: {
    untitled: "Study aids",
    summary: "Summary",
    glossary: "Glossary",
    questions: "Practice questions",
    source: "Source",
    sourceHint: "Select a source reference like S2.4 to find the sentence.",
    cited: "Cited",
    showSource: "Show source",
    hideSource: "Hide source",
    revealAnswer: "Reveal answer",
    hideAnswer: "Hide answer",
    answer: "Answer",
    citations: "Source sentences",
    noItems: "Nothing in this section passed the checks.",
    flaggedPrefix: "Check against source",
    repaired: "Rewritten after review to match the notes.",
    originalWording: "Original wording",
    degraded:
      "Verifier degraded: some checks could not run for this run, so affected items are capped at partial. Do not treat them as verified.",
    incomplete: "This run was stopped before it finished. What is shown is what had been checked.",
    failed: "This run could not produce study aids.",
    docWarnings: "Parts of your notes were not processed",
    notices: "Notices from this run",
    removed: (n: number): string => `Removed items (${n})`,
    removedHint:
      "Drafts that did not pass the checks, or were not needed. They are listed so nothing disappears silently.",
    removedNone: "No items were removed.",
    checksFailed: "Checks that failed",
    repairTried: "Repair was tried",
    deleteRun: "Delete this run",
    deleteConfirm: "Delete this run and its source text permanently?",
    deleteYes: "Yes, delete",
    deleteNo: "Keep it",
    deleteFailed: "The run could not be deleted. Try again.",
    newRun: "Start another",
    expandAll: "Expand all sections",
    collapseAll: "Collapse all sections",
    warningPrefix: "Warning: ",
  },

  settings: {
    title: "Display settings",
    theme: "Theme",
    themes: { system: "Match my device", light: "Light", dark: "Dark", contrast: "High contrast" },
    textSize: "Text size",
    font: "Font",
    fonts: { system: "Standard", readable: "Readable font (Atkinson Hyperlegible)" },
    spacing: "Spacing",
    spacings: {
      default: "Standard",
      comfortable: "Comfortable (WCAG text-spacing minimums)",
      extra: "Extra roomy",
    },
    reset: "Reset display settings",
  },

  read: {
    group: "Read aloud",
    readSummary: "Read summary aloud",
    readGlossary: "Read glossary aloud",
    pause: "Pause",
    resume: "Resume",
    stop: "Stop",
    rate: "Speed",
    voice: "Voice",
    defaultVoice: "Default voice",
    item: "Read aloud",
    question: "Read question aloud",
    answer: "Read answer aloud",
    reading: "Reading aloud",
    hint: "Uses your browser's voices. Nothing is sent to a server. Removed items are never read.",
  },

  plain: {
    group: "Reading level",
    original: "Original wording",
    plainView: "Plain language",
    summary: (n: { simplified: number; unchanged: number; keptOriginal: number }): string =>
      `${n.simplified} simplified, ${n.unchanged} already plain, ${n.keptOriginal} kept as written.`,
    grade: (before: number, after: number): string => `Reading grade ${before} to ${after}`,
    gradeAverage: (before: number, after: number): string =>
      `Average reading grade: ${before} as written, ${after} in plain language.`,
    keptOriginal: "Kept original",
    keptReason: (why: string): string => `${why[0]?.toUpperCase() ?? ""}${why.slice(1)}.`,
    unchanged: "Already in plain language.",
    verified: "Plain-language version, checked against the source like every other item.",
  },

  export: {
    title: "Export and print",
    markdown: "Markdown (.md)",
    text: "Plain text (.txt)",
    anki: "Anki flashcards (.tsv)",
    audit: "Audit file (.json)",
    auditWarning: "Contains the full source text. Only this browser can download it.",
    plainWording: "Use the plain-language wording",
    includeFlagged: "Include flagged items in the flashcards",
    print: "Print / Save as PDF",
    printNotice:
      "Generated from instructor-approved notes. Check flagged items against the source.",
    sourceHeading: "Source sentences cited",
    answerKey: "Answer key",
  },

  feedback: {
    open: "Report a problem with this item",
    legend: "What is wrong?",
    kinds: { wrong: "Wrong", unclear: "Unclear", missing_context: "Missing context" },
    note: "Note (optional, up to 500 characters)",
    send: "Send feedback",
    thanks: (kind: string): string => `Thank you. Marked as "${kind}". It is kept with this run.`,
    failed: "The feedback could not be saved. Try again.",
  },

  report: {
    heading: "Run report",
    reconciles: (generated: number): string =>
      `Counts reconcile: all ${generated} generated items are shown or listed as removed.`,
    mismatch: "Counts do not reconcile. Treat this run with caution.",
  },
} as const;

export const verdictLabel = {
  SUPPORTED: "Supported",
  PARTIAL: "Check against source (partial)",
  UNSUPPORTED: "Not supported",
  CONTRADICTED: "Contradicted by the notes",
} as const;

export const removalLabel = REMOVAL_LABEL;

export const questionTypeLabel = QUESTION_TYPE_LABEL;

export const docWarningLabel = {
  not_processed: "Not processed",
  noisy_extraction: "Text extraction was poor",
  no_headings: "No headings found",
  too_short: "Very short notes",
} as const;
