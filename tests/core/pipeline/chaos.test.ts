import { describe, expect, it } from "vitest";
import { lecture7Llm } from "@/demo";
import { fail } from "@/llm/fake";
import { FakeNli } from "@/nlp/fake";
import { invariantViolations, runWith } from "../../support/pipeline";

/**
 * The same invariants as the scenario tests, but over many random mixes of what the checks and the
 * judge say, including failures. A pipeline that only works when everything cooperates is not
 * trustworthy; this one must stay consistent whatever the models do.
 */

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function chaos(seed: number) {
  const rnd = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
  const failureRate = rnd() * 0.4;

  const nli = new FakeNli((_p, _h) => {
    if (rnd() < failureRate) throw new Error("model hiccup");
    return pick([
      { entailment: 0.97, neutral: 0.02, contradiction: 0.01 },
      { entailment: 0.97, neutral: 0.02, contradiction: 0.01 },
      { entailment: 0.7, neutral: 0.25, contradiction: 0.05 },
      { entailment: 0.05, neutral: 0.9, contradiction: 0.05 },
      { entailment: 0.01, neutral: 0.04, contradiction: 0.95 },
    ]);
  });

  const llm = lecture7Llm({
    submit_verdict: () => {
      if (rnd() < failureRate) return fail("provider", "judge hiccup");
      return pick([
        { unsupported_parts: [], verdict: "pass" },
        { unsupported_parts: [], verdict: "pass" },
        { unsupported_parts: ["an extra detail"], verdict: "fail" },
        { unsupported_parts: ["the opposite"], verdict: "contradiction" },
      ]);
    },
    submit_distractor_review: () => {
      if (rnd() < failureRate) return fail("provider", "judge hiccup");
      return {
        options: [
          "RR behaves like FCFS",
          "Throughput becomes zero",
          "Processes are never preempted",
        ].map((option) => ({ option, reason: "r", could_be_correct: rnd() < 0.15 })),
      };
    },
  });
  return { nli, llm };
}

describe("invariants hold whatever the models say", () => {
  it("over 60 seeded random runs", async () => {
    const problems: string[] = [];
    const seen = { supported: 0, partial: 0, removed: 0, degraded: 0, repaired: 0 };

    for (let seed = 1; seed <= 60; seed++) {
      const h = await runWith(chaos(seed));
      const bad = invariantViolations(h);
      if (bad.length > 0) problems.push(`seed ${seed}: ${bad.join("; ")}`);
      if (h.result.status !== "complete") problems.push(`seed ${seed}: status ${h.result.status}`);
      seen.supported += h.result.report.supported;
      seen.partial += h.result.report.partial;
      seen.removed += h.result.report.removed;
      seen.degraded += h.result.degraded ? 1 : 0;
      seen.repaired += h.result.report.repairsAttempted;
    }

    expect(problems).toEqual([]);
    // The runs must actually have covered the interesting cases, or the test proves nothing.
    expect(seen.supported).toBeGreaterThan(100);
    expect(seen.partial).toBeGreaterThan(20);
    expect(seen.removed).toBeGreaterThan(100);
    expect(seen.degraded).toBeGreaterThan(5);
    expect(seen.repaired).toBeGreaterThan(50);
  }, 120_000);
});
