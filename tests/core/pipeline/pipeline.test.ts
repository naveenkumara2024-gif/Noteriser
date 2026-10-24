import { describe, expect, it } from "vitest";
import { TOOL_NAMES } from "@/core/generate";
import type { RunEvent } from "@/core/pipeline";
import { lecture7Llm } from "@/demo";
import { FakeLlmClient, fail, type RecordedRequest } from "@/llm/fake";
import { ENTAILED, FakeNli } from "@/nlp/fake";
import { MemoryRunStore } from "@/store/memory";
import { baseDeps, invariantViolations, LECTURE7, runWith } from "../../support/pipeline";

const reply = (items: unknown[], insufficient_reason = "") => ({ items, insufficient_reason });
const point = (ids: string[], quote: string, text: string) => ({
  source_ids: ids,
  evidence_quote: quote,
  text,
});
const sectionOf = (req: RecordedRequest): number =>
  Number(/Section (\d+),/.exec(req.user)?.[1] ?? 0);
const PASS = { unsupported_parts: [], verdict: "pass" };

describe("lore §6.5 scenario (scripted)", () => {
  it("accounts for every draft: 24 generated = 18 supported + 1 partial + 5 removed", async () => {
    const { result } = await runWith();
    expect(result.status).toBe("complete");
    expect(result.report).toMatchObject({
      sourceSentences: 15,
      sections: 3,
      generated: 24,
      supported: 18,
      partial: 1,
      removed: 5,
      unreviewed: 0,
      surplus: 2,
      coveragePercent: 100,
      reconciles: true,
    });
    expect(result.summary).toHaveLength(6);
    expect(result.glossary).toHaveLength(8);
    expect(result.questions).toHaveLength(5);
    expect(result.warnings).toEqual([]);
    expect(result.degraded).toBe(false);
  });

  it("removes 'the most widely used scheduler…' with the reason, after one failed repair", async () => {
    const { result } = await runWith();
    const gone = result.removed.find((r) => r.envelope.text.includes("most widely used"));
    expect(gone).toMatchObject({ kind: "unsupported", repairAttempted: true });
    expect(gone?.reasons[0]).toContain("does not support");
    expect(gone?.repairNote).toContain("could not write a supported replacement");
    expect(result.summary.some((s) => s.envelope.text.includes("most widely used"))).toBe(false);
  });

  it("removes the contradicted claim and never tries to repair it", async () => {
    const llm = lecture7Llm();
    const { result } = await runWith({ llm });
    const gone = result.removed.find((r) => r.envelope.text.includes("impossible"));
    expect(gone).toMatchObject({ kind: "contradicted", repairAttempted: false });
    expect(gone?.reasons[0]).toContain("opposite");
    const repairRequests = llm.requests.filter((r) => r.user.includes("<item_to_repair>"));
    expect(repairRequests.some((r) => r.user.includes("impossible"))).toBe(false);
  });

  it("narrows the 'Preemption' glossary entry by repair, and shows it flagged as PARTIAL", async () => {
    const { result } = await runWith();
    const preemption = result.glossary.find((g) => g.envelope.itemId === "glo-8");
    expect(preemption).toMatchObject({ flagged: true, repaired: true });
    expect(preemption?.envelope.verdict).toBe("PARTIAL");
    expect(preemption?.originalText).toBe("Forcibly taking the CPU away from a running process.");
    expect(preemption?.envelope.text).toBe(
      "A process being stopped after its time slice and placed at the end of the ready queue.",
    );
    expect(preemption?.envelope.flagReason).toContain("partly supported");
  });

  it("drops the question with invented numbers and fills its place: exactly five questions", async () => {
    const { result } = await runWith();
    const texts = result.questions.map((q) => q.envelope.text);
    expect(texts.some((t) => t.includes("typical time quantum"))).toBe(false);
    expect(result.removed.find((r) => r.envelope.itemId === "q-6")).toMatchObject({
      kind: "unsupported",
    });
    expect(result.questions).toHaveLength(5);
  });

  it("mixes question types and prefers supported questions", async () => {
    const { result } = await runWith();
    const types = result.questions.map((q) => (q.envelope as { qtype: string }).qtype);
    expect(new Set(types)).toEqual(new Set(["short", "true_false", "mcq"]));
    expect(result.questions.every((q) => q.envelope.verdict === "SUPPORTED")).toBe(true);
  });

  it("lists duplicates and surplus questions instead of hiding them", async () => {
    const { result } = await runWith();
    expect(result.removed.find((r) => r.envelope.itemId === "q-8")).toMatchObject({
      kind: "duplicate",
      duplicateOf: "q-1",
      reasons: ["Duplicate of q-1."],
    });
    const surplus = result.removed.find((r) => r.kind === "surplus");
    expect(surplus?.envelope.verdict).toBe("SUPPORTED"); // valid, just not needed
    expect(surplus?.reasons[0]).toContain("not needed");
  });

  it("satisfies every run invariant", async () => {
    expect(invariantViolations(await runWith())).toEqual([]);
  });
});

