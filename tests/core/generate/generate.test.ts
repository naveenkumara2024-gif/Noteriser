import { describe, expect, it } from "vitest";
import type { GenerationProgress } from "@/core/generate";
import {
  generateDrafts,
  generateGlossary,
  generateQuestions,
  generateSummary,
  TOOL_NAMES,
} from "@/core/generate";
import { cleanQuote, parseIds } from "@/core/generate/draft";
import type { SourceDoc } from "@/core/schema";
import { FakeLlmClient, fail, type RecordedRequest } from "@/llm/fake";
import { fixtureDoc, longDoc } from "../../support/docs";

const reply = (items: unknown[], insufficient_reason = "") => ({ items, insufficient_reason });
const sum = (ids: string[], quote: string, text: string) => ({
  source_ids: ids,
  evidence_quote: quote,
  text,
});
const sectionOf = (req: RecordedRequest): number =>
  Number(/(?:Summarise|List the defined terms in) Section (\d+),/.exec(req.user)?.[1]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SUMMARY_BY_SECTION: Record<number, unknown> = {
  1: reply([
    sum(
      ["S1.1", "S1.2"],
      "decide which process",
      "CPU scheduling chooses the next process and keeps the CPU busy.",
    ),
    sum(
      ["S1.3", "S1.4"],
      "called the dispatcher",
      "The dispatcher hands over the CPU; switching takes dispatch latency.",
    ),
  ]),
  2: reply([
    sum(
      ["S2.1", "S2.2", "S2.3", "S2.4", "S2.5"],
      "Waiting time",
      "Schedulers are judged by five criteria.",
    ),
  ]),
  3: reply([
    sum(
      ["S3.1", "S3.2"],
      "convoy effect",
      "FCFS runs in arrival order and can cause the convoy effect.",
    ),
  ]),
};
const bySection = (table: Record<number, unknown>) => (req: RecordedRequest) =>
  table[sectionOf(req)] ?? reply([]);

async function setup() {
  return { doc: await fixtureDoc() };
}

describe("generateSummary", () => {
  it("makes one call per section and numbers items in section order", async () => {
    const { doc } = await setup();
    const llm = new FakeLlmClient({ [TOOL_NAMES.summary]: bySection(SUMMARY_BY_SECTION) });
    const out = await generateSummary(doc, { llm });

    expect(out.items.map((i) => [i.itemId, i.scope])).toEqual([
      ["sum-1", "section:1"],
      ["sum-2", "section:1"],
      ["sum-3", "section:2"],
      ["sum-4", "section:3"],
    ]);
    expect(out.items[0]).toMatchObject({
      type: "summary_point",
      sourceIds: ["S1.1", "S1.2"],
      evidenceQuote: "decide which process",
      idsExist: true,
      problems: [],
    });
    expect(out.failures).toEqual([]);
    expect(llm.callsTo(TOOL_NAMES.summary)).toHaveLength(3);
    expect(llm.callsTo(TOOL_NAMES.rollup)).toHaveLength(0);
  });

  it("uses the generator role at low temperature and keeps judge wording out of prompts", async () => {
    const { doc } = await setup();
    const llm = new FakeLlmClient({ [TOOL_NAMES.summary]: bySection(SUMMARY_BY_SECTION) });
    await generateSummary(doc, { llm });
    for (const r of llm.requests) {
      expect(r.role).toBe("generator");
      expect(r.temperature).toBe(0.1);
      expect(`${r.system}\n${r.user}`).not.toMatch(/judge/i);
    }
  });

  it("sums usage across calls", async () => {
    const { doc } = await setup();
    const llm = new FakeLlmClient(
      { [TOOL_NAMES.summary]: bySection(SUMMARY_BY_SECTION) },
      { usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.5 } },
    );
    const out = await generateSummary(doc, { llm });
    expect(out.usage).toEqual({ inputTokens: 30, outputTokens: 15, costUsd: 1.5 });
  });

  it("keeps section order even when responses arrive out of order", async () => {
    const { doc } = await setup();
    const llm = new FakeLlmClient({
      [TOOL_NAMES.summary]: async (req) => {
        if (sectionOf(req) === 1) await sleep(40);
        return SUMMARY_BY_SECTION[sectionOf(req)];
      },
    });
    const out = await generateSummary(doc, { llm });
    expect(out.items.map((i) => i.scope)).toEqual([
      "section:1",
      "section:1",
      "section:2",
      "section:3",
    ]);
  });

  it("never exceeds the concurrency limit", async () => {
    const doc = await longDoc(4, 5);
    let inFlight = 0;
    let max = 0;
    const llm = new FakeLlmClient({
      [TOOL_NAMES.summary]: async () => {
        inFlight++;
        max = Math.max(max, inFlight);
        await sleep(10);
        inFlight--;
        return reply([sum(["S1.1"], "Fact", "A point.")]);
      },
    });
    await generateSummary(doc, { llm, concurrency: 2 });
    expect(max).toBe(2);
  });

  it("reports INSUFFICIENT_SOURCE as data, not as an error", async () => {
    const { doc } = await setup();
    const llm = new FakeLlmClient({
      [TOOL_NAMES.summary]: (req) =>
        sectionOf(req) === 2
          ? reply([], "INSUFFICIENT_SOURCE: only a list of definitions")
          : SUMMARY_BY_SECTION[sectionOf(req)],
    });
    const out = await generateSummary(doc, { llm });
    expect(out.insufficient).toEqual([
      { scope: "section:2", reason: "only a list of definitions" },
    ]);
    expect(out.failures).toEqual([]);
    expect(out.items.every((i) => i.scope !== "section:2")).toBe(true);
  });

  it("keeps items that cite unknown ids, flagged for the verifier", async () => {
    const { doc } = await setup();
    const llm = new FakeLlmClient({
      [TOOL_NAMES.summary]: reply([
        sum(["S9.9"], "made up", "Cites a sentence that does not exist."),
        sum([], "no ids", "Cites nothing."),
        sum(["S1.1", "S8.1"], "partly real", "Cites one real and one fake id."),
      ]),
    });
    const out = await generateSummary(doc, { llm });
    const ok = out.items.filter((i) => i.idsExist);
    expect(ok).toHaveLength(0);
    expect(out.items).toHaveLength(9); // 3 items x 3 sections: nothing silently dropped
    const first = out.items[0];
    expect(first?.problems.join()).toContain("S9.9");
    expect(out.items[1]?.problems.join()).toContain("no source ids");
    expect(out.items[2]?.problems.join()).toContain("S8.1");
  });

  it("drops only blank-text items, and says so; keeps an empty quote with a problem", async () => {
    const { doc } = await setup();
    const llm = new FakeLlmClient({
      [TOOL_NAMES.summary]: (req) =>
        sectionOf(req) === 1
          ? reply([sum(["S1.1"], "ok", "   "), sum(["S1.1"], "", "Has text but no quote.")])
          : reply([]),
    });
    const out = await generateSummary(doc, { llm });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.problems).toContain("summary point: empty evidence_quote");
    expect(out.problems.join()).toContain("section:1 item 1: dropped, empty text");
  });

  it("continues past a failed section and records the failure and its cost", async () => {
    const { doc } = await setup();
    const llm = new FakeLlmClient({
      [TOOL_NAMES.summary]: (req) =>
        sectionOf(req) === 2
          ? fail("provider", "rate limited")
          : SUMMARY_BY_SECTION[sectionOf(req)],
    });
    const out = await generateSummary(doc, { llm });
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0]).toMatchObject({
      scope: "section:2",
      error: { code: "provider", message: "rate limited" },
    });
    expect(out.items.map((i) => i.scope)).toEqual(["section:1", "section:1", "section:3"]);
    expect(out.usage.costUsd).toBeCloseTo(0.003);
  });

  it("returns aborted failures for every call when the signal is already aborted", async () => {
    const { doc } = await setup();
    const llm = new FakeLlmClient({ [TOOL_NAMES.summary]: bySection(SUMMARY_BY_SECTION) });
    const controller = new AbortController();
    controller.abort();
    const out = await generateSummary(doc, { llm, signal: controller.signal });
    expect(out.items).toEqual([]);
    expect(out.failures.map((f) => f.error.code)).toEqual(["aborted", "aborted", "aborted"]);
  });

  describe("long documents", () => {
    it("adds one roll-up call grounded in the original sentences", async () => {
      const doc = await longDoc();
      expect(doc.sentences.length).toBeGreaterThan(40);
      const llm = new FakeLlmClient({
        [TOOL_NAMES.summary]: (req) => {
          const n = sectionOf(req);
          return reply([sum([`S${n}.1`, `S${n}.2`], `Fact ${n}.1`, `Topic ${n} point.`)]);
        },
        [TOOL_NAMES.rollup]: reply([
          sum(["S1.1", "S4.2"], "Fact 1.1", "Topics 1 and 4 are linked."),
          sum(["sum-1"], "Topic 1 point.", "Cites a summary id, which is wrong."),
        ]),
      });
      const out = await generateSummary(doc, { llm });

      expect(llm.callsTo(TOOL_NAMES.rollup)).toHaveLength(1);
      const roll = llm.callsTo(TOOL_NAMES.rollup)[0];
      expect(roll?.user).toContain("<summary_points>");
      expect(roll?.user).toContain("[S1.1]");
      expect(roll?.user).not.toContain("[S1.3]"); // only sentences cited by the section summaries

      expect(out.items.map((i) => i.itemId)).toEqual([
        "sum-1",
        "sum-2",
        "sum-3",
        "sum-4",
        "sum-5",
        "sum-6",
      ]);
      const rollupItems = out.items.filter((i) => i.scope === "rollup");
      expect(rollupItems).toHaveLength(2);
      expect(rollupItems[0]?.idsExist).toBe(true);
      expect(rollupItems[1]?.idsExist).toBe(false); // "sum-1" is not an original sentence id
    });

    it("skips the roll-up when no section produced a point", async () => {
      const doc = await longDoc();
      const llm = new FakeLlmClient({ [TOOL_NAMES.summary]: reply([], "INSUFFICIENT_SOURCE") });
      const out = await generateSummary(doc, { llm });
      expect(llm.callsTo(TOOL_NAMES.rollup)).toHaveLength(0);
      expect(out.items).toEqual([]);
    });
  });
});

