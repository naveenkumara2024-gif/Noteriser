import { describe, expect, it } from "vitest";
import { composePremise, type PremiseUnit, premiseViews, scoreEntailment } from "@/core/verify";
import { CONTRADICTED, ENTAILED, FakeNli, NEUTRAL } from "@/nlp/fake";

// FakeNli counts ceil(words * 1.3) tokens: an 8-word sentence is 11 tokens.
const unit = (i: number, section = 1, heading: string | null = null): PremiseUnit => ({
  text: `Sentence number ${i} has exactly seven words here.`,
  section,
  heading,
});
const units = (n: number): PremiseUnit[] => Array.from({ length: n }, (_, i) => unit(i + 1));
const fake = new FakeNli();
const count = (t: string): number => fake.countTokens(t);

describe("composePremise", () => {
  it("prefixes a heading once per section", () => {
    const u = [unit(1, 1, "Scheduling criteria"), unit(2, 1, "Scheduling criteria")];
    expect(composePremise(u)).toBe(
      "Scheduling criteria: Sentence number 1 has exactly seven words here. Sentence number 2 has exactly seven words here.",
    );
  });

  it("repeats the prefix when the section changes", () => {
    const text = composePremise([unit(1, 1, "A"), unit(2, 2, "B")]);
    expect(text).toBe(
      "A: Sentence number 1 has exactly seven words here. B: Sentence number 2 has exactly seven words here.",
    );
  });

  it("omits the prefix when the heading is not source text", () => {
    expect(composePremise([unit(1, 1, null)])).toBe(unit(1).text);
  });

  it("drops the heading's own trailing punctuation", () => {
    expect(composePremise([unit(1, 1, "What is CPU scheduling?")])).toBe(
      `What is CPU scheduling: ${unit(1).text}`,
    );
  });
});

describe("premiseViews", () => {
  it("one sentence is one view", () => {
    expect(premiseViews(units(1), 500, count)).toEqual([unit(1).text]);
  });

  it("two sentences: together, then each alone", () => {
    expect(premiseViews(units(2), 500, count)).toEqual([
      composePremise(units(2)),
      unit(1).text,
      unit(2).text,
    ]);
  });

  it("three sentences add the neighbouring pairs", () => {
    const views = premiseViews(units(3), 500, count) ?? [];
    expect(views).toHaveLength(1 + 2 + 3);
    expect(views).toContain(composePremise([unit(1), unit(2)]));
    expect(views).toContain(composePremise([unit(2), unit(3)]));
  });

  it("skips neighbouring pairs for very long citations", () => {
    const views = premiseViews(units(9), 5000, count) ?? [];
    expect(views).toHaveLength(1 + 9);
  });

  it("windows a premise that does not fit, overlapping by one sentence, and also offers singles", () => {
    const u = units(12);
    const views = premiseViews(u, 30, count) ?? [];
    expect(views.length).toBeGreaterThan(12);
    for (const v of views) expect(count(v)).toBeLessThanOrEqual(30);
    for (const x of u) expect(views).toContain(x.text); // every sentence is available alone
  });

  it("counts a heading against the budget", () => {
    const withHeading = [unit(1, 1, "A very long section heading indeed here")];
    expect(premiseViews(withHeading, 11, count)).toBeNull(); // 11 tokens fit the sentence, not the heading
    expect(premiseViews([unit(1)], 11, count)).not.toBeNull();
  });

  it("returns null when one sentence alone cannot fit", () => {
    expect(premiseViews(units(3), 5, count)).toBeNull();
  });

  it("is deterministic and has no duplicate views", () => {
    const a = premiseViews(units(5), 500, count) ?? [];
    expect(new Set(a).size).toBe(a.length);
    expect(premiseViews(units(5), 500, count)).toEqual(a);
  });
});

describe("scoreEntailment", () => {
  it("scores a single cited sentence with one call", async () => {
    const nli = new FakeNli(ENTAILED);
    const r = await scoreEntailment(nli, units(1), "A short claim.");
    expect(r.ok && r.value.calls).toBe(1);
    expect(r.ok && r.value.entailment).toBeCloseTo(0.97);
    expect(nli.calls[0]).toEqual({ premise: unit(1).text, hypothesis: "A short claim." });
  });

  it("puts the section heading into the premise", async () => {
    const nli = new FakeNli(ENTAILED);
    await scoreEntailment(nli, [unit(1, 2, "Scheduling criteria")], "Claim.");
    expect(nli.calls[0]?.premise).toBe(`Scheduling criteria: ${unit(1).text}`);
  });

  it("uses the BEST view: a claim lost in the full premise but supported by one sentence still counts", async () => {
    // Mirrors a real failure of the small NLI model: entailed by one sentence alone (0.97),
    // neutral against all of them together (0.21).
    const only2 = unit(2).text;
    const nli = new FakeNli((premise) =>
      premise === only2 ? ENTAILED : { entailment: 0.21, neutral: 0.7, contradiction: 0.09 },
    );
    const r = await scoreEntailment(nli, units(3), "Claim about sentence two.");
    expect(r.ok && r.value.entailment).toBeCloseTo(0.97);
    expect(nli.calls.length).toBe(6); // together + 2 pairs + 3 singles
  });

  it("windows a long premise and still finds the supporting sentence", async () => {
    const target = unit(9).text;
    const nli = new FakeNli(
      (premise) =>
        premise === target ? ENTAILED : { entailment: 0.01, neutral: 0.95, contradiction: 0.04 },
      60,
    );
    const r = await scoreEntailment(nli, units(20), "Claim.");
    expect(r.ok && r.value.entailment).toBeCloseTo(0.97);
    for (const c of nli.calls) {
      expect(nli.countTokens(c.premise) + nli.countTokens(c.hypothesis)).toBeLessThanOrEqual(60);
    }
  });

  it("reports the WORST contradiction over all views", async () => {
    const nli = new FakeNli((p) => (p === unit(2).text ? CONTRADICTED : ENTAILED));
    const r = await scoreEntailment(nli, units(3), "Claim.");
    expect(r.ok && r.value.contradiction).toBeCloseTo(0.95);
    expect(r.ok && r.value.entailment).toBeCloseTo(0.97);
  });

  it("splits a multi-sentence claim and lets the weakest sentence decide", async () => {
    const nli = new FakeNli((_p, h) => (h.startsWith("Weak") ? NEUTRAL : ENTAILED));
    const r = await scoreEntailment(nli, units(1), "Strong sentence one. Weak sentence two.");
    expect(nli.calls.map((c) => c.hypothesis)).toEqual([
      "Strong sentence one.",
      "Weak sentence two.",
    ]);
    expect(r.ok && r.value.entailment).toBeCloseTo(0.05);
    expect(r.ok && r.value.calls).toBe(2);
  });

  it("reports a contradiction found for any sub-claim", async () => {
    const nli = new FakeNli((_p, h) => (h.startsWith("Bad") ? CONTRADICTED : ENTAILED));
    const r = await scoreEntailment(nli, units(1), "Fine statement here. Bad statement here.");
    expect(r.ok && r.value.contradiction).toBeCloseTo(0.95);
  });

  it("returns an error, not a truncation, when one sentence is too long", async () => {
    const nli = new FakeNli(ENTAILED, 20);
    const r = await scoreEntailment(nli, units(2), "Claim.");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("too long");
    expect(nli.calls).toHaveLength(0);
  });

  it("returns the model's failure as a message", async () => {
    const r = await scoreEntailment(new FakeNli(new Error("onnx exploded")), units(1), "Claim.");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("The entailment model failed: onnx exploded");
  });
});
