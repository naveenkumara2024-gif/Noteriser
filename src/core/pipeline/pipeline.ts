import {
  type DraftItem,
  type GenerationOutcome,
  type GenerationProgress,
  generateDrafts,
  generateSummary,
} from "../generate";
import { parseDocument } from "../ingest";
import { readableText, sameContent, simplifyItem } from "../plain";
import { addUsage, ZERO_USAGE } from "../ports/llm";
import { readability } from "../readability";
import { isRepairable, repairItem } from "../repair";
import { makeReport } from "../report";
import type { SourceDoc } from "../schema/source";
import { limitInFlight } from "../util/limit";
import { mapPool } from "../util/pool";
import { createVerifier, toEnvelope, type Verification, type Verifier } from "../verify";
import { assemble, DEFAULT_QUESTION_COUNT, type Entry, VERDICT_RANK } from "./assemble";
import { LimitGuard } from "./guard";
import type {
  Envelope,
  PipelineDeps,
  PipelineInput,
  PlainSummary,
  RunEvent,
  RunResult,
  RunWarning,
  ShownItem,
  Stage,
} from "./types";

const DEFAULT_REVIEW_CONCURRENCY = 8;
/** Model calls in flight at once, across every stage; the stages' own limits only apply below it. */
const DEFAULT_IN_FLIGHT = 8;

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
  // One signal for everything: the caller's (a cancelled request) and the run's own limits.
  const guard = new LimitGuard(deps.limits ?? {});
  const signal = deps.signal ? AbortSignal.any([deps.signal, guard.signal]) : guard.signal;
  const llm = limitInFlight(guard.wrap(deps.llm), deps.maxInFlight ?? DEFAULT_IN_FLIGHT);
  const aborted = (): boolean => signal.aborted;

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
  let verifier: Verifier | undefined;

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

    let plain: PlainSummary | undefined;
    if (input.plain === true && status === "complete" && verifier && doc) {
      plain = await plainPass(
        [...assembled.summary, ...assembled.glossary, ...assembled.questions],
        doc,
        verifier,
      );
      if (aborted()) {
        emit({
          type: "error",
          code: "aborted",
          message: "The run was cancelled before the plain-language versions were finished.",
        });
        status = "incomplete";
      }
    }

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
      ...(plain ? { plain } : {}),
    };
    emit({ type: "done", result });
    await remember(() => deps.store.saveResult(runId, result));
    await writes;
    return result;
  };

  // --- plain language --------------------------------------------------------------------------
  /**
   * One rewrite per shown item, then the full verifier on the rewrite. Only a SUPPORTED rewrite is
   * offered; otherwise the original stays and says why. The original items are never changed.
   */
  const plainPass = async (
    shown: readonly ShownItem[],
    document: SourceDoc,
    check: Verifier,
  ): Promise<PlainSummary> => {
    stage("plain", "start");
    const drafts = new Map(entries.map((e) => [e.original.itemId, e.final.draft]));
    const gradeOf = (e: Envelope): number =>
      readability(readableText({ text: e.text, answer: "answer" in e ? e.answer : undefined }))
        .grade;
    const summary: PlainSummary = {
      attempted: 0,
      simplified: 0,
      unchanged: 0,
      keptOriginal: 0,
      gradeBefore: 0,
      gradeAfter: 0,
    };
    let before = 0;
    let after = 0;

    await mapPool(shown, concurrency, async (item) => {
      const draft = drafts.get(item.envelope.itemId);
      if (aborted() || !draft) return;
      const gradeBefore = gradeOf(item.envelope);
      summary.attempted++;

      const r = await simplifyItem(draft, document, { llm: llm, signal: signal });
      spend(r.usage);
      if (aborted()) return;

      const keep = (reason: string): void => {
        item.plain = { status: "kept_original", reason, gradeBefore };
        summary.keptOriginal++;
        before += gradeBefore;
        after += gradeBefore;
      };

      if (!r.draft) {
        keep("the simplified version could not be written");
      } else if (sameContent(draft, r.draft)) {
        item.plain = { status: "unchanged", gradeBefore };
        summary.unchanged++;
        before += gradeBefore;
        after += gradeBefore;
      } else {
        const v = await check.verify(r.draft);
        if (aborted()) return;
        spend(v.usage);
        if (v.verdict === "SUPPORTED" && !v.degraded) {
          const envelope = toEnvelope(r.draft, v);
          const gradeAfter = gradeOf(envelope);
          // A rewrite that is no easier to read is not worth offering as "plain".
          if (gradeAfter > gradeBefore) {
            keep("the simplified version was not easier to read");
          } else {
            item.plain = { status: "simplified", envelope, gradeBefore, gradeAfter };
            summary.simplified++;
            before += gradeBefore;
            after += gradeAfter;
          }
        } else {
          keep("the simplified version could not be verified");
        }
      }
      const p = item.plain;
      if (p) {
        emit({
          type: "plain",
          itemId: item.envelope.itemId,
          outcome: p.status,
          gradeBefore: p.gradeBefore,
          gradeAfter: p.status === "simplified" ? p.gradeAfter : p.gradeBefore,
        });
      }
    });

    const n = summary.simplified + summary.unchanged + summary.keptOriginal;
    summary.gradeBefore = n > 0 ? Math.round((before / n) * 10) / 10 : 0;
    summary.gradeAfter = n > 0 ? Math.round((after / n) * 10) / 10 : 0;
    stage("plain", "end");
    return summary;
  };

  // --- the run ----------------------------------------------------------------------------------
  guard.start();
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
    const maxSentences = deps.limits?.maxSentences;
    if (maxSentences !== undefined && document.sentences.length > maxSentences) {
      const tooLong = `These notes have ${document.sentences.length} sentences; the limit is ${maxSentences}. Split them into shorter parts.`;
      emit({ type: "error", code: "limit_exceeded", message: tooLong });
      warn("limit_exceeded", tooLong);
      return await finish("failed");
    }
    if (aborted()) return await abortedRun();

    verifier = createVerifier(document, {
      nli: deps.nli,
      llm: llm,
      embedder: deps.embedder,
      thresholds: deps.thresholds,
      signal: signal,
    });

    const checker = verifier;

    // verify, then repair each failing item at most once
    const review = async (drafts: readonly DraftItem[]): Promise<void> => {
      stage("verify", "start");
      const judged = await mapPool(drafts, concurrency, async (draft) => {
        if (aborted()) return undefined;
        const v = await checker.verify(draft);
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
            llm: llm,
            signal: signal,
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
          const v2 = await checker.verify(repairedDraft);
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
      llm: llm,
      signal: signal,
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
        { llm: llm, signal: signal, concurrency: deps.concurrency, onProgress: progress },
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
  } finally {
    guard.stop();
  }

  async function abortedRun(): Promise<RunResult> {
    // A tripped limit is not a cancellation: say which limit stopped the run.
    if (guard.tripped)
      emit({ type: "error", code: "limit_exceeded", message: guard.tripped.message });
    else
      emit({
        type: "error",
        code: "aborted",
        message: "The run was cancelled before it finished.",
      });
    return finish("incomplete");
  }
}