describe("progress reporting", () => {
  it("reports start and done for every call, with the task, scope and result", async () => {
    const { doc } = await setup();
    const llm = new FakeLlmClient({ [TOOL_NAMES.summary]: bySection(SUMMARY_BY_SECTION) });
    const events: GenerationProgress[] = [];
    await generateSummary(doc, { llm, concurrency: 1, onProgress: (e) => events.push(e) });
    expect(events.map((e) => `${e.phase}:${e.task}:${e.scope}`)).toEqual([
      "start:summary:section:1",
      "done:summary:section:1",
      "start:summary:section:2",
      "done:summary:section:2",
      "start:summary:section:3",
      "done:summary:section:3",
    ]);
    expect(events[1]?.detail).toBe("2 item(s)");
  });

  it("reports failures with the error message, and insufficiency as a done event", async () => {
    const { doc } = await setup();
    const llm = new FakeLlmClient({
      [TOOL_NAMES.summary]: (req) =>
        sectionOf(req) === 1
          ? fail("provider", "rate limited")
          : reply([], "INSUFFICIENT_SOURCE: nothing usable"),
    });
    const events: GenerationProgress[] = [];
    await generateSummary(doc, { llm, concurrency: 1, onProgress: (e) => events.push(e) });
    const ends = events.filter((e) => e.phase !== "start");
    expect(ends[0]).toMatchObject({ phase: "failed", scope: "section:1", detail: "rate limited" });
    expect(ends[1]).toMatchObject({ phase: "done", detail: "no items (nothing usable)" });
  });

  it("labels the roll-up call", async () => {
    const doc = await longDoc(4, 12);
    const llm = new FakeLlmClient({
      [TOOL_NAMES.summary]: reply([sum(["S1.1"], "Fact", "A point.")]),
      [TOOL_NAMES.rollup]: reply([]),
    });
    const tasks: string[] = [];
    await generateSummary(doc, {
      llm,
      onProgress: (e) => e.phase === "start" && tasks.push(e.task),
    });
    expect(tasks.filter((t) => t === "rollup")).toHaveLength(1);
    expect(tasks.at(-1)).toBe("rollup");
  });

  it("is optional", async () => {
    const { doc } = await setup();
    const llm = new FakeLlmClient({ [TOOL_NAMES.summary]: bySection(SUMMARY_BY_SECTION) });
    await expect(generateSummary(doc, { llm })).resolves.toBeDefined();
  });
});