describe("events", () => {
  it("are numbered 1,2,3,… and stamped with the run id and the clock", async () => {
    const { events, result } = await runWith();
    expect(events[0]?.seq).toBe(1);
    expect(events.every((e, i) => e.seq === i + 1)).toBe(true);
    expect(
      events.every((e) => e.runId === result.runId && e.at === "2026-10-24T12:00:00.000Z"),
    ).toBe(true);
  });

  it("walk through the stages in order, each start before its end", async () => {
    const { events } = await runWith();
    const stages = events
      .filter((e): e is Extract<RunEvent, { type: "stage" }> => e.type === "stage")
      .map((e) => `${e.stage}:${e.status}`);
    expect(stages).toEqual([
      "parse:start",
      "parse:end",
      "generate:start",
      "generate:end",
      "verify:start",
      "verify:end",
      "repair:start",
      "repair:end",
      "assemble:start",
      "assemble:end",
    ]);
  });

  it("report every draft, every first verdict, every repair, every removal, then done", async () => {
    const { events } = await runWith();
    const count = (type: RunEvent["type"]) => events.filter((e) => e.type === type).length;
    expect(count("draft")).toBe(24);
    expect(events.filter((e) => e.type === "verdict" && e.attempt === 1)).toHaveLength(24);
    expect(events.filter((e) => e.type === "verdict" && e.attempt === 2)).toHaveLength(1);
    expect(count("removed")).toBe(5);
    expect(count("progress")).toBeGreaterThan(0);
    expect(events.at(-1)?.type).toBe("done");

    const outcomes = Object.fromEntries(
      events
        .filter((e): e is Extract<RunEvent, { type: "repaired" }> => e.type === "repaired")
        .map((e) => [e.itemId, e.outcome]),
    );
    expect(outcomes).toEqual({ "sum-7": "failed", "glo-8": "unchanged", "q-6": "failed" });
  });

  it("a throwing listener cannot stop the run", async () => {
    const { result } = await runWith({
      onEvent: () => {
        throw new Error("listener bug");
      },
    });
    expect(result.status).toBe("complete");
  });

  it("the done event carries the same result that is returned", async () => {
    const { events, result } = await runWith();
    const done = events.at(-1);
    expect(done?.type === "done" && done.result).toEqual(result);
  });
});

describe("persistence", () => {
  it("stores the whole audit trail", async () => {
    const { result, store, events } = await runWith();
    const stored = await store.getRun(result.runId);
    expect(stored?.status).toBe("complete");
    expect(stored?.doc?.sentences).toHaveLength(15);
    expect(stored?.events).toHaveLength(events.length);
    expect(stored?.drafts.filter((d) => d.attempt === 1)).toHaveLength(24);
    expect(stored?.drafts.filter((d) => d.attempt === 2)).toHaveLength(1);
    expect(stored?.verifications.filter((v) => v.attempt === 1)).toHaveLength(24);
    expect(stored?.verifications.filter((v) => v.attempt === 2)).toHaveLength(1);
    expect(stored?.result).toEqual(result);
  });

  it("stores the done event without the (separately stored) result", async () => {
    const { result, store } = await runWith();
    const stored = await store.getRun(result.runId);
    const done = stored?.events.at(-1);
    expect(done?.type).toBe("done");
    expect(done).not.toHaveProperty("result");
  });

  it("keeps the repaired draft separate from the original (attempt 1 vs 2)", async () => {
    const { result, store } = await runWith();
    const stored = await store.getRun(result.runId);
    const original = stored?.drafts.find((d) => d.attempt === 1 && d.item.itemId === "glo-8");
    const repaired = stored?.drafts.find((d) => d.attempt === 2 && d.item.itemId === "glo-8");
    expect(original?.item.text).toContain("Forcibly");
    expect(repaired?.item.text).toContain("stopped after its time slice");
  });

  it("a failing store never stops the run; it is reported once", async () => {
    class BrokenStore extends MemoryRunStore {
      override async appendEvent(): Promise<void> {
        throw new Error("disk full");
      }
      override async saveDrafts(): Promise<void> {
        throw new Error("disk full");
      }
    }
    const { result, events } = await runWith({ store: new BrokenStore() });
    expect(result.status).toBe("complete");
    const warnings = result.warnings.filter((w) => w.code === "audit_log_unavailable");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("disk full");
    expect(
      events.filter((e) => e.type === "warning" && e.code === "audit_log_unavailable"),
    ).toHaveLength(1);
  });
});

