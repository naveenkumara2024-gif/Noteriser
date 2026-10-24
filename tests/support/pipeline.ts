import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PipelineDeps, RunEvent, RunResult } from "@/core/pipeline";
import { runPipeline } from "@/core/pipeline";
import { lecture7Fakes } from "@/demo";
import { MemoryRunStore } from "@/store/memory";

export const LECTURE7 = readFileSync(resolve(process.cwd(), "fixtures/lecture7.md"), "utf8");

export interface Harness {
  result: RunResult;
  events: RunEvent[];
  store: MemoryRunStore;
  deps: PipelineDeps;
}

/** Fixed clock and ids so runs are reproducible. */
export function baseDeps(over: Partial<PipelineDeps> = {}): PipelineDeps {
  let n = 0;
  const fakes = lecture7Fakes();
  return {
    llm: fakes.llm,
    nli: fakes.nli,
    embedder: fakes.embedder,
    store: new MemoryRunStore(),
    clock: () => new Date("2026-10-24T12:00:00.000Z"),
    newId: () => `run-${++n}`,
    ...over,
  };
}

/** Run the pipeline and capture its events. By default it uses the scripted lecture-7 fakes. */
export async function runWith(
  over: Partial<PipelineDeps> = {},
  text: string = LECTURE7,
): Promise<Harness> {
  const events: RunEvent[] = [];
  const store = (over.store as MemoryRunStore | undefined) ?? new MemoryRunStore();
  const deps = baseDeps({
    ...over,
    store,
    onEvent: (e) => {
      events.push(e);
      over.onEvent?.(e);
    },
  });
  const result = await runPipeline({ document: { kind: "text", text } }, deps);
  return { result, events, store, deps };
}

/** Checks that must hold for ANY finished run, whatever happened in it. */
export function invariantViolations(h: Harness): string[] {
  const { result, events } = h;
  const bad: string[] = [];
  const shown = [...result.summary, ...result.glossary, ...result.questions];
  const shownIds = shown.map((s) => s.envelope.itemId);
  const removedIds = result.removed.map((r) => r.envelope.itemId);

  if (!result.report.reconciles) bad.push("report does not reconcile");
  const r = result.report;
  if (r.generated !== r.supported + r.partial + r.removed + r.unreviewed) {
    bad.push("generated != supported + partial + removed + unreviewed");
  }
  if (r.supported + r.partial !== shown.length) bad.push("report shown count != shown items");
  if (r.removed !== result.removed.length) bad.push("report removed count != removed items");

  for (const id of shownIds)
    if (removedIds.includes(id)) bad.push(`${id} is both shown and removed`);
  if (new Set([...shownIds, ...removedIds]).size !== shownIds.length + removedIds.length) {
    bad.push("an item appears more than once");
  }

  for (const s of shown) {
    const e = s.envelope;
    if (e.verdict !== "SUPPORTED" && e.verdict !== "PARTIAL")
      bad.push(`${e.itemId} shown as ${e.verdict}`);
    if (s.flagged !== (e.verdict === "PARTIAL"))
      bad.push(`${e.itemId} flag does not match verdict`);
    if (!e.scores.quoteFound) bad.push(`${e.itemId} shown without a verified quote`);
    if (e.verdict === "SUPPORTED") {
      // Invariant 1: all four checks ran and passed.
      if (e.scores.entailment === null) bad.push(`${e.itemId} SUPPORTED without entailment`);
      if (e.scores.judge !== "pass") bad.push(`${e.itemId} SUPPORTED without a judge pass`);
      if (e.flagReason !== null) bad.push(`${e.itemId} SUPPORTED but has a flag reason`);
    } else if (!e.flagReason) {
      bad.push(`${e.itemId} flagged without a reason`);
    }
  }
  for (const x of result.removed) {
    if (x.reasons.length === 0) bad.push(`${x.envelope.itemId} removed without a reason`);
  }

  const seqs = events.map((e) => e.seq);
  if (seqs.some((s, i) => s !== i + 1)) bad.push("event seq is not 1,2,3,...");
  if (events.some((e) => e.runId !== result.runId)) bad.push("event with a different runId");

  const repairedEvents = events.filter((e) => e.type === "repaired");
  const perItem = new Map<string, number>();
  for (const e of repairedEvents) perItem.set(e.itemId, (perItem.get(e.itemId) ?? 0) + 1);
  for (const [id, n] of perItem) if (n > 1) bad.push(`${id} repaired ${n} times`);
  if (r.repairsAttempted < repairedEvents.length) bad.push("more repair events than attempts");

  const last = events.at(-1);
  if (last?.type !== "done") bad.push("last event is not done");
  if (events.filter((e) => e.type === "done").length !== 1) bad.push("not exactly one done event");

  const drafts = events.filter((e) => e.type === "draft").length;
  if (drafts !== r.generated) bad.push(`draft events (${drafts}) != generated (${r.generated})`);
  return bad;
}
