import type { RunEvent, Stage } from "@/core/pipeline";
import { copy, removalLabel, verdictLabel } from "./copy";

export const STAGES: readonly Stage[] = ["parse", "generate", "verify", "repair", "assemble"];

/** The stage list for a run: plain-language versions add a last stage. */
export const stagesFor = (plain: boolean): readonly Stage[] =>
  plain ? [...STAGES, "plain"] : STAGES;

/**
 * One line of the activity log. It names an event, an item id and a verdict or outcome word, and
 * nothing else: no item text, no source text, no verifier reasons (they quote both).
 */
export interface ActivityLine {
  seq: number;
  /** ISO timestamp from the run. */
  at: string;
  kind: "stage" | "item" | "notice" | "error";
  text: string;
}

/** The log keeps only the newest lines; a long run would otherwise grow it without end. */
export const ACTIVITY_LIMIT = 200;

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
  /** What each drafted item is, so later events can say "glossary g-3" instead of just an id. */
  itemTypes: Record<string, string>;
  activity: ActivityLine[];
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
  itemTypes: {},
  activity: [],
};

const TYPE_WORD: Record<string, string> = {
  summary_point: "summary point",
  glossary: "glossary entry",
  question: "question",
};

const labelOf = (state: ProgressState, itemId: string): string =>
  `${TYPE_WORD[state.itemTypes[itemId] ?? ""] ?? "item"} ${itemId}`;

/** The log line for an event, or null when the event is not worth a line (for example `done`). */
export function activityLine(state: ProgressState, event: RunEvent): ActivityLine | null {
  const base = { seq: event.seq, at: event.at };
  const t = copy.activity;
  switch (event.type) {
    case "stage":
      return {
        ...base,
        kind: "stage",
        text: `${copy.progress.stageLabel[event.stage]}: ${event.status === "start" ? t.started : t.finished}`,
      };
    case "draft":
      return {
        ...base,
        kind: "item",
        text: t.drafted(`${TYPE_WORD[event.item.type] ?? "item"} ${event.item.itemId}`),
      };
    case "verdict":
      return {
        ...base,
        kind: "item",
        text: t.checked(
          labelOf(state, event.itemId),
          verdictLabel[event.verdict],
          event.attempt === 2,
        ),
      };
    case "repaired":
      return {
        ...base,
        kind: "item",
        text: t.repaired(labelOf(state, event.itemId), event.outcome),
      };
    case "removed":
      return {
        ...base,
        kind: "item",
        text: t.removed(labelOf(state, event.itemId), removalLabel[event.kind]),
      };
    case "plain":
      return { ...base, kind: "item", text: t.plain(labelOf(state, event.itemId), event.outcome) };
    case "warning":
      return { ...base, kind: "notice", text: t.notice(event.code.replaceAll("_", " ")) };
    case "error":
      return { ...base, kind: "error", text: t.stopped(event.code.replaceAll("_", " ")) };
    default:
      return null;
  }
}

const withLine = (state: ProgressState, event: RunEvent): ProgressState => {
  const line = activityLine(state, event);
  if (!line) return state;
  return { ...state, activity: [...state.activity, line].slice(-ACTIVITY_LIMIT) };
};

/** Folds one run event into what the progress panel shows. Pure, so it is tested without a browser. */
export function reduceProgress(state: ProgressState, event: RunEvent): ProgressState {
  return withLine(fold(state, event), event);
}

function fold(state: ProgressState, event: RunEvent): ProgressState {
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
      return {
        ...state,
        drafted: state.drafted + 1,
        itemTypes: { ...state.itemTypes, [event.item.itemId]: event.item.type },
      };
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