describe("degraded verification (invariant 1)", () => {
  it("no entailment model: nothing is SUPPORTED, a warning is raised, the result says degraded", async () => {
    const { result } = await runWith({ nli: new FakeNli(new Error("model not loaded")) });
    expect(result.degraded).toBe(true);
    const supported = [...result.summary, ...result.glossary, ...result.questions].filter(
      (s) => s.envelope.verdict === "SUPPORTED",
    );
    expect(supported).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain("verifier_degraded");
    expect(
      invariantViolations({
        result,
        events: [],
        store: new MemoryRunStore(),
        deps: baseDeps(),
      }).filter((v) => !v.includes("seq") && !v.includes("done") && !v.includes("draft events")),
    ).toEqual([]);
  });

  it("an unavailable judge: nothing is SUPPORTED either", async () => {
    const broken = new FakeLlmClient({
      [TOOL_NAMES.summary]: (req) =>
        req.user.includes("<item_to_repair>")
          ? reply([], "INSUFFICIENT_SOURCE")
          : reply([
              point(
                ["S3.4"],
                "gives the minimum average waiting time",
                "SJF gives the minimum average waiting time.",
              ),
            ]),
      [TOOL_NAMES.glossary]: reply([]),
      [TOOL_NAMES.questions]: reply([]),
      submit_verdict: fail("provider", "judge is down"),
    });
    const { result } = await runWith({ llm: broken });
    expect(result.degraded).toBe(true);
    expect(result.summary.every((s) => s.envelope.verdict !== "SUPPORTED")).toBe(true);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.warnings.map((w) => w.code)).toContain("verifier_degraded");
  });
});

describe("when the models are unreachable", () => {
  const down = () =>
    new FakeLlmClient({
      [TOOL_NAMES.summary]: fail("provider", "401 User not found"),
      [TOOL_NAMES.glossary]: fail("provider", "401 User not found"),
      [TOOL_NAMES.questions]: fail("provider", "401 User not found"),
    });

  it("is a failed run with a clear error, never an empty success", async () => {
    const h = await runWith({ llm: down() });
    expect(h.result.status).toBe("failed");
    const error = h.events.find((e) => e.type === "error");
    expect(error).toMatchObject({ code: "generation_failed" });
    expect(error && "message" in error && error.message).toContain("401 User not found");
    expect(h.result.report).toMatchObject({ generated: 0, reconciles: true });
    expect(h.result.warnings.filter((w) => w.code === "generation_failed")).toHaveLength(7);
    expect((await h.store.getRun(h.result.runId))?.status).toBe("failed");
    expect(invariantViolations(h)).toEqual([]);
  });

  it("skips the rest of the pipeline: no verification, repair or coverage retry", async () => {
    const llm = down();
    const h = await runWith({ llm });
    expect(llm.requests).toHaveLength(7); // one per generator call, nothing after
    const stages = h.events
      .filter((e) => e.type === "stage")
      .map((e) => (e.type === "stage" ? e.stage : ""));
    expect(stages).not.toContain("verify");
    expect(stages).not.toContain("repair");
  });

  it("some failures are not fatal: the rest of the run carries on", async () => {
    const llm = lecture7Llm({ [TOOL_NAMES.questions]: fail("provider", "boom") });
    const { result } = await runWith({ llm });
    expect(result.status).toBe("complete");
    expect(result.questions).toEqual([]);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(["generation_failed", "few_questions"]),
    );
  });
});

