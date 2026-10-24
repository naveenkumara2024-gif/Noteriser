import {
  type DraftItem,
  type GenerationOutcome,
  type GenerationProgress,
  generateDrafts,
  generateSummary,
} from "../generate";
import { parseDocument } from "../ingest";
import { addUsage, ZERO_USAGE } from "../ports/llm";
import { isRepairable, repairItem } from "../repair";
import { makeReport } from "../report";
import type { SourceDoc } from "../schema/source";
import { mapPool } from "../util/pool";
import { createVerifier, type Verification } from "../verify";
import { assemble, DEFAULT_QUESTION_COUNT, type Entry, VERDICT_RANK } from "./assemble";
import type { PipelineDeps, PipelineInput, RunEvent, RunResult, RunWarning, Stage } from "./types";

const DEFAULT_REVIEW_CONCURRENCY = 4;

/** An event without the fields the pipeline stamps on it. */
type EventBody = RunEvent extends infer E
  ? E extends RunEvent
    ? Omit<E, "runId" | "seq" | "at">
    : never
  : never;

const isShown = (v: Verification): boolean => v.verdict === "SUPPORTED" || v.verdict === "PARTIAL";
const idNumber = (id: string): number => Number(/-(\d+)$/.exec(id)?.[1] ?? 0);
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * One run, end to end: parse -> generate -> verify -> repair once -> assemble. It never throws:
 * a cancelled run is `incomplete`, a broken one is `failed`, and in both the result says what
 * finished. Every degradation is an event and a warning; nothing is silently skipped.
 *
 * Each draft is one `Entry` for its whole life, so every generated item ends up shown or listed
 * as removed, and the report's counts reconcile against an independent count of drafts.
 */
