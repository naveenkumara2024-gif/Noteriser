import { describe, expect, it } from "vitest";
import { type DecideInputs, decide, THRESHOLDS } from "@/core/verify";

/** Everything fine: the only way to get SUPPORTED. */
const GOOD: DecideInputs = {
  quote: { ok: true, reason: null },
  nli: { status: "ok", entailment: 0.97, contradiction: 0.01 },
  entities: { hard: [], soft: [] },
  overGeneral: [],
  judge: { status: "ok", outcome: "pass", unsupportedParts: [] },
  distractors: { ambiguous: [], novel: [] },
};
const with_ = (over: Partial<DecideInputs>): DecideInputs => ({ ...GOOD, ...over });
const nli = (entailment: number, contradiction = 0): DecideInputs["nli"] => ({
  status: "ok",
  entailment,
  contradiction,
});

describe("decide: the lore §3.4 table", () => {
  it("SUPPORTED: quote found, entailment high, no novel entities, judge passes", () => {
    expect(decide(GOOD)).toEqual({ verdict: "SUPPORTED", reasons: [], degraded: false });
  });

  it("PARTIAL: moderate entailment", () => {
    const d = decide(with_({ nli: nli(0.7) }));
    expect(d.verdict).toBe("PARTIAL");
    expect(d.reasons[0]).toContain("Only partly supported");
  });

  it("PARTIAL: the judge flags a minor extra detail", () => {
    const d = decide(
      with_({
        judge: { status: "ok", outcome: "fail", unsupportedParts: ["forcibly taking the CPU"] },
      }),
    );
    expect(d.verdict).toBe("PARTIAL");
    expect(d.reasons[0]).toContain("forcibly taking the CPU");
  });

  it("UNSUPPORTED: neutral entailment", () => {
    const d = decide(with_({ nli: nli(0.05) }));
    expect(d.verdict).toBe("UNSUPPORTED");
    expect(d.reasons[0]).toContain("does not support");
  });

  it("UNSUPPORTED: novel entities present", () => {
    const d = decide(with_({ entities: { hard: ["10", "ms"], soft: [] } }));
    expect(d.verdict).toBe("UNSUPPORTED");
    expect(d.reasons[0]).toBe('Mentions "10", "ms", which the notes never state.');
  });

  it("CONTRADICTED: the entailment model says the notes contradict the claim", () => {
    const d = decide(with_({ nli: nli(0.01, 0.97) }));
    expect(d.verdict).toBe("CONTRADICTED");
    expect(d.reasons[0]).toBe("The notes say the opposite (contradiction 0.97).");
  });

  it("UNSUPPORTED: a quote that is not in the cited sentences", () => {
    const d = decide(with_({ quote: { ok: false, reason: "The quote is in S3.4, not in S3.2." } }));
    expect(d.verdict).toBe("UNSUPPORTED");
    expect(d.reasons).toEqual(["The quote is in S3.4, not in S3.2."]);
  });
});

describe("decide: threshold boundaries", () => {
  const verdictFor = (entailment: number, contradiction = 0) =>
    decide(with_({ nli: nli(entailment, contradiction) })).verdict;

  it("entailment exactly at the supported threshold is SUPPORTED, just below is PARTIAL", () => {
    expect(verdictFor(THRESHOLDS.entailmentSupported)).toBe("SUPPORTED");
    expect(verdictFor(THRESHOLDS.entailmentSupported - 0.0001)).toBe("PARTIAL");
  });

  it("entailment exactly at the partial threshold is PARTIAL, just below is UNSUPPORTED", () => {
    expect(verdictFor(THRESHOLDS.entailmentPartial)).toBe("PARTIAL");
    expect(verdictFor(THRESHOLDS.entailmentPartial - 0.0001)).toBe("UNSUPPORTED");
  });

  it("contradiction exactly at the threshold contradicts, just below does not", () => {
    expect(verdictFor(0.1, THRESHOLDS.contradiction)).toBe("CONTRADICTED");
    expect(verdictFor(0.9, THRESHOLDS.contradiction - 0.0001)).not.toBe("CONTRADICTED");
  });

  it("a high contradiction does not win if entailment is higher, but it still blocks SUPPORTED", () => {
    // e.g. one window of a long premise supports the claim and another contradicts it
    const d = decide(with_({ nli: nli(0.9, 0.6) }));
    expect(d.verdict).toBe("PARTIAL");
    expect(d.reasons[0]).toBe("Part of the cited text may contradict this (contradiction 0.60).");
  });

  it("unseen ordinary words only matter from the soft threshold up", () => {
    const soft = (n: number) =>
      decide(with_({ entities: { hard: [], soft: Array(n).fill("word") } }));
    expect(soft(THRESHOLDS.softNovelPartial - 1).verdict).toBe("SUPPORTED");
    expect(soft(THRESHOLDS.softNovelPartial).verdict).toBe("PARTIAL");
  });

  it("extra wording (over-generalisation) makes it PARTIAL", () => {
    const d = decide(with_({ overGeneral: ["always", "most"] }));
    expect(d.verdict).toBe("PARTIAL");
    expect(d.reasons[0]).toBe('Adds wording the cited text does not use: "always", "most".');
  });

  it("respects custom thresholds", () => {
    const strict = { ...THRESHOLDS, entailmentSupported: 0.99 };
    expect(decide(GOOD, strict).verdict).toBe("PARTIAL"); // 0.97 < 0.99
    const lax = { ...THRESHOLDS, entailmentPartial: 0.99, entailmentSupported: 0.995 };
    expect(decide(GOOD, lax).verdict).toBe("UNSUPPORTED");
  });
});