describe("generation problems are shown, not hidden", () => {
  it("a section whose summary call failed is reported", async () => {
    const llm = new FakeLlmClient({
      [TOOL_NAMES.summary]: (req) =>
        sectionOf(req) === 2
          ? fail("provider", "rate limited")
          : reply([point([`S${sectionOf(req)}.1`], "the", "x")].slice(0, 0)),
      [TOOL_NAMES.glossary]: reply([]),
      [TOOL_NAMES.questions]: reply([]),
    });
    const { result } = await runWith({ llm });
    expect(
      result.warnings.some(
        (w) =>
          w.code === "generation_failed" &&
          w.message.includes("section:2") &&
          w.message.includes("rate limited"),
      ),
    ).toBe(true);
  });

  it("nothing generated at all still gives a reconciling, empty result", async () => {
    const llm = new FakeLlmClient({
      [TOOL_NAMES.summary]: reply([], "INSUFFICIENT_SOURCE: nothing"),
      [TOOL_NAMES.glossary]: reply([], "INSUFFICIENT_SOURCE: nothing"),
      [TOOL_NAMES.questions]: reply([], "INSUFFICIENT_SOURCE: nothing"),
    });
    const h = await runWith({ llm });
    expect(h.result.status).toBe("complete");
    expect(h.result.report).toMatchObject({
      generated: 0,
      supported: 0,
      removed: 0,
      reconciles: true,
    });
    expect(h.result.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(["insufficient_source", "coverage_gap", "few_questions"]),
    );
    expect(invariantViolations(h)).toEqual([]);
  });
});

describe("coverage: every section should have a summary point", () => {
  /** Section 2's first summary call returns nothing; the targeted retry finds a point. */
  function flakySection2(retryWorks: boolean, reason = "try again") {
    let section2Calls = 0;
    return new FakeLlmClient({
      [TOOL_NAMES.summary]: async (req) => {
        if (req.user.includes("<item_to_repair>")) return reply([], "INSUFFICIENT_SOURCE");
        if (sectionOf(req) === 2) {
          section2Calls++;
          if (section2Calls === 1 || !retryWorks)
            return reply([], `INSUFFICIENT_SOURCE: ${reason}`);
          return reply([
            point(
              ["S2.4"],
              "Waiting time is the total time a process spends in the ready queue",
              "Waiting time is the total time a process spends in the ready queue.",
            ),
          ]);
        }
        return reply([
          point(
            [`S${sectionOf(req)}.1`],
            {
              1: "decide which process in the ready queue gets the CPU next",
              3: "schedules processes in the order they arrive",
            }[sectionOf(req) as 1 | 3] ?? "x y",
            sectionOf(req) === 1
              ? "CPU scheduling decides which process in the ready queue gets the CPU next."
              : "FCFS schedules processes in the order they arrive.",
          ),
        ]);
      },
      [TOOL_NAMES.glossary]: reply([]),
      [TOOL_NAMES.questions]: reply([]),
      submit_verdict: PASS,
    });
  }

  it("retries an uncovered section once, continues the item numbering, and reaches 100%", async () => {
    const llm = flakySection2(true);
    const h = await runWith({ llm, nli: new FakeNli(ENTAILED) });
    expect(h.result.report.coveragePercent).toBe(100);
    const ids = [...h.result.summary, ...h.result.removed].map((x) => x.envelope.itemId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      h.result.warnings.some(
        (w) => w.code === "insufficient_source" && w.message.includes("section:2"),
      ),
    ).toBe(true);
    expect(h.result.warnings.map((w) => w.code)).not.toContain("coverage_gap");
    expect(llm.callsTo(TOOL_NAMES.summary).filter((r) => sectionOf(r) === 2)).toHaveLength(2);
    expect(invariantViolations(h)).toEqual([]);
  });

  it("does not show a junk reason from the model in the warning", async () => {
    const h = await runWith({ llm: flakySection2(true, "**"), nli: new FakeNli(ENTAILED) });
    const w = h.result.warnings.find((x) => x.code === "insufficient_source");
    expect(w?.message).toContain("no usable reason");
    expect(w?.message).not.toContain("**");
  });

  it("warns, once it has tried, if a section still has no supported summary point", async () => {
    const h = await runWith({ llm: flakySection2(false), nli: new FakeNli(ENTAILED) });
    expect(h.result.report.coveragePercent).toBeCloseTo(66.7, 1);
    const gap = h.result.warnings.find((w) => w.code === "coverage_gap");
    expect(gap?.message).toContain("section(s) 2");
    expect(invariantViolations(h)).toEqual([]);
  });
});

