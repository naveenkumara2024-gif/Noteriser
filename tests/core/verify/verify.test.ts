import { describe, expect, it } from "vitest";
import type { DraftItem, GlossaryDraft, QuestionDraft, SummaryDraft } from "@/core/generate";
import type { Embedder } from "@/core/ports/embed";
import type { SourceDoc } from "@/core/schema";
import { createVerifier, toEnvelope } from "@/core/verify";
import { FakeLlmClient, type FakeStep, fail } from "@/llm/fake";
import { CONTRADICTED, ENTAILED, FakeEmbedder, FakeNli, NEUTRAL } from "@/nlp/fake";
import { fixtureDoc } from "../../support/docs";

const PASS = { unsupported_parts: [], verdict: "pass" };
const VERDICT = "submit_verdict";
const DISTRACTORS = "submit_distractor_review";

const summary = (over: Partial<SummaryDraft> = {}): SummaryDraft => ({
  itemId: "sum-1",
  type: "summary_point",
  scope: "section:3",
  sourceIds: ["S3.4"],
  evidenceQuote: "gives the minimum average waiting time",
  text: "SJF gives the minimum average waiting time but the next burst length must be predicted.",
  idsExist: true,
  problems: [],
  ...over,
});

const question = (over: Partial<QuestionDraft> = {}): QuestionDraft => ({
  itemId: "q-1",
  type: "question",
  scope: "document",
  sourceIds: ["S3.6"],
  evidenceQuote: "if it is very small, context-switch overhead increases",
  text: "In Round Robin, what happens if the time quantum is very small?",
  idsExist: true,
  problems: [],
  qtype: "short",
  question: "In Round Robin, what happens if the time quantum is very small?",
  answer: "Context-switch overhead increases.",
  answerStatement: "If the time quantum is very small, context-switch overhead increases.",
  answerSourceIds: ["S3.6"],
  ...over,
});

async function setup(
  opts: {
    nli?: FakeNli;
    script?: Record<string, FakeStep | FakeStep[]>;
    embedder?: Embedder;
    exhaustive?: boolean;
    signal?: AbortSignal;
  } = {},
) {
  const doc: SourceDoc = await fixtureDoc();
  const llm = new FakeLlmClient(opts.script ?? { [VERDICT]: PASS });
  const nli = opts.nli ?? new FakeNli(ENTAILED);
  const verifier = createVerifier(doc, {
    nli,
    llm,
    embedder: opts.embedder,
    exhaustive: opts.exhaustive,
    signal: opts.signal,
  });
  return { doc, llm, nli, verifier };
}

describe("a correct item", () => {
  it("is SUPPORTED when every check ran and passed", async () => {
    const { verifier, llm, nli } = await setup();
    const v = await verifier.verify(summary());
    expect(v.verdict).toBe("SUPPORTED");
    expect(v.reasons).toEqual([]);
    expect(v.degraded).toBe(false);
    expect(v.scores).toMatchObject({ quoteFound: true, judge: "pass", overGeneral: [] });
    expect(v.scores.entailment).toBeCloseTo(0.97);
    expect(nli.calls).toHaveLength(1);
    expect(llm.callsTo(VERDICT)).toHaveLength(1);
  });

  it("reports the judge's tokens and cost", async () => {
    const { verifier } = await setup();
    const v = await verifier.verify(summary());
    expect(v.usage).toEqual({ inputTokens: 100, outputTokens: 50, costUsd: 0.001 });
  });

  it("builds the shared envelope: no flag reason when supported", async () => {
    const { verifier } = await setup();
    const item = summary();
    const env = toEnvelope(item, await verifier.verify(item));
    expect(env).toMatchObject({
      itemId: "sum-1",
      type: "summary_point",
      sourceIds: ["S3.4"],
      verdict: "SUPPORTED",
      flagReason: null,
    });
    expect(env).not.toHaveProperty("question");
  });
});

