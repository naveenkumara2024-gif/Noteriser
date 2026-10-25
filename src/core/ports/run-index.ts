import type { RunStatus } from "./store";

/** What the history list shows about one run. Never contains source sentences or item text. */
export interface RunSummary {
  runId: string;
  /** The document's title, else its first section title, else "Untitled"; cut at {@link TITLE_MAX}. */
  title: string;
  /** ISO timestamp. */
  createdAt: string;
  status: RunStatus;
  /** Null while the run has no result yet. */
  counts: { generated: number; supported: number; partial: number; removed: number } | null;
  /** A check could not run for at least one item. */
  degraded: boolean;
}

export const TITLE_MAX = 120;

/** Light read model over stored runs: enough for a history list without loading whole audit trails. */
export interface RunIndex {
  /** Summaries for the ids that exist, newest first. Unknown ids are skipped. */
  summaries(runIds: readonly string[]): Promise<RunSummary[]>;
}

/** The one rule for a run's display title, shared by every store. */
export function titleFrom(
  title: string | null | undefined,
  firstSectionTitle: string | null | undefined,
): string {
  const raw = title?.trim() || firstSectionTitle?.trim() || "Untitled";
  return raw.length > TITLE_MAX ? `${raw.slice(0, TITLE_MAX - 1)}…` : raw;
}

export const titleOf = (
  doc: { title?: string; sections: readonly { title: string }[] } | undefined,
): string => titleFrom(doc?.title, doc?.sections[0]?.title);
