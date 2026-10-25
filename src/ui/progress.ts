import type { RunEvent, Stage } from "@/core/pipeline";

export const STAGES: readonly Stage[] = ["parse", "generate", "verify", "repair", "assemble"];

/** The stage list for a run: plain-language versions add a last stage. */
export const stagesFor = (plain: boolean): readonly Stage[] =>
  plain ? [...STAGES, "plain"] : STAGES;

export interface ProgressState {
  /** The stage currently running, if any. */
  current: Stage | null;
  finished: Stage[];
  drafted: number;
  /** Verdicts received for first-attempt drafts. */
  checked: number;
  repaired: number;
  removed: number;
  /** Set when the stream carried a `done` event. */
  runId: string | null;
  /** The last error event, if any. */
  error: { code: string; message: string } | null;
}

export const initialProgress: ProgressState = {
  current: null,
  finished: [],
  drafted: 0,
  checked: 0,
  repaired: 0,
  removed: 0,
  runId: null,
  error: null,
};

/** Folds one run event into what the progress panel shows. Pure, so it is tested without a browser. */
export function reduceProgress(state: ProgressState, event: RunEvent): ProgressState {
  switch (event.type) {
    case "stage":
      return event.status === "start"
        ? { ...state, current: event.stage }
        : {
            ...state,
            current: state.current === event.stage ? null : state.current,
            finished: state.finished.includes(event.stage)
              ? state.finished
              : [...state.finished, event.stage],
          };
    case "draft":
      return { ...state, drafted: state.drafted + 1 };
    case "verdict":
      return event.attempt === 1 ? { ...state, checked: state.checked + 1 } : state;
    case "repaired":
      return event.outcome === "improved" || event.outcome === "unchanged"
        ? { ...state, repaired: state.repaired + 1 }
        : state;
    case "removed":
      return { ...state, removed: state.removed + 1 };
    case "done":
      return { ...state, runId: event.runId };
    case "error":
      return { ...state, error: { code: event.code, message: event.message } };
    default:
      return state;
  }
}

export type StageStatus = "waiting" | "active" | "done";

export function stageStatus(state: ProgressState, stage: Stage): StageStatus {
  if (state.finished.includes(stage)) return "done";
  return state.current === stage ? "active" : "waiting";
}
