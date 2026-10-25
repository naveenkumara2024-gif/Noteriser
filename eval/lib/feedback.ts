import type { RunStore, StoredFeedback } from "../../src/core/ports/store";
import type { EvalCase } from "./cases";
import { regressionFromRun } from "./regression";

export interface Candidate {
  /** File name under eval/regressions/candidates/. */
  file: string;
  case: EvalCase & {
    candidate: {
      runId: string;
      itemId: string;
      kinds: string[];
      notes: string[];
      /** Why this is not yet a regression case. */
      status: "needs review";
    };
  };
}

export interface FeedbackSkip {
  runId: string;
  itemId: string;
  why: string;
}

const safe = (s: string): string => s.replace(/[^A-Za-z0-9-]/g, "").slice(0, 12) || "x";

/**
 * Candidate regression cases from instructors' feedback. Several marks on one item become one
 * candidate with all the notes. The draft is the wording that was SHOWN (the repaired one if the
 * item was repaired). Labels are a starting guess ("bad", no failure type): a person decides what
 * is actually wrong, fills in `failureType`, and moves the file up to eval/regressions/, where it
 * is loaded like any other case. Nothing here is loaded until then.
 */
export async function candidatesFromFeedback(
  store: RunStore,
  feedback: readonly StoredFeedback[],
): Promise<{ candidates: Candidate[]; skipped: FeedbackSkip[] }> {
  const groups = new Map<string, StoredFeedback[]>();
  for (const f of feedback)
    groups.set(`${f.runId}\n${f.itemId}`, [...(groups.get(`${f.runId}\n${f.itemId}`) ?? []), f]);

  const candidates: Candidate[] = [];
  const skipped: FeedbackSkip[] = [];

  for (const marks of groups.values()) {
    const first = marks[0];
    if (!first) continue;
    const { runId, itemId } = first;
    const run = await store.getRun(runId);
    if (!run?.result) {
      skipped.push({ runId, itemId, why: "the run is gone (deleted or expired)" });
      continue;
    }
    const shown = [...run.result.summary, ...run.result.glossary, ...run.result.questions].find(
      (s) => s.envelope.itemId === itemId,
    );
    if (!shown) {
      skipped.push({ runId, itemId, why: "the item is not in the run's results" });
      continue;
    }
    try {
      const base = await regressionFromRun(run, {
        id: `fb-${safe(runId)}-${itemId}`,
        itemId,
        label: "bad",
        // A bad draft needs a failure type; this placeholder is replaced during review.
        failureType: "outside_fact",
        attempt: shown.repaired ? 2 : 1,
      });
      candidates.push({
        file: `${base.id}.json`,
        case: {
          ...base,
          drafts: base.drafts.map((d) => ({ ...d, failureType: null })),
          candidate: {
            runId,
            itemId,
            kinds: [...new Set(marks.map((m) => m.kind))],
            notes: marks.map((m) => m.note).filter((n) => n !== ""),
            status: "needs review",
          },
        },
      });
    } catch (e) {
      skipped.push({ runId, itemId, why: e instanceof Error ? e.message : String(e) });
    }
  }
  return { candidates, skipped };
}