describe("the judge is independent of the generator (invariant 2)", () => {
  it("receives only the cited source and the claim, in the judge role, at temperature 0", async () => {
    const { verifier, llm } = await setup();
    const item = summary();
    await verifier.verify(item);

    const [req] = llm.callsTo(VERDICT);
    expect(req?.role).toBe("judge");
    expect(req?.temperature).toBe(0);
    expect(req?.user).toContain("[S3.4] SJF gives the minimum average waiting time");
    expect(req?.user).toContain(`<claim>\n${item.text}\n</claim>`);
    expect(req?.user).not.toContain("[S1.3]"); // uncited sentences are not shown
    expect(req?.user).not.toContain("[S3.2]");

    const seen = `${req?.system}\n${req?.user}`.toLowerCase();
    for (const leaked of [
      "generator",
      "evidence_quote",
      "evidence quote",
      "summary point",
      "sum-1",
    ]) {
      expect(seen, leaked).not.toContain(leaked);
    }
  });

  it("passes the abort signal to the judge", async () => {
    const controller = new AbortController();
    const { verifier, llm } = await setup({ signal: controller.signal });
    await verifier.verify(summary());
    expect(llm.requests[0]?.signal).toBe(controller.signal);
  });
});

describe("lore §6.5: drafts the verifier must not let through", () => {
  it("'Round Robin is the most widely used scheduler…' -> UNSUPPORTED (no source, over-general)", async () => {
    const { verifier, llm } = await setup({ nli: new FakeNli(NEUTRAL) });
    const v = await verifier.verify(
      summary({
        sourceIds: ["S3.5"],
        evidenceQuote: "gives each process a fixed time slice",
        text: "Round Robin is the most widely used scheduler in modern operating systems.",
      }),
    );
    expect(v.verdict).toBe("UNSUPPORTED");
    expect(v.reasons[0]).toContain("does not support");
    expect(v.scores.overGeneral).toEqual(expect.arrayContaining(["most", "widely"]));
    expect(llm.requests).toHaveLength(0); // settled by the local check; no judge call spent
  });

  it("'SJF is impossible to implement in practice.' -> CONTRADICTED", async () => {
    const { verifier, llm } = await setup({ nli: new FakeNli(CONTRADICTED) });
    const v = await verifier.verify(
      summary({ text: "SJF is impossible to implement in practice." }),
    );
    expect(v.verdict).toBe("CONTRADICTED");
    expect(v.reasons[0]).toContain("the opposite");
    expect(v.scores.overGeneral).toEqual(expect.arrayContaining(["impossible", "in practice"]));
    expect(llm.requests).toHaveLength(0);
  });

  it("a question about 'a typical time quantum in milliseconds' -> UNSUPPORTED (invented numbers)", async () => {
    const { verifier } = await setup({ nli: new FakeNli(NEUTRAL) });
    const v = await verifier.verify(
      question({
        question: "What is a typical time quantum in milliseconds?",
        text: "What is a typical time quantum in milliseconds?",
        answer: "10 to 100 ms",
        answerStatement: "A typical time quantum is 10 to 100 milliseconds.",
      }),
    );
    expect(v.verdict).toBe("UNSUPPORTED");
    expect(v.entities.hard).toEqual(["10", "100"]);
    expect(v.reasons[0]).toContain('"10", "100"');
  });

  it("'Preemption: forcibly taking the CPU away…' (beyond the source) is flagged, not SUPPORTED", async () => {
    const glossary: GlossaryDraft = {
      itemId: "glo-1",
      type: "glossary",
      scope: "section:3",
      sourceIds: ["S3.5"],
      evidenceQuote: "the process is preempted and placed at the end of the ready queue",
      term: "Preemption",
      text: "Forcibly taking the CPU away from a running process.",
      idsExist: true,
      problems: [],
    };
    const { verifier, nli } = await setup({
      nli: new FakeNli({ entailment: 0.7, neutral: 0.25, contradiction: 0.05 }),
      script: {
        [VERDICT]: { unsupported_parts: ["forcibly taking the CPU away"], verdict: "fail" },
      },
    });
    const v = await verifier.verify(glossary);
    expect(v.verdict).toBe("PARTIAL");
    expect(v.judgeParts).toEqual(["forcibly taking the CPU away"]);
    expect(v.reasons.join(" ")).toContain("forcibly taking the CPU away");
    // The glossary claim is a proposition, "<term> is <definition>", not the bare noun phrase.
    expect(nli.calls[0]?.hypothesis).toBe(
      "Preemption is forcibly taking the CPU away from a running process.",
    );
  });
});

