import { describe, expect, it } from "vitest";
import { computeMetrics, type DraftResult, redecide } from "../../eval/lib/metrics";
import { diffThresholds, GRID, runSweep } from "../../eval/lib/sweep";
import { THRESHOLDS } from "../../src/core/verify";

const checks = (
  entailment: number,
  over: Partial<DraftResult["checks"]> = {},
): DraftResult["checks"] => ({
  quote: { ok: true, reason: null },
  nli: { status: "ok", entailment, contradiction: Math.max(0, 1 - entailment) * 0.2 },
  entities: { hard: [], soft: [] },
  overGeneral: [],
  judge: { status: "ok", outcome: "pass", unsupportedParts: [] },
  distractors: { ambiguous: [], novel: [] },
  ...over,
});

const make = (
  id: string,
  label: "good" | "bad",
  entailment: number,
  over: Partial<DraftResult["checks"]> = {},
): DraftResult => {
  const c = checks(entailment, over);
  const r: DraftResult = {
    id,
    caseId: "c",
    split: "dev",
    type: "summary_point",
    label,
    failureType: label === "bad" ? "scope_shift" : null,
    text: id,
    verdict: "SUPPORTED",
    reasons: [],
    degraded: false,
    scores: { quoteFound: true, entailment, novelEntities: [], overGeneral: [], judge: "pass" },
    checks: c,
    latencyMs: 1,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };
  r.verdict = redecide(r, THRESHOLDS);
  return r;
};

/** Good drafts entail strongly except two; bad ones entail weakly except two: a separable set. */
const separable: DraftResult[] = [
  ...Array.from({ length: 18 }, (_, i) => make(`g${i}`, "good", 0.97)),
  make("g-mid", "good", 0.7),
  make("g-low", "good", 0.55),
  ...Array.from({ length: 16 }, (_, i) => make(`b${i}`, "bad", 0.05)),
  make("b-mid", "bad", 0.6),
  make("b-sneaky", "bad", 0.99),
];

describe("runSweep", () => {
  it("is deterministic and enumerates only valid grid points (partial below supported)", () => {
    const a = runSweep(separable);
    const b = runSweep(separable);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    let expected = 0;
    for (const s of GRID.entailmentSupported)
      for (const p of GRID.entailmentPartial) if (p < s) expected++;
    expect(a.gridSize).toBe(expected * GRID.contradiction.length * GRID.softNovelPartial.length);
  });

  it("never recommends a point above the over-flag limit, and maximises recall within it", () => {
    const sweep = runSweep(separable, { maxOverFlag: 0.15 });
    expect(sweep.best).not.toBeNull();
    for (const c of sweep.top) expect(c.metrics.overFlag.rate).toBeLessThanOrEqual(0.15);
    const best = sweep.best;
    if (!best) return;
    // nothing feasible on the grid does better than the pick
    for (const c of sweep.top)
      expect(c.metrics.recall.rate).toBeLessThanOrEqual(best.metrics.recall.rate);
    // the pick's numbers are what you get by scoring it directly
    const direct = computeMetrics(separable, (r) => redecide(r, best.thresholds));
    expect(direct.recall.k).toBe(best.metrics.recall.k);
    expect(direct.overFlag.k).toBe(best.metrics.overFlag.k);
  });

  it("returns no recommendation, and says what is reachable, when the limit cannot be met", () => {
    // every good draft carries a hard problem no threshold can remove
    const stuck = [
      ...Array.from({ length: 10 }, (_, i) =>
        make(`g${i}`, "good", 0.99, { overGeneral: ["always"] }),
      ),
      ...Array.from({ length: 10 }, (_, i) => make(`b${i}`, "bad", 0.05)),
    ];
    const sweep = runSweep(stuck, { maxOverFlag: 0.15 });
    expect(sweep.best).toBeNull();
    expect(sweep.feasible).toBe(0);
    expect(sweep.lowestOverFlag?.metrics.overFlag.rate).toBe(1);
  });

  it("breaks ties toward the smaller change from the current thresholds", () => {
    // all drafts are far from every boundary, so many points tie on every metric
    const easy = [
      ...Array.from({ length: 10 }, (_, i) => make(`g${i}`, "good", 0.999)),
      ...Array.from({ length: 10 }, (_, i) => make(`b${i}`, "bad", 0.001)),
    ];
    const sweep = runSweep(easy);
    expect(sweep.best?.distance).toBe(0);
    expect(sweep.best?.thresholds).toEqual(THRESHOLDS);
  });

  it("reports one-step neighbours of the pick, so a lucky point shows up as unstable", () => {
    const sweep = runSweep(separable);
    expect(sweep.neighbours.length).toBeGreaterThan(0);
    for (const n of sweep.neighbours) {
      expect(n.candidate.thresholds.entailmentPartial).toBeLessThan(
        n.candidate.thresholds.entailmentSupported,
      );
    }
  });

  it("re-deciding reproduces the recorded verdicts at the thresholds the run used", () => {
    for (const r of separable) expect(redecide(r, THRESHOLDS)).toBe(r.verdict);
  });
});

describe("diffThresholds", () => {
  it("shows changed values as -/+ and unchanged ones as such", () => {
    const diff = diffThresholds(THRESHOLDS, { ...THRESHOLDS, softNovelPartial: 4 });
    expect(diff).toContain("- softNovelPartial: 3\n+ softNovelPartial: 4");
    expect(diff).toContain("entailmentSupported: 0.85 (unchanged)");
  });
});
