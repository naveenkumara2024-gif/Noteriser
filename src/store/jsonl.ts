import type { RunEvent } from "../core/pipeline/types";
import type { StoredEvent, StoredRun } from "../core/ports/store";

/** A `done` event is stored without its result, which is large and kept in `runs`. */
export function toStoredEvent(event: RunEvent): StoredEvent {
  if (event.type !== "done") return event;
  const { result: _result, ...rest } = event;
  return rest;
}

/**
 * One JSON object per line, in a stable order: the run, its source document, every event, every
 * draft and verification (with attempt number), and the final result. Contains source text, so it
 * is as sensitive as the run itself.
 */
export function toJsonl(run: StoredRun): string {
  const lines: unknown[] = [
    { kind: "run", runId: run.runId, createdAt: run.createdAt, status: run.status },
  ];
  if (run.doc) lines.push({ kind: "doc", doc: run.doc });
  for (const event of run.events) lines.push({ kind: "event", event });
  for (const d of run.drafts) lines.push({ kind: "draft", attempt: d.attempt, item: d.item });
  for (const v of run.verifications) {
    lines.push({ kind: "verification", attempt: v.attempt, item: v.item });
  }
  if (run.result) lines.push({ kind: "result", result: run.result });
  return `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
}