describe("decide: judge outcomes", () => {
  it("a judge pass changes nothing", () => {
    expect(decide(GOOD).verdict).toBe("SUPPORTED");
  });

  it("a judge fail never reaches SUPPORTED, whatever the entailment", () => {
    const fail: DecideInputs["judge"] = { status: "ok", outcome: "fail", unsupportedParts: [] };
    for (const e of [0.99, 0.85, 0.6]) {
      expect(decide(with_({ nli: nli(e), judge: fail })).verdict).toBe("PARTIAL");
    }
    expect(decide(with_({ nli: nli(0.2), judge: fail })).verdict).toBe("UNSUPPORTED");
  });

  it("a judge-only contradiction blocks the item (an extension to the lore) but is not CONTRADICTED", () => {
    const d = decide(
      with_({
        judge: { status: "ok", outcome: "contradiction", unsupportedParts: ["it is slow"] },
      }),
    );
    expect(d.verdict).toBe("UNSUPPORTED");
    expect(d.reasons[0]).toContain("the opposite");
    expect(d.reasons[0]).toContain("it is slow");
  });
});

describe("decide: a check that did not run caps the verdict at PARTIAL (invariant 1)", () => {
  it("entailment failed -> PARTIAL and degraded", () => {
    const d = decide(with_({ nli: { status: "failed", reason: "model not loaded" } }));
    expect(d).toMatchObject({ verdict: "PARTIAL", degraded: true });
    expect(d.reasons[0]).toBe(
      "Verifier degraded: the entailment check did not run (model not loaded).",
    );
  });

  it("judge failed -> PARTIAL and degraded", () => {
    const d = decide(with_({ judge: { status: "failed", reason: "provider: 503" } }));
    expect(d).toMatchObject({ verdict: "PARTIAL", degraded: true });
    expect(d.reasons[0]).toContain("the second review did not run");
  });

  it("both failed -> PARTIAL, two reasons", () => {
    const d = decide(
      with_({
        nli: { status: "failed", reason: "a" },
        judge: { status: "failed", reason: "b" },
      }),
    );
    expect(d).toMatchObject({ verdict: "PARTIAL", degraded: true });
    expect(d.reasons).toHaveLength(2);
  });

  it("a skipped check cannot yield SUPPORTED when nothing else settled the verdict", () => {
    expect(decide(with_({ nli: { status: "skipped" } })).verdict).toBe("PARTIAL");
    expect(decide(with_({ judge: { status: "skipped" } })).verdict).toBe("PARTIAL");
    expect(decide(with_({ judge: { status: "skipped" } })).degraded).toBe(false);
  });

  it("a skipped check is not mentioned when something already settled the verdict", () => {
    const d = decide(with_({ judge: { status: "skipped" }, entities: { hard: ["99"], soft: [] } }));
    expect(d.verdict).toBe("UNSUPPORTED");
    expect(d.reasons.join(" ")).not.toContain("did not run");
  });

  it("a failed check still lowers, never raises: UNSUPPORTED stays UNSUPPORTED", () => {
    const d = decide(
      with_({ quote: { ok: false, reason: "no" }, judge: { status: "failed", reason: "x" } }),
    );
    expect(d.verdict).toBe("UNSUPPORTED");
    expect(d.degraded).toBe(true);
  });
});

