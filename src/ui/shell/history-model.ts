import type { RunSummary } from "@/core/ports/run-index";

/** Lowercase, accents removed: "Électricité" is found by "electricite". */
export function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .trim();
}

export function filterRuns(runs: readonly RunSummary[], query: string): RunSummary[] {
  const q = normalise(query);
  return q === "" ? [...runs] : runs.filter((r) => normalise(r.title).includes(q));
}

export interface ProjectGroup {
  /** The source title shared by the runs. */
  title: string;
  /** Newest first. */
  runs: RunSummary[];
}

/** Runs that share a source title, newest group first. Derived: nothing is stored for a "project". */
export function groupByTitle(runs: readonly RunSummary[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const run of [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const key = normalise(run.title);
    const group = groups.get(key);
    if (group) group.runs.push(run);
    else groups.set(key, { title: run.title, runs: [run] });
  }
  return [...groups.values()];
}

export type RowStatusKind = "running" | "failed" | "incomplete" | "degraded" | "flagged";

/** What a row says besides its title, or null for an ordinary finished run. Words come from copy. */
export function rowStatus(run: RunSummary): RowStatusKind | null {
  if (run.status === "running") return "running";
  if (run.status === "failed") return "failed";
  if (run.status === "incomplete") return "incomplete";
  if (run.degraded) return "degraded";
  if ((run.counts?.partial ?? 0) > 0) return "flagged";
  return null;
}
