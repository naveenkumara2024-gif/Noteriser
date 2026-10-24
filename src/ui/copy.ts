import type { Stage } from "@/core/pipeline";

/** All user-facing strings live here so they can be localised later (CLAUDE.md §7). */
export const copy = {
  productName: "NoteBridge",
  tagline:
    "Turn instructor-approved lecture notes into a summary, a glossary and five practice questions, each tied to the exact source sentence it came from.",
  // Lore §10: persistent label against over-trust.
  trustNotice: "Generated from instructor-approved notes. Check flagged items against the source.",
  skipToContent: "Skip to main content",

  home: {
    notesLabel: "Paste your lecture notes",
    notesHint: "Plain text or Markdown. Headings (lines starting with #) become sections.",
    sampleButton: "Use sample lecture",
    sampleLoaded: "Sample lecture loaded. Press Make study aids to run it.",
    fileLabel: "Or upload a file",
    fileHint: "Accepted: .txt, .md, .pdf, .docx.",
    submit: "Make study aids",
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

export const removalLabel = {
  unsupported: "Not supported",
  contradicted: "Contradicted by the notes",
  duplicate: "Duplicate",
  surplus: "Not needed",
} as const;

export const questionTypeLabel = {
  mcq: "Multiple choice",
  short: "Short answer",
  true_false: "True or false",
} as const;

export const docWarningLabel = {
  not_processed: "Not processed",
  noisy_extraction: "Text extraction was poor",
  no_headings: "No headings found",
  too_short: "Very short notes",
} as const;