describe("near-duplicates", () => {
  const llmWith = (summaryPoints: unknown[]) =>
    new FakeLlmClient({
      [TOOL_NAMES.summary]: (req) => (sectionOf(req) === 1 ? reply(summaryPoints) : reply([])),
      [TOOL_NAMES.glossary]: reply([]),
      [TOOL_NAMES.questions]: reply([]),
      submit_verdict: PASS,
    });
  const a = point(
    ["S1.3"],
    "hands the CPU to the chosen process",
    "The dispatcher hands the CPU to the chosen process.",
  );

  it("removes an item that says the same thing in different words order (cosine)", async () => {
    const reordered = point(
      ["S1.3"],
      "hands the CPU to the chosen process",
      "The chosen process gets the CPU the dispatcher hands to.",
    );
    const { result } = await runWith({ llm: llmWith([a, reordered]), nli: new FakeNli(ENTAILED) });
    const dup = result.removed.find((r) => r.kind === "duplicate");
    expect(dup).toMatchObject({ duplicateOf: "sum-1" });
    expect(result.summary.filter((s) => s.envelope.sourceIds.includes("S1.3"))).toHaveLength(1);
  });

  it("falls back to exact matching, and says so, when the embedder fails", async () => {
    const embedder = {
      embed: async () => {
        throw new Error("embedder offline");
      },
    };
    const same = point(
      ["S1.3"],
      "hands the CPU to the chosen process",
      "the  DISPATCHER hands the CPU to the chosen process.",
    );
    // A third, different item makes the embedding step run (and fail) after the exact match.
    const different = point(
      ["S1.3"],
      "is called the dispatcher",
      "The component that hands the CPU to the chosen process is called the dispatcher.",
    );
    const { result } = await runWith({
      llm: llmWith([a, same, different]),
      nli: new FakeNli(ENTAILED),
      embedder,
    });
    expect(result.warnings.map((w) => w.code)).toContain("duplicate_detection_limited");
    expect(result.removed.some((r) => r.kind === "duplicate")).toBe(true);
  });
});

describe("parse failures", () => {
  it("an empty document fails cleanly, with an error event and a stored result", async () => {
    const { result, events, store } = await runWith({}, "   \n  ");
    expect(result.status).toBe("failed");
    expect(result.report).toMatchObject({ generated: 0, reconciles: true });
    const error = events.find((e) => e.type === "error");
    expect(error).toMatchObject({ code: "parse_failed" });
    expect(events.at(-1)?.type).toBe("done");
    expect((await store.getRun(result.runId))?.status).toBe("failed");
  });

  it("a document with nothing readable fails with the reason", async () => {
    const { events } = await runWith({}, "| a | b |\n| c | d |");
    expect(events.find((e) => e.type === "error")).toMatchObject({
      code: "parse_failed",
      message: expect.stringContaining("not processed"),
    });
  });
});

