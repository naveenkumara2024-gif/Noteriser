import { describe, expect, it } from "vitest";
import { loadCases, loadRegressions } from "../../eval/lib/cases";
import {
  computeMetrics,
  type DraftResult,
  percentile,
  rate,
  redecide,
} from "../../eval/lib/metrics";
import { offlineJudge, verifyCases } from "../../eval/lib/runner";
import { THRESHOLDS } from "../../src/core/verify";
import { ENTAILED, FakeNli } from "../../src/nlp/fake";

const checks = (over: Partial<DraftResult["checks"]> = {}): DraftResult["checks"] => ({
  quote: { ok: true, reason: null },
  nli: { status: "ok", entailment: 0.99, contradiction: 0.01 },
  entities: { hard: [], soft: [] },
  overGeneral: [],
  judge: { status: "ok", outcome: "pass", unsupportedParts: [] },
  distractors: { ambiguous: [], novel: [] },
  ...over,
});

const draft = (
  id: string,
  label: "good" | "bad",
  verdict: DraftResult["verdict"],
  extra: Partial<DraftResult> = {},
): DraftResult => ({
  id,
  caseId: "c",
  split: "dev",
  type: "summary_point",
  label,
  failureType: label === "bad" ? "scope_shift" : null,
  text: id,
  verdict,
  reasons: [],
  degraded: false,
  scores: { quoteFound: true, entailment: 0.9, novelEntities: [], overGeneral: [], judge: "pass" },
  checks: checks(),
  latencyMs: 10,
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  ...extra,
});

describe("rate (Wilson interval)", () => {
  it("matches known values and stays inside [0, 1]", () => {
    const r = rate(8, 10);
    expect(r.rate).toBeCloseTo(0.8);
    expect(r.lo).toBeCloseTo(0.49, 2);
    expect(r.hi).toBeCloseTo(0.943, 2);
    expect(rate(0, 10).lo).toBe(0);
    expect(rate(10, 10).hi).toBe(1);
    expect(rate(0, 0)).toEqual({ n: 0, k: 0, rate: 0, lo: 0, hi: 0 });
  });

  it("is wider for a smaller sample at the same rate", () => {
    const small = rate(5, 10);
    const large = rate(50, 100);
    expect(small.hi - small.lo).toBeGreaterThan(large.hi - large.lo);
  });
});

describe("computeMetrics", () => {
  const results: DraftResult[] = [
    draft("g1", "good", "SUPPORTED"),
    draft("g2", "good", "SUPPORTED"),
    draft("g3", "good", "PARTIAL"),
    draft("g4", "good", "UNSUPPORTED"),
    draft("b1", "bad", "UNSUPPORTED", { failureType: "fake_quote" }),
    draft("b2", "bad", "PARTIAL", { failureType: "fake_quote" }),
    draft("b3", "bad", "CONTRADICTED", { failureType: "reversed_meaning" }),
    draft("b4", "bad", "SUPPORTED", { failureType: "reversed_meaning" }),
  ];

  it("counts a bad draft as caught unless SUPPORTED, and separates outright rejection", () => {
    const m = computeMetrics(results);
    expect(m.bad).toBe(4);
    expect(m.recall.k).toBe(3);
    expect(m.hardRecall.k).toBe(2); // PARTIAL is flagged, not rejected
    expect(m.slipped).toBe(1);
  });

  it("counts a good draft as over-flagged unless SUPPORTED (PARTIAL or worse)", () => {
    const m = computeMetrics(results);
    expect(m.overFlag.k).toBe(2);
    expect(m.overFlag.n).toBe(4);
    expect(m.overReject.k).toBe(1);
  });

  it("balanced accuracy is the mean of recall and 1 minus the over-flag rate", () => {
    const m = computeMetrics(results);
    expect(m.balancedAccuracy).toBeCloseTo((0.75 + 0.5) / 2);
  });

  it("reports recall per failure type", () => {
    const m = computeMetrics(results);
    expect(m.byType.fake_quote?.caught.k).toBe(2);
    expect(m.byType.fake_quote?.hardCaught.k).toBe(1);
    expect(m.byType.reversed_meaning?.caught).toMatchObject({ k: 1, n: 2 });
  });

  it("citation validity: of drafts let through, the share with a valid quote", () => {
    const withBadQuote = [
      ...results,
      draft("x", "bad", "PARTIAL", { checks: checks({ quote: { ok: false, reason: "no" } }) }),
    ];
    const m = computeMetrics(withBadQuote);
    // let through: g1 g2 g3 b2 b4 x = 6; valid quote: 5
    expect(m.citationValidity).toMatchObject({ k: 5, n: 6 });
  });

  it("scores with a different verdict function without touching the stored verdicts", () => {
    const m = computeMetrics(results, () => "SUPPORTED");
    expect(m.recall.k).toBe(0);
    expect(m.overFlag.k).toBe(0);
  });
});

describe("percentile", () => {
  it("handles empty, single and ordered data", () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(6);
    expect(percentile([10, 1, 5], 1)).toBe(10);
  });
});

describe("the verifier run over the real cases (stand-in entailment model, neutral judge)", () => {
  it("returns one result per draft, in order, with the check results needed to re-decide", async () => {
    const cases = loadCases().slice(0, 2);
    const results = await verifyCases({
      cases,
      nli: new FakeNli(() => ENTAILED),
      llm: offlineJudge("fake"),
      concurrency: 2,
    });
    expect(results.map((r) => r.id)).toEqual(
      cases.flatMap((c) => c.drafts.map((_, i) => `${c.id}-d${i + 1}`)),
    );
    // Re-deciding with the thresholds the run used reproduces every verdict: the sweep relies on it.
    for (const r of results) expect(redecide(r, THRESHOLDS), r.id).toBe(r.verdict);
    // the judge ran on every draft that has a citation, even ones the other checks had settled
    expect(results.every((r) => r.checks.judge.status === "ok")).toBe(true);
    expect(results.every((r) => r.latencyMs >= 0)).toBe(true);
  });

  it("the judge-off mode behaves like a provider outage: nothing can be SUPPORTED", async () => {
    const results = await verifyCases({
      cases: loadCases().slice(0, 1),
      nli: new FakeNli(() => ENTAILED),
      llm: offlineJudge("off"),
    });
    expect(results.every((r) => r.verdict !== "SUPPORTED")).toBe(true);
    expect(results.some((r) => r.degraded)).toBe(true);
  });

  it("every regression case is handled correctly by the real checks that need no model", async () => {
    // quote-only regressions never reach the entailment model's verdict, so a stand-in is enough
    const quoteCases = loadRegressions().filter((c) => /short-quote|spliced/.test(c.id));
    const results = await verifyCases({
      cases: quoteCases,
      nli: new FakeNli(() => ENTAILED),
      llm: offlineJudge("fake"),
    });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(r.verdict, r.id).toBe("UNSUPPORTED");
  });
});