describe("decide: precedence and multiple findings", () => {
  it("CONTRADICTED outranks UNSUPPORTED and keeps the other reasons", () => {
    const d = decide(
      with_({
        nli: nli(0.01, 0.95),
        quote: { ok: false, reason: "bad quote" },
        entities: { hard: ["7"], soft: [] },
      }),
    );
    expect(d.verdict).toBe("CONTRADICTED");
    expect(d.reasons[0]).toContain("opposite");
    expect(d.reasons).toContain("bad quote");
    expect(d.reasons.join(" ")).toContain('"7"');
  });

  it("UNSUPPORTED outranks PARTIAL; blockers are listed before cautions", () => {
    const d = decide(
      with_({ nli: nli(0.7), entities: { hard: ["7"], soft: [] }, overGeneral: ["always"] }),
    );
    expect(d.verdict).toBe("UNSUPPORTED");
    expect(d.reasons[0]).toContain('"7"');
    expect(d.reasons.at(-1)).toContain("always");
  });
});

describe("decide: multiple-choice distractors", () => {
  it("options that could also be correct make the question UNSUPPORTED (two defensible answers)", () => {
    const d = decide(with_({ distractors: { ambiguous: ["Throughput"], novel: [] } }));
    expect(d.verdict).toBe("UNSUPPORTED");
    expect(d.reasons[0]).toContain('"Throughput"');
  });

  it("options that invent facts make the question PARTIAL", () => {
    const d = decide(with_({ distractors: { ambiguous: [], novel: ["It takes 50 ms"] } }));
    expect(d.verdict).toBe("PARTIAL");
  });
});

describe("decide: invariants over random inputs (seeded)", () => {
  let seed = 424242;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;

  const randomInputs = (): DecideInputs => ({
    quote: pick([
      { ok: true, reason: null },
      { ok: false, reason: "bad" },
    ]),
    nli: pick([
      nli(rnd(), rnd()),
      nli(rnd(), rnd() * 0.2),
      { status: "failed", reason: "x" },
      { status: "skipped" },
    ]),
    entities: { hard: rnd() < 0.2 ? ["9"] : [], soft: Array(Math.floor(rnd() * 5)).fill("w") },
    overGeneral: rnd() < 0.2 ? ["always"] : [],
    judge: pick([
      { status: "ok", outcome: "pass", unsupportedParts: [] } satisfies DecideInputs["judge"],
      { status: "ok", outcome: "fail", unsupportedParts: ["p"] } satisfies DecideInputs["judge"],
      {
        status: "ok",
        outcome: "contradiction",
        unsupportedParts: [],
      } satisfies DecideInputs["judge"],
      { status: "failed", reason: "y" },
      { status: "skipped" },
    ]),
    distractors: {
      ambiguous: rnd() < 0.1 ? ["a"] : [],
      novel: rnd() < 0.1 ? ["n"] : [],
    },
  });

  it("SUPPORTED happens only if every check ran and passed", () => {
    let supported = 0;
    for (let i = 0; i < 20000; i++) {
      const input = randomInputs();
      const d = decide(input);
      if (d.verdict !== "SUPPORTED") continue;
      supported++;
      expect(input.quote.ok).toBe(true);
      expect(input.nli.status).toBe("ok");
      if (input.nli.status === "ok") {
        expect(input.nli.entailment).toBeGreaterThanOrEqual(THRESHOLDS.entailmentSupported);
        expect(input.nli.contradiction).toBeLessThan(THRESHOLDS.contradiction);
      }
      expect(input.judge).toMatchObject({ status: "ok", outcome: "pass" });
      expect(input.entities.hard).toEqual([]);
      expect(input.entities.soft.length).toBeLessThan(THRESHOLDS.softNovelPartial);
      expect(input.overGeneral).toEqual([]);
      expect(input.distractors).toEqual({ ambiguous: [], novel: [] });
      expect(d.reasons).toEqual([]);
      expect(d.degraded).toBe(false);
    }
    expect(supported).toBeGreaterThan(0); // the property is not vacuous
  });

  it("every non-SUPPORTED verdict explains itself, and degraded implies a failed check", () => {
    for (let i = 0; i < 20000; i++) {
      const input = randomInputs();
      const d = decide(input);
      if (d.verdict !== "SUPPORTED") expect(d.reasons.length).toBeGreaterThan(0);
      if (d.degraded) {
        expect(input.nli.status === "failed" || input.judge.status === "failed").toBe(true);
      }
    }
  });

  it("a failed or skipped check never yields a verdict better than PARTIAL", () => {
    const rank = { SUPPORTED: 3, PARTIAL: 2, UNSUPPORTED: 1, CONTRADICTED: 0 } as const;
    for (let i = 0; i < 20000; i++) {
      const input = randomInputs();
      if (input.nli.status === "ok" && input.judge.status === "ok") continue;
      expect(rank[decide(input).verdict]).toBeLessThanOrEqual(rank.PARTIAL);
    }
  });
});