describe("check 1 (quote) failures", () => {
  it("a spliced quote is UNSUPPORTED; entailment still runs, the judge does not", async () => {
    const { verifier, nli, llm } = await setup();
    const v = await verifier.verify(
      summary({
        sourceIds: ["S3.1", "S3.2"],
        evidenceQuote: "schedules processes in the order they arrive; non-preemptive and can cause",
      }),
    );
    expect(v.verdict).toBe("UNSUPPORTED");
    expect(v.scores.quoteFound).toBe(false);
    expect(v.reasons[0]).toContain("word for word");
    expect(nli.calls.length).toBeGreaterThan(0); // the local check still ran (together + each alone)
    expect(llm.requests).toHaveLength(0);
  });

  it("an unknown citation is UNSUPPORTED without any model work, and is not 'degraded'", async () => {
    const { verifier, nli, llm } = await setup();
    const v = await verifier.verify(summary({ sourceIds: ["S9.9"] }));
    expect(v).toMatchObject({ verdict: "UNSUPPORTED", degraded: false });
    expect(v.reasons[0]).toBe("Cites S9.9, which is not in the notes.");
    expect(v.scores).toMatchObject({ quoteFound: false, entailment: null, judge: "not_run" });
    expect(nli.calls).toHaveLength(0);
    expect(llm.requests).toHaveLength(0);
  });

  it("a question whose ANSWER cites an unknown id fails even if its evidence is fine", async () => {
    const { verifier } = await setup();
    const v = await verifier.verify(question({ answerSourceIds: ["S7.7"] }));
    expect(v.verdict).toBe("UNSUPPORTED");
    expect(v.reasons[0]).toBe("The answer cites S7.7, which is not in the notes.");
  });

  it("points at the closest sentence when the wrong one was cited (embedding hint only)", async () => {
    const { verifier } = await setup({ nli: new FakeNli(NEUTRAL), embedder: new FakeEmbedder() });
    const v = await verifier.verify(
      summary({
        sourceIds: ["S3.2"],
        evidenceQuote: "minimum average waiting time for a given set of processes",
        text: "SJF gives the minimum average waiting time for a given set of processes.",
      }),
    );
    expect(v.verdict).toBe("UNSUPPORTED");
    expect(v.reasons).toContain("The quote is in S3.4, not in the cited sentence(s) S3.2.");
    expect(v.reasons).toContain("The closest sentence in the notes is S3.4, not the cited S3.2.");
    expect(v.closest[0]?.id).toBe("S3.4");
  });

  it("the embedding never upgrades a verdict", async () => {
    const { verifier } = await setup({ nli: new FakeNli(NEUTRAL), embedder: new FakeEmbedder() });
    const v = await verifier.verify(summary({ evidenceQuote: "not in the notes at all here" }));
    expect(v.verdict).toBe("UNSUPPORTED");
  });
});

