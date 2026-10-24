import type { DraftItem } from "../generate/types";
import type { RunEvent, RunResult } from "../pipeline/types";
import type { SourceDoc } from "../schema/source";
import type { Verification } from "../verify/verify";

export type RunStatus = "running" | RunResult["status"];

/** An event as stored: a `done` event keeps its fields except `result`, which is stored once, separately. */
export type StoredEvent = RunEvent extends infer E
  ? E extends { type: "done" }
    ? Omit<E, "result">
    : E
  : never;

/** Everything kept about a run: the audit trail the review checklist and the evaluation read. */
export interface StoredRun {
  runId: string;
  createdAt: string;
  status: RunStatus;
  doc?: SourceDoc;
  /** attempt 1 = as generated, attempt 2 = repaired replacement. */
  drafts: { attempt: 1 | 2; item: DraftItem }[];
  verifications: { attempt: 1 | 2; item: Verification }[];
  events: StoredEvent[];
  result?: RunResult;
}

/**
 * Persistence for runs. Source text (inside `doc`) is stored because an audit needs it, and is
 * therefore sensitive: implementations must never write it to logs, and `purgeOlderThan` enforces
 * the retention period.
 */
export interface RunStore {
  createRun(runId: string, createdAt: Date): Promise<void>;
  saveDoc(runId: string, doc: SourceDoc): Promise<void>;
  /** A `done` event is stored without its `result` (saved separately by `saveResult`). */
  appendEvent(runId: string, event: RunEvent): Promise<void>;
  saveDrafts(runId: string, attempt: 1 | 2, drafts: readonly DraftItem[]): Promise<void>;
  saveVerifications(
    runId: string,
    attempt: 1 | 2,
    verifications: readonly Verification[],
  ): Promise<void>;
  saveResult(runId: string, result: RunResult): Promise<void>;
  getRun(runId: string): Promise<StoredRun | undefined>;
  /** True if a run was deleted. Removes everything stored for it. */
  deleteRun(runId: string): Promise<boolean>;
  /** Deletes runs created before `cutoff`; returns how many. */
  purgeOlderThan(cutoff: Date): Promise<number>;
  /** One JSON object per line: run, doc, events, drafts, verifications, result. */
  exportJsonl(runId: string): Promise<string | undefined>;
}
