import { beforeAll, describe, expect, it } from "vitest";
import {
  checkCases,
  describeCases,
  type EvalCase,
  FAILURE_TYPES,
  loadCases,
  loadRegressions,
  parseCase,
  RULES,
  splitFor,
  toDraftItems,
} from "../../eval/lib/cases";

let cases: EvalCase[];
beforeAll(() => {
  cases = loadCases();
});

describe("the labelled case set", () => {
  it("meets every rule of the stage: size, mix per case, failure types, split, citations, quotes", async () => {
    expect(await checkCases(cases, { requireSplitRule: true })).toEqual([]);
    expect(cases.length).toBeGreaterThanOrEqual(RULES.minCases);
  });

  it("assigns the split by the fixed alternating rule over ids sorted alphabetically", () => {
    const sorted = [...cases].sort((a, b) => a.id.localeCompare(b.id));
    expect(cases.map((c) => c.id)).toEqual(sorted.map((c) => c.id));
    for (const [i, c] of sorted.entries()) expect(c.split, c.id).toBe(splitFor(i));
    expect(cases.filter((c) => c.split === "dev")).toHaveLength(cases.length / 2);
  });

  it("has every failure type at least five times overall, and at least three times in each split", () => {
    for (const split of ["dev", "test"] as const) {
      const d = describeCases(cases.filter((c) => c.split === split));
      for (const t of FAILURE_TYPES)
        expect(d.byType[t] ?? 0, `${split} ${t}`).toBeGreaterThanOrEqual(3);
      // roughly balanced classes, so accuracy is not dominated by one label
      expect(Math.abs(d.good - d.bad)).toBeLessThanOrEqual(Math.ceil(d.cases));
    }
    const all = describeCases(cases);
    for (const t of FAILURE_TYPES)
      expect(all.byType[t] ?? 0, t).toBeGreaterThanOrEqual(RULES.minPerFailureType);
  });

  it("spreads subjects across computer science, biology, history, physics, economics and law/ethics", () => {
    const subjects = new Set(cases.map((c) => c.subject));
    for (const s of [
      "computer science",
      "biology",
      "history",
      "physics",
      "economics",
      "law and ethics",
    ]) {
      expect(subjects.has(s), s).toBe(true);
    }
  });

  it("includes numbers, negations, conditionals and definitions in the notes", () => {
    const notes = cases.map((c) => c.notes).join("\n");
    expect(notes).toMatch(/\d/);
    expect(notes).toMatch(/\bdoes not\b|\bnot\b/);
    expect(notes).toMatch(/\bif\b|\bwhen\b/i);
    expect(cases.some((c) => c.drafts.some((d) => d.type === "glossary"))).toBe(true);
  });

  it("every draft's text is distinct from the notes' own sentences (no verbatim copies labelled as paraphrase)", async () => {
    for (const c of cases) {
      const doc = await parseCase(c);
      const sentences = new Set(doc.sentences.map((s) => s.text));
      // A fake_quote draft may state a true, verbatim claim: only its quote is wrong, by design.
      for (const d of c.drafts.filter((x) => x.label === "bad" && x.failureType !== "fake_quote")) {
        expect(sentences.has(d.text), `${c.id}: bad draft equals a source sentence`).toBe(false);
      }
    }
  });

  it("turns drafts into verifier items with ids <case>-d<n>, nothing generated", async () => {
    const c = cases[0];
    if (!c) throw new Error("no cases");
    const items = toDraftItems(c, await parseCase(c));
    expect(items.map((i) => i.itemId)).toEqual(c.drafts.map((_, i) => `${c.id}-d${i + 1}`));
    expect(items.every((i) => i.idsExist)).toBe(true);
  });
});

describe("the checker itself", () => {
  const base = (): EvalCase => structuredClone(cases[0] as EvalCase);

  it("names the draft when a quote is not in the cited sentences", async () => {
    const c = base();
    const draft = c.drafts.find((d) => d.label === "good");
    if (!draft) throw new Error("fixture");
    draft.evidenceQuote = "words that are nowhere in the notes";
    const problems = await checkCases([c], { rules: null });
    expect(problems.join("\n")).toMatch(/d\d+: its quote is not in the cited sentences/);
  });

  it("flags a fake_quote whose quote is real, a bad draft without a type, and a missing citation", async () => {
    const c = base();
    const bad = c.drafts.find((d) => d.label === "bad" && d.failureType !== "fake_quote");
    if (!bad) throw new Error("fixture");
    bad.failureType = "fake_quote";
    const a = await checkCases([c], { rules: null });
    expect(a.join("\n")).toMatch(/fake_quote draft whose quote is actually in the cited sentences/);

    const d = base();
    const target = d.drafts.find((x) => x.label === "bad");
    if (!target) throw new Error("fixture");
    target.failureType = null;
    target.sourceIds = ["S9.9"];
    const b = await checkCases([d], { rules: null });
    expect(b.join("\n")).toMatch(/has no failureType/);
    expect(b.join("\n")).toMatch(/S9\.9, which is not in the notes/);
  });

  it("enforces the counts: cases, per-case mix and failure types", async () => {
    const c = base();
    c.drafts = c.drafts.filter((d) => d.label === "good").slice(0, 1);
    const problems = await checkCases([c]);
    expect(problems.join("\n")).toMatch(/only 1 cases/);
    expect(problems.join("\n")).toMatch(/1 good drafts \(need 2\)/);
    expect(problems.join("\n")).toMatch(/0 bad drafts \(need 2\)/);
    expect(problems.join("\n")).toMatch(/failure type invented_stat appears 0 times/);
  });

  it("rejects a split that breaks the alternating rule", async () => {
    const [first] = cases;
    if (!first) throw new Error("no cases");
    const problems = await checkCases([{ ...structuredClone(first), split: "test" }], {
      rules: null,
      requireSplitRule: true,
    });
    expect(problems.join("\n")).toMatch(/split is test but the alternating rule says dev/);
  });
});

describe("regression cases", () => {
  it("load and satisfy the checks that apply to them", async () => {
    const regressions = loadRegressions();
    expect(regressions.length).toBeGreaterThanOrEqual(5);
    expect(regressions.every((c) => c.split === "regression")).toBe(true);
    expect(await checkCases(regressions, { rules: null })).toEqual([]);
  });
});