describe("degraded verification (invariant 1)", () => {
  it("entailment model failure -> PARTIAL, degraded, judge still consulted", async () => {
    const { verifier, llm } = await setup({ nli: new FakeNli(new Error("model not loaded")) });
    const v = await verifier.verify(summary());
    expect(v).toMatchObject({ verdict: "PARTIAL", degraded: true });
    expect(v.scores.entailment).toBeNull();
    expect(v.scores.judge).toBe("pass");
    expect(v.reasons[0]).toContain("model not loaded");
    expect(llm.callsTo(VERDICT)).toHaveLength(1);
  });

  it("judge failure -> PARTIAL, degraded, and the failed call's cost is counted", async () => {
    const { verifier } = await setup({ script: { [VERDICT]: fail("provider", "503 overloaded") } });
    const v = await verifier.verify(summary());
    expect(v).toMatchObject({ verdict: "PARTIAL", degraded: true });
    expect(v.scores.judge).toBe("not_run");
    expect(v.reasons[0]).toContain("503 overloaded");
    expect(v.usage.costUsd).toBeCloseTo(0.001);
  });

  it("both failing never produces SUPPORTED", async () => {
    const { verifier } = await setup({
      nli: new FakeNli(new Error("down")),
      script: { [VERDICT]: fail("aborted") },
    });
    const v = await verifier.verify(summary());
    expect(v.verdict).toBe("PARTIAL");
    expect(v.degraded).toBe(true);
  });

  it("an unexpected exception becomes a degraded UNSUPPORTED, never a crash or a SUPPORTED", async () => {
    class Broken extends FakeNli {
      override countTokens(): number {
        throw new Error("tokenizer bug");
      }
    }
    const { verifier } = await setup({ nli: new Broken() });
    const v = await verifier.verify(summary());
    expect(v).toMatchObject({ verdict: "UNSUPPORTED", degraded: true });
    expect(v.reasons[0]).toBe("Verifier error: tokenizer bug");
  });

  it("a long premise that cannot fit the model is reported as degraded, not truncated", async () => {
    const { verifier, nli } = await setup({ nli: new FakeNli(ENTAILED, 12) });
    const v = await verifier.verify(summary());
    expect(v).toMatchObject({ verdict: "PARTIAL", degraded: true });
    expect(v.reasons[0]).toContain("too long");
    expect(nli.calls).toHaveLength(0);
  });
});

describe("cost control", () => {
  it("does not spend a judge call on items the local checks already settled", async () => {
    const { verifier, llm } = await setup({ nli: new FakeNli(NEUTRAL) });
    await verifier.verify(summary());
    expect(llm.requests).toHaveLength(0);
  });

  it("exhaustive mode runs the judge anyway (for evaluation)", async () => {
    const { verifier, llm } = await setup({ nli: new FakeNli(NEUTRAL), exhaustive: true });
    const v = await verifier.verify(summary());
    expect(v.verdict).toBe("UNSUPPORTED");
    expect(v.scores.judge).toBe("pass");
    expect(llm.requests).toHaveLength(1);
  });

  it("moderate entailment still reaches the judge", async () => {
    const { verifier, llm } = await setup({
      nli: new FakeNli({ entailment: 0.7, neutral: 0.2, contradiction: 0.1 }),
    });
    const v = await verifier.verify(summary());
    expect(v.verdict).toBe("PARTIAL");
    expect(llm.requests).toHaveLength(1);
  });
});

