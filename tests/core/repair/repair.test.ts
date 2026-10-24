import { describe, expect, it } from "vitest";
import type { GlossaryDraft, QuestionDraft, SummaryDraft } from "@/core/generate";
import { TOOL_NAMES } from "@/core/generate";
import { isRepairable, repairItem, repairPrompt } from "@/core/repair";
import { FakeLlmClient, fail } from "@/llm/fake";
import { fixtureDoc, longDoc } from "../../support/docs";

const reply = (items: unknown[], insufficient_reason = "") => ({ items, insufficient_reason });

const glossary = (over: Partial<GlossaryDraft> = {}): GlossaryDraft => ({
  itemId: "glo-4",
  type: "glossary",
  scope: "section:3",
  sourceIds: ["S3.5"],
  evidenceQuote: "the process is preempted and placed at the end of the ready queue",
  term: "Preemption",
  text: "Forcibly taking the CPU away from a running process.",
  idsExist: true,
  problems: [],
  ...over,
});

const summary = (over: Partial<SummaryDraft> = {}): SummaryDraft => ({
  itemId: "sum-2",
  type: "summary_point",
  scope: "section:3",
  sourceIds: ["S3.4"],
  evidenceQuote: "gives the minimum average waiting time",
  text: "SJF always gives the best waiting time.",
  idsExist: true,
  problems: [],
  ...over,
});

const question = (over: Partial<QuestionDraft> = {}): QuestionDraft => ({
  itemId: "q-3",
  type: "question",
  scope: "document",
  sourceIds: ["S3.6"],
  evidenceQuote: "if it is very small, context-switch overhead increases",
  text: "What happens with a tiny quantum?",
  idsExist: true,
  problems: [],
  qtype: "short",
  question: "What happens with a tiny quantum?",
  answer: "It is bad.",
  answerStatement: "A tiny quantum is bad for performance.",
  answerSourceIds: ["S3.6"],
  ...over,
});

describe("isRepairable", () => {
  it("repairs PARTIAL and UNSUPPORTED, never CONTRADICTED or SUPPORTED", () => {
    expect(isRepairable("PARTIAL")).toBe(true);
    expect(isRepairable("UNSUPPORTED")).toBe(true);
    expect(isRepairable("CONTRADICTED")).toBe(false);
    expect(isRepairable("SUPPORTED")).toBe(false);
  });
});

describe("repairPrompt", () => {
  it("carries the original item and every finding verbatim", async () => {
    const doc = await fixtureDoc();
    const reasons = [
      'Adds wording the cited text does not use: "always", "best".',
      "The closest sentence in the notes is S3.4, not the cited S3.2.",
    ];
    const p = repairPrompt(summary(), reasons, doc);

    expect(p.user).toContain("<item_to_repair>");
    expect(p.user).toContain('"text": "SJF always gives the best waiting time."');
    expect(p.user).toContain('"source_ids": [\n    "S3.4"\n  ]');
    for (const r of reasons) expect(p.user).toContain(`- ${r}`);
    expect(p.user).toContain("<problems>");
  });

  it("asks for a narrower, extractive replacement, with the shared closed-book rules", async () => {
    const doc = await fixtureDoc();
    const p = repairPrompt(glossary(), ["x"], doc);
    expect(p.system).toContain("Use ONLY the numbered source sentences");
    expect(p.system).toContain("narrow the claim rather than extend it");
    expect(p.system).toContain("Define the same term");
    expect(p.system).not.toMatch(/judge/i);
  });

  it("describes a question in the generator's own field names", async () => {
    const doc = await fixtureDoc();
    const p = repairPrompt(
      question({ qtype: "mcq", options: ["a", "b", "c", "d"], answer: "a" }),
      ["x"],
      doc,
    );
    for (const field of [
      "qtype",
      "question",
      "options",
      "answer",
      "answer_statement",
      "answer_source_ids",
    ]) {
      expect(p.user).toContain(`"${field}"`);
    }
    expect(p.system).toContain("question of the same type");
  });

  it("shows a short document whole, so the model can re-cite anywhere", async () => {
    const doc = await fixtureDoc();
    const p = repairPrompt(summary(), ["x"], doc);
    expect(p.user).toContain("[S1.1]");
    expect(p.user).toContain("[S3.6]");
  });

  it("shows a long document only around the item", async () => {
    const doc = await longDoc(4, 12);
    const p = repairPrompt(summary({ scope: "section:2", sourceIds: ["S2.3"] }), ["x"], doc);
    expect(p.user).toContain("[S2.3]");
    expect(p.user).not.toContain("[S1.1]");
    expect(p.user).not.toContain("[S4.1]");
  });

  it("falls back to the opening sections when nothing locates the item", async () => {
    const doc = await longDoc(5, 12);
    const p = repairPrompt(summary({ scope: "rollup", sourceIds: ["S9.9"] }), ["x"], doc);
    expect(p.user).toContain("[S1.1]");
    expect(p.user).toContain("[S3.12]");
    expect(p.user).not.toContain("[S4.1]");
  });
});

