import type { LlmClient, LlmError, Usage } from "../ports/llm";
import type { QuestionType } from "../schema/items";

/** Structural findings made while mapping a model reply to a draft; Stage 3 does the real judging. */
export interface DraftMeta {
  /** True when at least one source ID was cited and every cited ID exists in the document. */
  idsExist: boolean;
  problems: string[];
}

interface DraftCommon extends DraftMeta {
  itemId: string;
  /** Which model call produced it: `section:2` or `rollup` or `document`. */
  scope: string;
  sourceIds: string[];
  evidenceQuote: string;
  /** Summary point, glossary definition, or (for questions) the question text. */
  text: string;
}

export interface SummaryDraft extends DraftCommon {
  type: "summary_point";
}

export interface GlossaryDraft extends DraftCommon {
  type: "glossary";
  term: string;
}

export interface QuestionDraft extends DraftCommon {
  type: "question";
  qtype: QuestionType;
  question: string;
  options?: string[];
  answer: string;
  /** Declarative restatement of the answer: what the verifier checks. */
  answerStatement: string;
  answerSourceIds: string[];
}

export type DraftItem = SummaryDraft | GlossaryDraft | QuestionDraft;

export interface GenerationFailure {
  scope: string;
  error: LlmError;
}

/** One generator's result. It never throws: failures are data the pipeline must show. */
export interface GenerationOutcome {
  items: DraftItem[];
  failures: GenerationFailure[];
  /** Calls where the model said the notes cannot support the task. Not an error. */
  insufficient: { scope: string; reason: string }[];
  /** Replies or items that could not be used as given (blank text, malformed ids, ...). */
  problems: string[];
  usage: Usage;
}

/** One model call's lifecycle, so a CLI or the app can show progress during long runs. */
export interface GenerationProgress {
  /** What the call is for: `summary`, `glossary`, `questions` or `rollup`. */
  task: string;
  /** Which part of the notes: `section:2`, `document` or `rollup`. */
  scope: string;
  phase: "start" | "done" | "failed";
  /** On `done`: items produced. On `failed`: the error message. */
  detail?: string;
}

export interface GenerateDeps {
  llm: LlmClient;
  signal?: AbortSignal;
  /** Parallel model calls within one generator. Default 3. */
  concurrency?: number;
  onProgress?: (event: GenerationProgress) => void;
}

export const GENERATOR_TEMPERATURE = 0.1;
export const DEFAULT_CONCURRENCY = 8;
/** Above this many sentences, summaries get a roll-up pass and questions are generated per section. */
export const LONG_DOC_SENTENCES = 40;
/** Over-generate so verification can drop some and still leave five (lore §6.5). */
export const QUESTION_CANDIDATES = 8;