export async function runPipeline(input: PipelineInput, deps: PipelineDeps): Promise<RunResult> {
  const runId = input.runId ?? deps.newId();
  const questionCount = deps.questionCount ?? DEFAULT_QUESTION_COUNT;
  const concurrency = deps.concurrency ?? DEFAULT_REVIEW_CONCURRENCY;
  const aborted = (): boolean => deps.signal?.aborted === true;

  let seq = 0;
  let storeFailureReported = false;
  const warnings: RunWarning[] = [];
  const warned = new Set<string>();
  const entries: Entry[] = [];
  const pending = new Map<string, DraftItem>(); // generated, not yet judged
  let doc: SourceDoc | undefined;
  let generated = 0;
  let usage = ZERO_USAGE;
  let repairsAttempted = 0;
  let repairsImproved = 0;
  let degraded = false;

  // --- events and persistence ----------------------------------------------------------------
  const emit = (body: EventBody, persist = true): void => {
    const event = { ...body, runId, seq: ++seq, at: deps.clock().toISOString() } as RunEvent;
    try {
      deps.onEvent?.(event);
    } catch {
      // a broken listener must not stop the run
    }
    if (persist) void remember(() => deps.store.appendEvent(runId, event));
  };
  let writes: Promise<void> = Promise.resolve();
  /** Store writes are queued so events land in order, and a failing store is reported once. */
  const remember = (write: () => Promise<void>): Promise<void> => {
    writes = writes.then(async () => {
      try {
        await write();
      } catch (e) {
        if (storeFailureReported) return;
        storeFailureReported = true;
        const w = {
          code: "audit_log_unavailable",
          message: `The audit log could not be written (${message(e)}); the run continues without it.`,
        };
        warnings.push(w);
        emit({ type: "warning", ...w }, false);
      }
    });
    return writes;
  };
  const warn = (code: string, text: string, once = false): void => {
    if (once && warned.has(code)) return;
    warned.add(code);
    warnings.push({ code, message: text });
    emit({ type: "warning", code, message: text });
  };
  const stage = (s: Stage, status: "start" | "end"): void =>
    emit({ type: "stage", stage: s, status });
  const spend = (u: typeof usage): void => {
    usage = addUsage(usage, u);
  };
  const progress = (p: GenerationProgress): void => emit({ type: "progress", ...p });

  const collect = (label: string, o: GenerationOutcome): void => {
    spend(o.usage);
    for (const f of o.failures) {
      warn(
        "generation_failed",
        `${label} for ${f.scope} could not be generated: ${f.error.message}`,
      );
    }
    for (const i of o.insufficient) {
      // Small models sometimes return junk ("**") as the reason; say so rather than show it.
      const words = i.reason.match(/\p{L}{3,}/gu) ?? [];
      const reason = words.length >= 2 ? i.reason : "the model gave no usable reason";
      warn("insufficient_source", `${label} for ${i.scope}: ${reason}`);
    }
    for (const p of o.problems) warn("generation_problem", `${label}: ${p}`);
  };

  const register = (drafts: readonly DraftItem[]): void => {
    for (const d of drafts) {
      pending.set(d.itemId, d);
      generated++;
      emit({ type: "draft", item: d });
    }
    void remember(() => deps.store.saveDrafts(runId, 1, drafts));
  };

  // --- finishing ------------------------------------------------------------------------------
  const finish = async (status: RunResult["status"]): Promise<RunResult> => {
    stage("assemble", "start");
    let assembled: Awaited<ReturnType<typeof assemble>>;
    try {
      assembled = await assemble(entries, { questionCount, embedder: deps.embedder });
    } catch (e) {
      warn("assemble_failed", `Assembling the results failed: ${message(e)}`);
      status = "failed";
      assembled = { summary: [], glossary: [], questions: [], removed: [], warnings: [] };
    }
    for (const w of assembled.warnings) warn(w.code, w.message);
    for (const r of assembled.removed) {
      emit({ type: "removed", itemId: r.envelope.itemId, kind: r.kind, reasons: r.reasons });
    }
    stage("assemble", "end");

    const report = makeReport({
      doc,
      generated,
      shown: [...assembled.summary, ...assembled.glossary, ...assembled.questions],
      removed: assembled.removed,
      unreviewed: [...pending.values()],
      usage,
      repairsAttempted,
      repairsSucceeded: repairsImproved,
    });
    if (!report.reconciles) {
      warn("report_mismatch", "The report counts do not add up; an item is unaccounted for.");
    }

    const result: RunResult = {
      runId,
      status,
      ...(doc ? { doc } : {}),
      summary: assembled.summary,
      glossary: assembled.glossary,
      questions: assembled.questions,
      removed: assembled.removed,
      warnings,
      degraded,
      report,
    };
    emit({ type: "done", result });
    await remember(() => deps.store.saveResult(runId, result));
    await writes;
    return result;
  };

  // --- the run ----------------------------------------------------------------------------------
  try {
    await remember(() => deps.store.createRun(runId, deps.clock()));

    // parse
    stage("parse", "start");
    const parsed = await parseDocument(input.document);
    if (!parsed.ok) {
      emit({ type: "error", code: "parse_failed", message: parsed.error.message });
      return await finish("failed");
    }
    doc = parsed.value;
    const document = doc;
    void remember(() => deps.store.saveDoc(runId, document));
    for (const w of document.warnings) warn(`document_${w.kind}`, w.detail);
    stage("parse", "end");
    if (aborted()) return await abortedRun();

    const verifier = createVerifier(document, {
      nli: deps.nli,
      llm: deps.llm,
      embedder: deps.embedder,
      thresholds: deps.thresholds,
      signal: deps.signal,
    });

    // verify, then repair each failing item at most once
    const review = async (drafts: readonly DraftItem[]): Promise<void> => {
      stage("verify", "start");
      const judged = await mapPool(drafts, concurrency, async (draft) => {
        if (aborted()) return undefined;
        const v = await verifier.verify(draft);
        // A verification cut short by cancellation is not a verdict.
        if (aborted()) return undefined;
        spend(v.usage);
        emit({
          type: "verdict",
          itemId: draft.itemId,
          attempt: 1,
          verdict: v.verdict,
          reasons: v.reasons,
          degraded: v.degraded,
        });
        return { draft, v };
      });
      const done = judged.filter(
        (j): j is { draft: DraftItem; v: Verification } => j !== undefined,
      );
      const fresh: Entry[] = done.map(({ draft, v }) => ({
        original: draft,
        v1: v,
        final: { draft, v, repaired: false },
      }));
      for (const e of fresh) pending.delete(e.original.itemId);
      entries.push(...fresh);
      void remember(() =>
        deps.store.saveVerifications(
          runId,
          1,
          done.map((d) => d.v),
        ),
      );
      if (done.some((d) => d.v.degraded)) {
        degraded = true;
        warn(
          "verifier_degraded",
          "Some checks could not run, so those items are capped at PARTIAL. Do not treat them as verified.",
          true,
        );
      }
      stage("verify", "end");
      if (aborted()) return;

      stage("repair", "start");
      const second: Verification[] = [];
      await mapPool(
        fresh.filter((e) => isRepairable(e.v1.verdict)),
        concurrency,
        async (e) => {
          if (aborted()) return;
          repairsAttempted++;
          const r = await repairItem(e.original, e.v1.reasons, document, {
            llm: deps.llm,
            signal: deps.signal,
          });
          spend(r.usage);
          if (aborted()) return;

          const before = e.original.text;
          if (!r.draft) {
            e.repair = { outcome: "failed", ...(r.note ? { note: r.note } : {}) };
            emit({
              type: "repaired",
              itemId: e.original.itemId,
              before,
              after: null,
              outcome: "failed",
              verdict: e.final.v.verdict,
              ...(r.note ? { note: r.note } : {}),
            });
            return;
          }
          const repairedDraft = r.draft;
          void remember(() => deps.store.saveDrafts(runId, 2, [repairedDraft]));
          const v2 = await verifier.verify(repairedDraft);
          if (aborted()) return;
          spend(v2.usage);
          second.push(v2);
          if (v2.degraded) degraded = true;
          emit({
            type: "verdict",
            itemId: repairedDraft.itemId,
            attempt: 2,
            verdict: v2.verdict,
            reasons: v2.reasons,
            degraded: v2.degraded,
          });

          const change = VERDICT_RANK[v2.verdict] - VERDICT_RANK[e.v1.verdict];
          // A repair that made things worse is discarded; the original stands.
          const outcome = change > 0 ? "improved" : change === 0 ? "unchanged" : "rejected";
          if (change >= 0) e.final = { draft: repairedDraft, v: v2, repaired: true };
          if (change > 0) repairsImproved++;
          e.repair = { outcome };
          emit({
            type: "repaired",
            itemId: e.original.itemId,
            before,
            after: repairedDraft.text,
            outcome,
            verdict: e.final.v.verdict,
          });
        },
      );
      if (second.length > 0) void remember(() => deps.store.saveVerifications(runId, 2, second));
      stage("repair", "end");
    };

    // generate
    stage("generate", "start");
    const drafts = await generateDrafts(document, {
      llm: deps.llm,
      signal: deps.signal,
      concurrency: deps.concurrency,
      onProgress: progress,
    });
    collect("Summary", drafts.summary);
    collect("Glossary", drafts.glossary);
    collect("Questions", drafts.questions);
    register([...drafts.summary.items, ...drafts.glossary.items, ...drafts.questions.items]);
    stage("generate", "end");
    if (aborted()) return await abortedRun();

    // If every model call failed there is nothing to review: that is a failed run, not an empty
    // success. (Calls that merely found the notes insufficient are not failures.)
    const failures = [drafts.summary, drafts.glossary, drafts.questions].flatMap((o) => o.failures);
    if (generated === 0 && failures.length > 0) {
      const first = failures[0]?.error.message ?? "unknown error";
      emit({
        type: "error",
        code: "generation_failed",
        message: `Every model call failed, so nothing could be generated. First error: ${first}`,
      });
      return await finish("failed");
    }

    await review([...pending.values()]);
    if (aborted()) return await abortedRun();

    // coverage: every section should have a summary point; one targeted retry for those without
    const uncovered = (): number[] => {
      const sectionOf = new Map(document.sentences.map((s) => [s.id, s.section]));
      const covered = new Set<number>();
      for (const e of entries) {
        if (e.final.draft.type !== "summary_point" || !isShown(e.final.v)) continue;
        for (const id of e.final.draft.sourceIds) {
          const section = sectionOf.get(id);
          if (section !== undefined) covered.add(section);
        }
      }
      return document.sections.map((s) => s.number).filter((n) => !covered.has(n));
    };

    const missing = uncovered();
    if (missing.length > 0) {
      const next =
        Math.max(
          0,
          ...entries.map((e) => idNumber(e.original.itemId)),
          ...[...pending.keys()].map(idNumber),
        ) + 1;
      stage("generate", "start");
      const retry = await generateSummary(
        document,
        { llm: deps.llm, signal: deps.signal, concurrency: deps.concurrency, onProgress: progress },
        { sections: missing, startAt: next, rollup: false },
      );
      collect("Summary (coverage retry)", retry);
      register(retry.items);
      stage("generate", "end");
      if (aborted()) return await abortedRun();
      if (retry.items.length > 0) await review(retry.items);
      if (aborted()) return await abortedRun();

      const still = uncovered();
      if (still.length > 0) {
        warn(
          "coverage_gap",
          `No summary point could be supported for section(s) ${still.join(", ")}; the summary does not cover them.`,
        );
      }
    }

    return await finish("complete");
  } catch (e) {
    emit({ type: "error", code: "internal", message: message(e) });
    try {
      return await finish("failed");
    } catch {
      // Last resort: a minimal result so the caller still gets a value.
      return {
        runId,
        status: "failed",
        summary: [],
        glossary: [],
        questions: [],
        removed: [],
        warnings,
        degraded,
        report: makeReport({
          doc,
          generated,
          shown: [],
          removed: [],
          unreviewed: [...pending.values()],
          usage,
          repairsAttempted,
          repairsSucceeded: repairsImproved,
        }),
      };
    }
  }

  async function abortedRun(): Promise<RunResult> {
    emit({ type: "error", code: "aborted", message: "The run was cancelled before it finished." });
    return finish("incomplete");
  }
}