describe("generateGlossary", () => {
  it("returns term + definition drafts per section", async () => {
    const { doc } = await setup();
    const llm = new FakeLlmClient({
      [TOOL_NAMES.glossary]: (req) =>
        sectionOf(req) === 1
          ? reply([
              {
                source_ids: ["S1.3"],
                evidence_quote: "is called the dispatcher",
                term: " Dispatcher ",
                text: "The component that hands the CPU to the chosen process.",
              },
            ])
          : reply([], "INSUFFICIENT_SOURCE: no definitions"),
    });
    const out = await generateGlossary(doc, { llm });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({
      itemId: "glo-1",
      type: "glossary",
      term: "Dispatcher",
      sourceIds: ["S1.3"],
      idsExist: true,
    });
    expect(out.insufficient.map((i) => i.scope)).toEqual(["section:2", "section:3"]);
  });

  it("drops entries with an empty term or definition and records why", async () => {
    const { doc } = await setup();
    const llm = new FakeLlmClient({
      [TOOL_NAMES.glossary]: reply([
        { source_ids: ["S1.1"], evidence_quote: "q", term: "", text: "def" },
        { source_ids: ["S1.1"], evidence_quote: "q", term: "t", text: "" },
      ]),
    });
    const out = await generateGlossary(doc, { llm });
    expect(out.items).toEqual([]);
    expect(out.problems).toHaveLength(6);
  });
});