describe("questions", () => {
  const options = [
    "RR behaves like FCFS",
    "Context-switch overhead increases",
    "Throughput becomes zero",
    "Processes are never preempted",
  ];
  const mcq = (over: Partial<QuestionDraft> = {}) =>
    question({ qtype: "mcq", options, answer: "Context-switch overhead increases", ...over });
  const review = (couldBeCorrect: Record<string, boolean>) => ({
    options: Object.entries(couldBeCorrect).map(([option, could_be_correct]) => ({
      option,
      reason: "r",
      could_be_correct,
    })),
  });
  const allWrong = review({
    "RR behaves like FCFS": false,
    "Throughput becomes zero": false,
    "Processes are never preempted": false,
  });

  it("verifies the answer statement, not the question", async () => {
    const { verifier, nli } = await setup();
    await verifier.verify(question());
    expect(nli.calls[0]?.hypothesis).toBe(
      "If the time quantum is very small, context-switch overhead increases.",
    );
  });

  it("uses the answer's own sentences as the premise", async () => {
    const { verifier, nli } = await setup();
    await verifier.verify(question({ sourceIds: ["S3.5", "S3.6"], answerSourceIds: ["S3.6"] }));
    // Only S3.6 (the answer's sentence), with its real section heading as context.
    expect(nli.calls.map((c) => c.premise)).toEqual([
      "Scheduling algorithms: If the time quantum is very large, RR behaves like FCFS; if it is very small, context-switch overhead increases.",
    ]);
  });

  it("an MCQ with clearly wrong distractors is SUPPORTED after two judge calls", async () => {
    const { verifier, llm } = await setup({ script: { [VERDICT]: PASS, [DISTRACTORS]: allWrong } });
    const v = await verifier.verify(mcq());
    expect(v.verdict).toBe("SUPPORTED");
    expect(v.distractors.map((d) => d.option)).toEqual([
      "RR behaves like FCFS",
      "Throughput becomes zero",
      "Processes are never preempted",
    ]);
    expect(v.distractors.every((d) => d.couldBeCorrect === false)).toBe(true);
    expect(llm.requests.map((r) => r.toolName)).toEqual([VERDICT, DISTRACTORS]);
    expect(v.usage.costUsd).toBeCloseTo(0.002);
  });

  it("the distractor review shows the question and only the wrong options", async () => {
    const { verifier, llm } = await setup({ script: { [VERDICT]: PASS, [DISTRACTORS]: allWrong } });
    await verifier.verify(mcq());
    const [req] = llm.callsTo(DISTRACTORS);
    expect(req?.role).toBe("judge");
    expect(req?.user).toContain("<question>");
    expect(req?.user).toContain("1. RR behaves like FCFS");
    expect(req?.user).not.toContain("1. Context-switch overhead increases");
  });

  it("a 'wrong' option the notes could support makes the question UNSUPPORTED (two defensible answers)", async () => {
    const { verifier } = await setup({
      script: {
        [VERDICT]: PASS,
        [DISTRACTORS]: review({
          "RR behaves like FCFS": true,
          "Throughput becomes zero": false,
          "Processes are never preempted": false,
        }),
      },
    });
    const v = await verifier.verify(mcq());
    expect(v.verdict).toBe("UNSUPPORTED");
    expect(v.reasons[0]).toContain('"RR behaves like FCFS"');
  });

  it("a distractor that invents a fact makes the question PARTIAL", async () => {
    const odd = [...options.slice(0, 2), "It takes exactly 50 ms", options[3] as string];
    const { verifier } = await setup({
      script: {
        [VERDICT]: PASS,
        [DISTRACTORS]: review({
          "RR behaves like FCFS": false,
          "It takes exactly 50 ms": false,
          "Processes are never preempted": false,
        }),
      },
    });
    const v = await verifier.verify(mcq({ options: odd }));
    expect(v.verdict).toBe("PARTIAL");
    expect(v.reasons[0]).toContain("introduce facts not in the notes");
  });

  it("a failed distractor review is a degraded check, never SUPPORTED", async () => {
    const { verifier } = await setup({
      script: { [VERDICT]: PASS, [DISTRACTORS]: fail("provider", "boom") },
    });
    const v = await verifier.verify(mcq());
    expect(v).toMatchObject({ verdict: "PARTIAL", degraded: true });
    expect(v.reasons[0]).toContain("distractor review");
  });

  it("makes no distractor call for short-answer or true/false questions", async () => {
    const { verifier, llm } = await setup();
    await verifier.verify(question({ qtype: "short" }));
    await verifier.verify(question({ qtype: "true_false", answer: "True" }));
    expect(llm.callsTo(DISTRACTORS)).toHaveLength(0);
  });

  it("builds an envelope with the question fields", async () => {
    const { verifier } = await setup({ script: { [VERDICT]: PASS, [DISTRACTORS]: allWrong } });
    const item = mcq();
    const env = toEnvelope(item, await verifier.verify(item));
    expect(env).toMatchObject({
      type: "question",
      qtype: "mcq",
      options,
      answer: "Context-switch overhead increases",
      answerStatement: item.answerStatement,
      answerSourceIds: ["S3.6"],
    });
  });
});

