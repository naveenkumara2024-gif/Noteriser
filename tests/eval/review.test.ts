import { describe, expect, it } from "vitest";
import { parseCase } from "../../eval/lib/cases";
import { notesFromDoc, regressionFromRun } from "../../eval/lib/regression";
import {
  cohenKappa,
  humanMetrics,
  type Label,
  parseCsv,
  reviewRowsFor,
  SHEET_COLUMNS,
  type SheetRow,
  sheetFromCsv,
  sheetToCsv,
  toCsv,
} from "../../eval/lib/sheet";
import { runWith } from "../support/pipeline";

const row = (over: Partial<SheetRow> = {}): SheetRow => ({
  case: "c",
  item_id: "sum-1",
  type: "summary_point",
  text: "t",
  answer: "",
  cited_sentences: "S1.1: x",
  verdict: "SUPPORTED",
  flagged: "no",
  reviewer1: "",
  reviewer2: "",
  notes: "",
  ...over,
});

describe("csv", () => {
  it("round-trips commas, quotes, line breaks and empty fields", () => {
    const rows = [
      ["a", "b,c", 'say "hi"', "line\nbreak", ""],
      ["", "", "", "", "x"],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("reads CRLF files, as Excel writes them", () => {
    expect(parseCsv('a,b\r\n"c\r\nd",e\r\n')).toEqual([
      ["a", "b"],
      ["c\r\nd", "e"],
    ]);
  });

  it("a sheet round-trips with reviewers' marks intact, and rejects one missing a column", () => {
    const rows = [
      row({ reviewer1: "supported", reviewer2: "unclear", notes: 'a "note", with comma' }),
    ];
    expect(sheetFromCsv(sheetToCsv(rows))).toEqual(rows);
    expect(() => sheetFromCsv("case,item_id\nx,y\n")).toThrow(/missing columns/);
    expect(SHEET_COLUMNS).toContain("reviewer2");
  });
});

describe("cohenKappa", () => {
  const rate = (pairs: [Label, Label][]) =>
    cohenKappa(
      pairs.map((p) => p[0]),
      pairs.map((p) => p[1]),
    );

  it("matches a hand-worked example: observed 0.7, expected 0.5, kappa 0.4", () => {
    const pairs: [Label, Label][] = [
      ...Array<[Label, Label]>(4).fill(["supported", "supported"]),
      ...Array<[Label, Label]>(3).fill(["unsupported", "unsupported"]),
      ...Array<[Label, Label]>(2).fill(["supported", "unsupported"]),
      ...Array<[Label, Label]>(1).fill(["unsupported", "supported"]),
    ];
    const k = rate(pairs);
    expect(k.n).toBe(10);
    expect(k.observed).toBeCloseTo(0.7);
    expect(k.expected).toBeCloseTo(0.5);
    expect(k.kappa).toBeCloseTo(0.4);
  });

  it("is 1 for perfect agreement across labels, 0 for chance-level, and NaN for no data or one label", () => {
    expect(
      rate([
        ["supported", "supported"],
        ["unsupported", "unsupported"],
        ["unclear", "unclear"],
      ]).kappa,
    ).toBeCloseTo(1);
    expect(
      rate([
        ["supported", "supported"],
        ["supported", "unsupported"],
        ["unsupported", "supported"],
        ["unsupported", "unsupported"],
      ]).kappa,
    ).toBeCloseTo(0);
    expect(cohenKappa([], []).kappa).toBeNaN();
    expect(
      rate([
        ["supported", "supported"],
        ["supported", "supported"],
      ]).kappa,
    ).toBeNaN();
  });

  it("ignores rows a reviewer has not labelled", () => {
    const k = cohenKappa(
      ["supported", undefined, "unsupported"],
      ["supported", "supported", undefined],
    );
    expect(k.n).toBe(1);
  });
});

describe("humanMetrics (lore section 8.5)", () => {
  const labelled = [
    row({ item_id: "a", reviewer1: "supported", reviewer2: "supported" }),
    row({ item_id: "b", reviewer1: "supported", reviewer2: "supported" }),
    row({ item_id: "c", type: "question (mcq)", reviewer1: "supported", reviewer2: "supported" }),
    row({ item_id: "d", type: "question (short)", reviewer1: "unclear", reviewer2: "supported" }),
    row({ item_id: "e", verdict: "PARTIAL", reviewer1: "unsupported", reviewer2: "supported" }),
    row({ item_id: "f", reviewer1: "", reviewer2: "" }),
  ];

  it("faithfulness needs both reviewers; a slip needs only one", () => {
    const m = humanMetrics(labelled);
    expect(m.rows).toBe(6);
    expect(m.labelled).toBe(5);
    expect(m.faithfulness).toBeCloseTo(3 / 5);
    expect(m.unsupportedSlip).toBeCloseTo(1 / 5);
    expect(m.contested).toBe(2);
  });

  it("question quality is over questions only, and the verifier agreement over its SUPPORTED items", () => {
    const m = humanMetrics(labelled);
    expect(m.questionQuality).toBeCloseTo(1 / 2);
    // SUPPORTED by the verifier and labelled: a, b, c, d -> both supported: a, b, c
    expect(m.verifierSupportedAgreement).toBeCloseTo(3 / 4);
  });

  it("returns n/a values rather than numbers when nothing is labelled", () => {
    const m = humanMetrics([row()]);
    expect(m.labelled).toBe(0);
    expect(m.faithfulness).toBeNaN();
    expect(m.questionQuality).toBeNull();
  });
});

describe("the review sheet for a pipeline run", () => {
  it("lists exactly the items a reader would see, each with its cited sentences, and never a removed item", async () => {
    const { result } = await runWith();
    const rows = reviewRowsFor("lecture7", result);
    expect(rows).toHaveLength(
      result.summary.length + result.glossary.length + result.questions.length,
    );
    const removed = new Set(result.removed.map((r) => r.envelope.itemId));
    for (const r of rows) {
      expect(removed.has(r.item_id)).toBe(false);
      expect(r.cited_sentences).toMatch(/^S\d+\.\d+: /);
      expect(r.reviewer1).toBe("");
      expect(r.reviewer2).toBe("");
    }
    const mcq = rows.find((r) => r.type === "question (mcq)");
    expect(mcq?.text).toContain("A) RR behaves like FCFS");
    expect(mcq?.answer).toBe("Context-switch overhead increases");
    expect(rows.find((r) => r.item_id === "glo-8")?.flagged).toBe("yes");
  });
});

describe("regressions from a stored run", () => {
  it("rebuilds the notes so the sentence ids come out the same", async () => {
    const { store, result } = await runWith();
    const run = await store.getRun(result.runId);
    if (!run?.doc) throw new Error("run has a doc");
    const again = await parseCase({
      id: "x",
      split: "regression",
      subject: "",
      topic: "",
      notes: notesFromDoc(run.doc),
      drafts: [],
    });
    expect(again.sentences.map((s) => [s.id, s.text])).toEqual(
      run.doc.sentences.map((s) => [s.id, s.text]),
    );
  });

  it("turns a confirmed bad draft into a loadable case", async () => {
    const { store, result } = await runWith();
    const run = await store.getRun(result.runId);
    if (!run) throw new Error("stored");
    const c = await regressionFromRun(run, {
      id: "reg-x",
      itemId: "sum-7",
      label: "bad",
      failureType: "outside_fact",
    });
    expect(c.split).toBe("regression");
    expect(c.drafts).toHaveLength(1);
    expect(c.drafts[0]).toMatchObject({
      label: "bad",
      failureType: "outside_fact",
      text: "Round Robin is the most widely used scheduler in modern operating systems.",
    });
  });

  it("explains why it cannot: unknown item, missing failure type, question drafts", async () => {
    const { store, result } = await runWith();
    const run = await store.getRun(result.runId);
    if (!run) throw new Error("stored");
    await expect(
      regressionFromRun(run, { id: "r", itemId: "nope-1", label: "good" }),
    ).rejects.toThrow(/no attempt-1 draft nope-1/);
    await expect(
      regressionFromRun(run, { id: "r", itemId: "sum-7", label: "bad" }),
    ).rejects.toThrow(/needs --failure/);
    await expect(regressionFromRun(run, { id: "r", itemId: "q-1", label: "good" })).rejects.toThrow(
      /Question drafts are not supported/,
    );
  });
});