describe("repairItem", () => {
  it("returns a corrected draft that keeps the id, kind and scope", async () => {
    const doc = await fixtureDoc();
    const llm = new FakeLlmClient({
      [TOOL_NAMES.summary]: reply([
        {
          source_ids: ["S3.4"],
          evidence_quote: "gives the minimum average waiting time",
          text: "SJF gives the minimum average waiting time.",
        },
      ]),
    });
    const r = await repairItem(summary(), ["uses 'always'"], doc, { llm });
    expect(r.note).toBeNull();
    expect(r.draft).toMatchObject({
      itemId: "sum-2",
      type: "summary_point",
      scope: "section:3",
      text: "SJF gives the minimum average waiting time.",
      sourceIds: ["S3.4"],
      idsExist: true,
    });
    expect(r.usage.costUsd).toBeGreaterThan(0);
  });

  it("is a generator-role call at low temperature", async () => {
    const doc = await fixtureDoc();
    const llm = new FakeLlmClient({ [TOOL_NAMES.summary]: reply([]) });
    await repairItem(summary(), ["x"], doc, { llm });
    expect(llm.requests[0]).toMatchObject({ role: "generator", temperature: 0.1 });
  });

  it("keeps the glossary term even if the model changes it", async () => {
    const doc = await fixtureDoc();
    const llm = new FakeLlmClient({
      [TOOL_NAMES.glossary]: reply([
        {
          source_ids: ["S3.5"],
          evidence_quote: "after which the process is preempted",
          term: "Quantum",
          text: "A process stopped after its time slice.",
        },
      ]),
    });
    const r = await repairItem(glossary(), ["x"], doc, { llm });
    expect(r.draft).toMatchObject({ type: "glossary", term: "Preemption", itemId: "glo-4" });
  });

  it("repairs a question, keeping its id", async () => {
    const doc = await fixtureDoc();
    const llm = new FakeLlmClient({
      [TOOL_NAMES.questions]: reply([
        {
          source_ids: ["S3.6"],
          evidence_quote: "if it is very small, context-switch overhead increases",
          qtype: "short",
          question: "What happens if the time quantum is very small?",
          options: [],
          answer: "Context-switch overhead increases.",
          answer_statement: "If the time quantum is very small, context-switch overhead increases.",
          answer_source_ids: ["S3.6"],
        },
      ]),
    });
    const r = await repairItem(question(), ["x"], doc, { llm });
    expect(r.draft).toMatchObject({ itemId: "q-3", type: "question", qtype: "short" });
  });

  it("uses only the first item if the model returns several", async () => {
    const doc = await fixtureDoc();
    const item = (text: string) => ({
      source_ids: ["S3.4"],
      evidence_quote: "gives the minimum average waiting time",
      text,
    });
    const llm = new FakeLlmClient({
      [TOOL_NAMES.summary]: reply([item("First."), item("Second.")]),
    });
    const r = await repairItem(summary(), ["x"], doc, { llm });
    expect(r.draft?.text).toBe("First.");
  });

  it("reports 'no replacement' with the model's reason", async () => {
    const doc = await fixtureDoc();
    const llm = new FakeLlmClient({
      [TOOL_NAMES.summary]: reply([], "INSUFFICIENT_SOURCE: the notes do not say this"),
    });
    const r = await repairItem(summary(), ["x"], doc, { llm });
    expect(r.draft).toBeNull();
    expect(r.note).toBe(
      "the model could not write a supported replacement (the notes do not say this)",
    );
  });

  it("reports an empty reply without a reason", async () => {
    const doc = await fixtureDoc();
    const llm = new FakeLlmClient({ [TOOL_NAMES.summary]: reply([]) });
    const r = await repairItem(summary(), ["x"], doc, { llm });
    expect(r.note).toBe("the model returned no replacement");
  });

  it("never throws: a failed call leaves the original standing, and the cost is counted", async () => {
    const doc = await fixtureDoc();
    const llm = new FakeLlmClient({ [TOOL_NAMES.summary]: fail("provider", "rate limited") });
    const r = await repairItem(summary(), ["x"], doc, { llm });
    expect(r.draft).toBeNull();
    expect(r.note).toBe("repair call failed: rate limited");
    expect(r.usage.costUsd).toBeCloseTo(0.001);
  });
});
