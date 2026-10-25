import type { Drafts } from "../generate";
import type { DraftItem } from "../generate/types";
import type { DocumentInput } from "../ingest";
import type { Embedder } from "../ports/embed";
import type { LlmClient } from "../ports/llm";
import type { Nli } from "../ports/nli";
import type { RunStore } from "../ports/store";
import type { ItemEnvelope, QuestionItem, Verdict } from "../schema/items";
import type { RunReport } from "../schema/report";
import type { SourceDoc } from "../schema/source";
import type { Thresholds } from "../verify";
import type { RunLimits } from "./guard";

export type Stage = "parse" | "generate" | "verify" | "repair" | "assemble" | "plain";

/**
 * Why an item is not shown. `unsupported` and `contradicted` are failures of the notes' support;
 * `duplicate` and `surplus` are valid items that were not needed (nothing disappears silently).
 */
export type RemovalKind = "unsupported" | "contradicted" | "duplicate" | "surplus";

export type Envelope = ItemEnvelope | QuestionItem;

/**
 * A plain-language version of a shown item. `simplified` and `unchanged` were verified in full (the
 * rewrite is SUPPORTED); `kept_original` means the rewrite could not be written or could not be
 * verified, so the original wording stands.
 */
export type PlainVersion =
  | { status: "simplified"; envelope: Envelope; gradeBefore: number; gradeAfter: number }
  | { status: "unchanged"; gradeBefore: number }
  | { status: "kept_original"; reason: string; gradeBefore: number };

export interface PlainSummary {
  attempted: number;
  simplified: number;
  unchanged: number;
  keptOriginal: number;
  /** Mean Flesch-Kincaid grade of the shown items as written, and as shown in plain-language view. */
  gradeBefore: number;
  gradeAfter: number;
}

export interface ShownItem {
  /** Verdict is SUPPORTED, or PARTIAL (then `flagged`). */
  envelope: Envelope;
  flagged: boolean;
  /** The text shown is the repaired version. */
  repaired: boolean;
  /** The draft's text before repair, when repair changed it. */
  originalText?: string;
  /** Present when the run was asked for plain-language versions. */
  plain?: PlainVersion;
}

export interface RemovedItem {
  envelope: Envelope;
  kind: RemovalKind;
  reasons: string[];
  repairAttempted: boolean;
  /** Why repair produced nothing, when it was attempted and failed. */
  repairNote?: string;
  /** For duplicates: the item that was kept. */
  duplicateOf?: string;
}

export interface RunWarning {
  code: string;
  message: string;
}

export interface RunResult {
  runId: string;
  /** `incomplete` = interrupted (for example cancelled); what finished is still reported. */
  status: "complete" | "incomplete" | "failed";
  doc?: SourceDoc;
  summary: ShownItem[];
  glossary: ShownItem[];
  questions: ShownItem[];
  removed: RemovedItem[];
  warnings: RunWarning[];
  /** A check could not run for at least one item; the UI must say so. */
  degraded: boolean;
  report: RunReport;
  /** Present when the run was asked for plain-language versions and got as far as writing them. */
  plain?: PlainSummary;
}

interface EventBase {
  runId: string;
  /** Strictly increasing within a run, starting at 1. */
  seq: number;
  /** ISO timestamp from the injected clock. */
  at: string;
}

export type RunEvent = EventBase &
  (
    | { type: "stage"; stage: Stage; status: "start" | "end" }
    | {
        type: "progress";
        task: string;
        scope: string;
        phase: "start" | "done" | "failed";
        detail?: string;
      }
    | { type: "draft"; item: DraftItem }
    | {
        type: "verdict";
        itemId: string;
        /** 1 = the generated draft, 2 = its repaired replacement. */
        attempt: 1 | 2;
        verdict: Verdict;
        reasons: string[];
        degraded: boolean;
      }
    | {
        type: "repaired";
        itemId: string;
        before: string;
        after: string | null;
        /** improved: better verdict; unchanged: same, repaired text adopted; rejected: worse, original kept; failed: no replacement. */
        outcome: "improved" | "unchanged" | "rejected" | "failed";
        verdict: Verdict;
        note?: string;
      }
    | { type: "removed"; itemId: string; kind: RemovalKind; reasons: string[] }
    | {
        type: "plain";
        itemId: string;
        outcome: PlainVersion["status"];
        gradeBefore: number;
        gradeAfter: number;
      }
    | { type: "warning"; code: string; message: string }
    | { type: "done"; result: RunResult }
    | {
        type: "error";
        code: "aborted" | "limit_exceeded" | "parse_failed" | "generation_failed" | "internal";
        message: string;
      }
  );

export interface PipelineInput {
  document: DocumentInput;
  /** Defaults to a fresh id from `deps.newId`. */
  runId?: string;
  /** Also write a verified plain-language version of every shown item. */
  plain?: boolean;
}

export interface PipelineDeps {
  llm: LlmClient;
  nli: Nli;
  /** Optional: near-duplicate detection and "closest sentence" hints. */
  embedder?: Embedder;
  store: RunStore;
  clock: () => Date;
  newId: () => string;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
  thresholds?: Thresholds;
  /** Parallel model calls inside one stage. */
  concurrency?: number;
  /** Model calls in flight at once across the whole run (default 8). */
  maxInFlight?: number;
  /** Per-run caps on length, model calls, cost and time. */
  limits?: RunLimits;
  /** How many questions to show. Default 5. */
  questionCount?: number;
}

export type { Drafts };