describe("cancellation", () => {
  it("cancelling when verification starts: incomplete, error event, nothing falsely verified", async () => {
    const controller = new AbortController();
    const h = await runWith({
      signal: controller.signal,
      onEvent: (e) => {
        if (e.type === "stage" && e.stage === "verify" && e.status === "start") controller.abort();
      },
    });
    expect(h.result.status).toBe("incomplete");
    expect(h.events.find((e) => e.type === "error")).toMatchObject({ code: "aborted" });
    expect(h.result.report.generated).toBe(24);
    expect(h.result.report.unreviewed).toBe(24);
    expect(h.result.summary).toEqual([]);
    expect(h.result.report.reconciles).toBe(true);
    expect(invariantViolations(h)).toEqual([]);
    expect((await h.store.getRun(h.result.runId))?.status).toBe("incomplete");
  });

  it("cancelling before anything starts: incomplete with nothing generated", async () => {
    const controller = new AbortController();
    controller.abort();
    const h = await runWith({ signal: controller.signal });
    expect(h.result.status).toBe("incomplete");
    expect(h.result.report).toMatchObject({ generated: 0, reconciles: true });
  });

  it("cancelling mid-verification keeps what finished and marks the rest unreviewed", async () => {
    const controller = new AbortController();
    let verdicts = 0;
    const h = await runWith({
      signal: controller.signal,
      concurrency: 1,
      onEvent: (e) => {
        if (e.type === "verdict" && e.attempt === 1 && ++verdicts === 5) controller.abort();
      },
    });
    expect(h.result.status).toBe("incomplete");
    const r = h.result.report;
    expect(r.unreviewed).toBeGreaterThan(0);
    expect(r.supported + r.partial + r.removed).toBeLessThan(24);
    expect(r.reconciles).toBe(true);
    expect(invariantViolations(h)).toEqual([]);
  });
});

describe("run report", () => {
  it("counts every model call's cost, failures included", async () => {
    const h = await runWith();
    const llm = h.deps.llm as FakeLlmClient;
    expect(h.result.report.usage.costUsd).toBeCloseTo(llm.requests.length * 0.001, 6);
    expect(h.result.report.usage.inputTokens).toBe(llm.requests.length * 100);
  });

  it("splits the counts by kind of item", async () => {
    const { result } = await runWith();
    expect(result.report.byType.summary_point).toMatchObject({
      generated: 8,
      supported: 6,
      removed: 2,
    });
    expect(result.report.byType.glossary).toMatchObject({ generated: 8, supported: 7, partial: 1 });
    expect(result.report.byType.question).toMatchObject({ generated: 8, supported: 5, removed: 3 });
  });

  it("counts repairs: three attempted, none improved the verdict", async () => {
    const { result } = await runWith();
    expect(result.report.repairsAttempted).toBe(3);
    expect(result.report.repairsSucceeded).toBe(0);
  });
});

describe("a long document", () => {
  it("gets per-section work and a roll-up, and still reconciles", async () => {
    const text = Array.from({ length: 4 }, (_, s) => {
      const body = Array.from(
        { length: 12 },
        (_, i) => `Fact ${s + 1}.${i + 1} concerns widget ${i + 1} in topic ${s + 1}.`,
      ).join(" ");
      return `## Topic ${s + 1}\n\n${body}`;
    }).join("\n\n");
    const llm = new FakeLlmClient({
      [TOOL_NAMES.summary]: (req) => {
        const n = sectionOf(req);
        if (req.toolName === TOOL_NAMES.summary && req.user.includes("<item_to_repair>"))
          return reply([], "INSUFFICIENT_SOURCE");
        return reply([
          point(
            [`S${n}.1`],
            `concerns widget 1 in topic ${n}`,
            `Fact ${n}.1 concerns widget 1 in topic ${n}.`,
          ),
        ]);
      },
      [TOOL_NAMES.rollup]: reply([
        point(
          ["S1.1", "S2.1"],
          "concerns widget 1 in topic 1",
          "Fact 1.1 concerns widget 1 in topic 1.",
        ),
      ]),
      [TOOL_NAMES.glossary]: reply([], "INSUFFICIENT_SOURCE"),
      [TOOL_NAMES.questions]: reply([], "INSUFFICIENT_SOURCE"),
      submit_verdict: PASS,
    });
    const h = await runWith({ llm, nli: new FakeNli(ENTAILED) }, text);
    expect(h.result.report.sourceSentences).toBe(48);
    expect(llm.callsTo(TOOL_NAMES.rollup)).toHaveLength(1);
    expect(invariantViolations(h)).toEqual([]);
  });
});

describe("the same document run twice", () => {
  it("is deterministic with the scripted fakes", async () => {
    const a = await runWith();
    const b = await runWith();
    expect(b.result).toEqual({ ...a.result, runId: b.result.runId });
    expect(LECTURE7.length).toBeGreaterThan(0);
  });
});