describe("envelope", () => {
  it("keeps a glossary entry's term, so the entry can be shown with its name", async () => {
    const glossary: GlossaryDraft = {
      itemId: "glo-1",
      type: "glossary",
      scope: "section:1",
      sourceIds: ["S1.3"],
      evidenceQuote: "hands the CPU to the chosen process",
      term: "Dispatcher",
      text: "The component that hands the CPU to the chosen process.",
      idsExist: true,
      problems: [],
    };
    const { verifier } = await setup();
    const env = toEnvelope(glossary, await verifier.verify(glossary));
    expect(env).toMatchObject({ type: "glossary", term: "Dispatcher" });
    expect(toEnvelope(summary(), await verifier.verify(summary()))).not.toHaveProperty("term");
  });

  it("gives no 'closest sentence' hint for a contradicted claim (the evidence is fine)", async () => {
    const { verifier } = await setup({
      nli: new FakeNli(CONTRADICTED),
      embedder: new FakeEmbedder(),
    });
    const v = await verifier.verify(
      summary({ text: "SJF is impossible to implement in practice." }),
    );
    expect(v.verdict).toBe("CONTRADICTED");
    expect(v.reasons.join(" ")).not.toContain("closest sentence");
    expect(v.closest).toEqual([]);
  });
});

describe("envelope flag reasons", () => {
  it("joins the reasons for a flagged item", async () => {
    const { verifier } = await setup({ nli: new FakeNli(NEUTRAL) });
    const item = summary({ text: "SJF always gives the best waiting time." });
    const env = toEnvelope(item, await verifier.verify(item));
    expect(env.verdict).toBe("UNSUPPORTED");
    expect(env.flagReason).toContain("does not support");
    expect(env.flagReason).toContain('"always"');
  });
});

describe("verifyAll", () => {
  it("keeps input order and never exceeds four items in flight", async () => {
    let inFlight = 0;
    let max = 0;
    class Slow extends FakeNli {
      override async score() {
        inFlight++;
        max = Math.max(max, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return ENTAILED;
      }
    }
    const { verifier } = await setup({ nli: new Slow() });
    const items: DraftItem[] = Array.from({ length: 12 }, (_, i) =>
      summary({ itemId: `sum-${i + 1}` }),
    );
    const results = await verifier.verifyAll(items);
    expect(results.map((r) => r.itemId)).toEqual(items.map((i) => i.itemId));
    expect(max).toBeLessThanOrEqual(4);
    expect(max).toBeGreaterThan(1);
  });

  it("honours a custom concurrency", async () => {
    let inFlight = 0;
    let max = 0;
    class Slow extends FakeNli {
      override async score() {
        inFlight++;
        max = Math.max(max, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return ENTAILED;
      }
    }
    const { verifier } = await setup({ nli: new Slow() });
    await verifier.verifyAll(
      Array.from({ length: 6 }, (_, i) => summary({ itemId: `s${i}` })),
      1,
    );
    expect(max).toBe(1);
  });
});

describe("custom thresholds", () => {
  it("are passed through to the decision", async () => {
    const doc = await fixtureDoc();
    const verifier = createVerifier(doc, {
      nli: new FakeNli(ENTAILED),
      llm: new FakeLlmClient({ [VERDICT]: PASS }),
      thresholds: {
        entailmentSupported: 0.99,
        entailmentPartial: 0.5,
        contradiction: 0.5,
        softNovelPartial: 3,
      },
    });
    expect((await verifier.verify(summary())).verdict).toBe("PARTIAL");
  });
});