describe("generateQuestions", () => {
  const q = (over: Record<string, unknown> = {}) => ({
    source_ids: ["S1.3"],
    evidence_quote: "hands the CPU to the chosen process",
    qtype: "short",
    question: "What is the role of the dispatcher?",
    options: [],
    answer: "It hands the CPU to the process chosen by the scheduler.",
    answer_statement: "The dispatcher hands the CPU to the chosen process.",
    answer_source_ids: ["S1.3"],
    ...over,
  });

  it("asks once over the whole short document for 8 candidates", async () => {
    const { doc } = await setup();
    const llm = new FakeLlmClient({ [TOOL_NAMES.questions]: reply([q()]) });
    const out = await generateQuestions(doc, { llm });
    const calls = llm.callsTo(TOOL_NAMES.questions);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.system).toContain("Write 8 candidate practice questions");
    expect(calls[0]?.user).toContain("[S1.1]");
    expect(calls[0]?.user).toContain("[S3.6]");
    expect(out.items[0]).toMatchObject({
      itemId: "q-1",
      scope: "document",
      type: "question",
      text: "What is the role of the dispatcher?",
      question: "What is the role of the dispatcher?",
      answerStatement: "The dispatcher hands the CPU to the chosen process.",
      answerSourceIds: ["S1.3"],
      idsExist: true,
      problems: [],
    });
    expect(out.items[0]).not.toHaveProperty("options");
  });

  it("flags structural problems in mcq and true_false questions without dropping them", async () => {
    const { doc } = await setup();
    const llm = new FakeLlmClient({
      [TOOL_NAMES.questions]: reply([
        q({ qtype: "mcq", options: ["A", "B", "C", "D"], answer: "B" }),
        q({ qtype: "mcq", options: ["A", "B", "B"], answer: "Z" }),
        q({ qtype: "true_false", answer: "Yes" }),
        q({ qtype: "short", options: ["stray"] }),
      ]),
    });
    const out = await generateQuestions(doc, { llm });
    expect(out.items).toHaveLength(4);
    expect(out.items[0]?.problems).toEqual([]);
    expect(out.items[1]?.problems).toEqual([
      "mcq: expected 4 options, got 3",
      "mcq: answer is not one of the options",
      "mcq: duplicate options",
    ]);
    expect(out.items[2]?.problems).toEqual(['true_false: answer must be "True" or "False"']);
    expect(out.items[3]?.problems).toEqual(["short: options given but not expected"]);
  });

  it("treats unknown answer ids as an idsExist failure", async () => {
    const { doc } = await setup();
    const llm = new FakeLlmClient({
      [TOOL_NAMES.questions]: reply([q({ answer_source_ids: ["S7.7"] })]),
    });
    const out = await generateQuestions(doc, { llm });
    expect(out.items[0]?.idsExist).toBe(false);
  });

  it("splits the candidate budget across sections for long documents", async () => {
    const doc = await longDoc(4, 12);
    const llm = new FakeLlmClient({ [TOOL_NAMES.questions]: reply([]) });
    await generateQuestions(doc, { llm }, 8);
    const calls = llm.callsTo(TOOL_NAMES.questions);
    expect(calls).toHaveLength(4);
    const asked = calls.map((c) => Number(/Write (\d+) candidate/.exec(c.system)?.[1]));
    expect(asked).toEqual([2, 2, 2, 2]);
    expect(calls[0]?.user).not.toContain("[S2.1]");
  });
});

