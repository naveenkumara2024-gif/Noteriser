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

  /** Lines of the activity log: ids, kinds and verdict words only, never item or source text. */
  activity: {
    started: "started",
    finished: "done",
    drafted: (what: string): string => `Drafted ${what}`,
    checked: (what: string, verdict: string, again: boolean): string =>
      `Checked ${what}${again ? " (repaired version)" : ""}: ${verdict}`,
    repaired: (what: string, outcome: string): string => `Repair of ${what}: ${outcome}`,
    removed: (what: string, why: string): string => `Removed ${what}: ${why}`,
    plain: (what: string, outcome: string): string =>
      `Plain wording for ${what}: ${outcome.replaceAll("_", " ")}`,
    notice: (code: string): string => `Notice: ${code}`,
    stopped: (code: string): string => `Stopped: ${code}`,
  },

  shell: {
    skip: "Skip to main content",
    logoLabel: "NoteBridge home",
    historyShow: "Show history",
    historyHide: "Hide history",
    historyClose: "Close history",
    activityShow: "Show verification activity",
    activityHide: "Hide verification activity",
    notifications: (unread: number): string =>
      unread > 0 ? `Notifications, ${unread} new` : "Notifications",
    notificationsTitle: "Recent activity",
    notificationsNone: "Nothing new.",
    notificationFinished: (title: string, supported: number, partial: number, removed: number) =>
      `${title} finished: ${supported} supported, ${partial} to check, ${removed} removed.`,
    notificationStatus: {
      failed: (title: string) => `${title} could not produce study aids.`,
      incomplete: (title: string) => `${title} was stopped before it finished.`,
      running: (title: string) => `${title} is still running.`,
    },
    displaySettings: "Display settings",
    guest: "Guest",
    retention: (hours: number): string =>
      hours % 24 === 0
        ? `Runs are kept for ${hours / 24 === 1 ? "24 hours" : `${hours / 24} days`}`
        : `Runs are kept for ${hours} hours`,
    newStudyAid: "New study aid",
    demoBadge: "Demo mode: scripted answers",
  },

  history: {
    title: "History",
    nav: "History",
    tabs: "History view",
    timeline: "Timeline",
    project: "Project",
    searchLabel: "Search your runs",
    searchPlaceholder: "Search",
    searchClear: "Clear search",
    yourRuns: "Your runs",
    results: (n: number): string => `${n} ${n === 1 ? "result" : "results"}`,
    noMatch: (q: string): string => `No runs match “${q}”.`,
    empty: "No runs yet. Make your first study aid.",
    loading: "Loading your runs",
    error: "History could not be loaded.",
    retry: "Try again",
    deleteRun: (title: string): string => `Delete ${title}`,
    deleted: (title: string): string => `Deleted ${title}.`,
    deleteFailed: "The run could not be deleted. Try again.",
    groupRuns: (n: number): string => `${n} ${n === 1 ? "run" : "runs"}`,
    status: {
      running: "Running",
      failed: "Failed",
      incomplete: "Stopped early",
      degraded: "Verifier degraded",
      flagged: "Has items to check",
    },
    limitNote: (n: number): string => `Showing the latest ${n} runs.`,
  },

  panel: {
    title: "Verification activity",
    close: "Close verification activity",
    tabs: "Activity view",
    summary: "Summary",
    details: "Details",
    idle: "Nothing running. When you make study aids, each step appears here as it happens.",
    noLog: "No activity yet.",
    logLabel: "Activity log",
    reportHeading: "Run report",
    flagged: (n: number): string => `${n} to check against the source`,
    noticesHeading: "Notices from this run",
    noNotices: "No notices.",
  },

  composer: {
    heading: ["What are you", "studying", "today?"],
    headingLabel: "What are you studying today?",
    notesLabel: "Paste your lecture notes",
    placeholder: "Paste your lecture notes or drop a file…",
    upload: "Upload a file",
    dropHint: "Drop the file to use it",
    dropped: "File added.",
    removeFile: "Remove file",
    fileReplaces: "It will be used instead of the pasted text.",
    dictate: "Dictate notes",
    stopDictation: "Stop dictation",
    listening: "Listening…",
    dictationFailed: "Dictation stopped. Check your microphone and try again.",
    submitHint: "Press Ctrl+Enter (or ⌘+Enter) to make study aids.",
    limits: (text: string, file: string): string => `Up to ${text} of text or a ${file} file.`,
    runningStatus: "Working. Cancel from the round button.",
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