describe("generateDrafts", () => {
  it("runs all three generators", async () => {
    const { doc } = await setup();
    const llm = new FakeLlmClient({
      [TOOL_NAMES.summary]: bySection(SUMMARY_BY_SECTION),
      [TOOL_NAMES.glossary]: reply([]),
      [TOOL_NAMES.questions]: reply([]),
    });
    const drafts = await generateDrafts(doc, { llm });
    expect(drafts.summary.items).toHaveLength(4);
    expect(drafts.glossary.items).toEqual([]);
    expect(drafts.questions.items).toEqual([]);
    expect(llm.requests).toHaveLength(7);
  });
});

describe("cleanQuote (models copy our [S2.4] labels into quotes)", () => {
  it("removes id labels and tidies whitespace, nothing else", () => {
    expect(cleanQuote("[S1.2] Its goal is to keep the CPU busy.")).toBe(
      "Its goal is to keep the CPU busy.",
    );
    expect(cleanQuote("[S3.1] First part.  [S3.2] Second part.")).toBe("First part. Second part.");
    expect(cleanQuote("  [s2.4]waiting time ")).toBe("waiting time");
    expect(cleanQuote("array[S1] is not a label")).toBe("array[S1] is not a label");
  });

  it("is applied to summary, glossary and question drafts", async () => {
    const { doc } = await setup();
    const label = "[S1.3] The component that hands the CPU to the chosen process";
    const llm = new FakeLlmClient({
      [TOOL_NAMES.summary]: reply([sum(["S1.3"], label, "A point.")]),
      [TOOL_NAMES.glossary]: reply([
        { source_ids: ["S1.3"], evidence_quote: label, term: "Dispatcher", text: "A definition." },
      ]),
      [TOOL_NAMES.questions]: reply([
        {
          source_ids: ["S1.3"],
          evidence_quote: label,
          qtype: "short",
          question: "Q?",
          options: [],
          answer: "A.",
          answer_statement: "A.",
          answer_source_ids: ["S1.3"],
        },
      ]),
    });
    const drafts = await generateDrafts(doc, { llm });
    const expected = "The component that hands the CPU to the chosen process";
    expect(drafts.summary.items[0]?.evidenceQuote).toBe(expected);
    expect(drafts.glossary.items[0]?.evidenceQuote).toBe(expected);
    expect(drafts.questions.items[0]?.evidenceQuote).toBe(expected);
  });

  it("treats a quote that was only a label as empty", async () => {
    const { doc } = await setup();
    const llm = new FakeLlmClient({
      [TOOL_NAMES.summary]: reply([sum(["S1.1"], "[S1.1]", "A point.")]),
    });
    const out = await generateSummary(doc, { llm });
    expect(out.items[0]?.problems).toContain("summary point: empty evidence_quote");
  });
});

describe("parseIds", () => {
  it("tolerates case, brackets, lists, and repeats; keeps first-seen order", () => {
    expect(parseIds(["s1.1", "[S1.2]", "S1.1, S1.3", "see S2.10."])).toEqual([
      "S1.1",
      "S1.2",
      "S1.3",
      "S2.10",
    ]);
    expect(parseIds(["sum-1", "nothing here"])).toEqual([]);
  });
});

describe("FakeLlmClient", () => {
  it("rejects a scripted value that violates the schema, like the real adapter", async () => {
    const doc: SourceDoc = await fixtureDoc();
    const llm = new FakeLlmClient({ [TOOL_NAMES.summary]: { items: [{ text: "no evidence" }] } });
    const out = await generateSummary(doc, { llm });
    expect(out.items).toEqual([]);
    expect(out.failures[0]?.error.code).toBe("invalid_args");
  });

  it("reports an unscripted tool as a provider error", async () => {
    const doc = await fixtureDoc();
    const out = await generateSummary(doc, { llm: new FakeLlmClient({}) });
    expect(out.failures[0]?.error.message).toContain("nothing scripted");
  });

  it("consumes array scripts as a queue and errors when exhausted", async () => {
    const doc = await longDoc(1, 5);
    const llm = new FakeLlmClient({
      [TOOL_NAMES.summary]: [
        reply([sum(["S1.1"], "Fact", "One.")]),
        fail("provider", "second call fails"),
      ],
    });
    expect((await generateSummary(doc, { llm })).items).toHaveLength(1);
    const again = await generateSummary(doc, { llm });
    expect(again.failures[0]?.error.message).toBe("second call fails");
    const third = await generateSummary(doc, { llm });
    expect(third.failures[0]?.error.message).toContain("exhausted");
  });
});
