import { beforeAll, describe, expect, it } from "vitest";
import type { SourceSentence } from "@/core/schema";
import { quoteExists, unwrapQuotes } from "@/core/verify";
import { fixtureDoc } from "../../support/docs";

let sentences: SourceSentence[];
beforeAll(async () => {
  sentences = (await fixtureDoc()).sentences;
});

const check = (quote: string, ids: string[]) => quoteExists(quote, sentences, ids);

describe("quoteExists", () => {
  it("accepts an exact quote from a cited sentence", () => {
    expect(check("The component that hands the CPU to the chosen process", ["S1.3"])).toEqual({
      ok: true,
      missingIds: [],
      reason: null,
    });
  });

  it("ignores case, spacing, and curly punctuation differences", () => {
    expect(check("  the  COMPONENT that hands the cpu to the chosen process ", ["S1.3"]).ok).toBe(
      true,
    );
    expect(check("FCFS is non‑preemptive and can cause the convoy effect", ["S3.2"]).ok).toBe(true);
  });

  it("accepts a quote wrapped in one pair of quote marks (both styles)", () => {
    expect(check('"Its goal is to keep the CPU busy"', ["S1.2"]).ok).toBe(true);
    expect(check("“Its goal is to keep the CPU busy”", ["S1.2"]).ok).toBe(true);
    expect(check("'Its goal is to keep the CPU busy'", ["S1.2"]).ok).toBe(true);
  });

  it("keeps quote marks that belong to the source (plain form is tried first)", () => {
    const quoted: SourceSentence[] = [
      { id: "S1.1", section: 1, sectionTitle: "T", text: '"Stop," he said.', position: 0 },
    ];
    expect(quoteExists('"Stop," he said.', quoted, ["S1.1"]).ok).toBe(true);
    expect(quoteExists('"Stop," he', quoted, ["S1.1"]).ok).toBe(true);
    // Without the source's own quote marks it is a different string, correctly not a match.
    expect(quoteExists("Stop, he said", quoted, ["S1.1"]).ok).toBe(false);
    expect(quoteExists('"Stop,"', quoted, ["S1.1"]).ok).toBe(false); // one word is too short
  });

  it("lets a quote run across two adjacent cited sentences", () => {
    const q = "schedules processes in the order they arrive. FCFS is non-preemptive";
    expect(check(q, ["S3.1", "S3.2"]).ok).toBe(true);
    expect(check(q, ["S3.2", "S3.1"]).ok).toBe(true); // order of ids does not matter
  });

  it("rejects a quote stitched across a gap between cited sentences", () => {
    const spliced =
      "The component that hands the CPU to the chosen process is called the dispatch latency";
    const r = check(spliced, ["S1.3", "S1.4"]);
    // S1.3 and S1.4 are neighbours, so this contiguous passage is real only if it matches exactly:
    expect(r.ok).toBe(false);

    const gap =
      "keep the CPU busy and to give users acceptable response times. The time the dispatcher takes";
    expect(check(gap, ["S1.2", "S1.4"]).ok).toBe(false); // S1.3 sits between them
  });

  it("does not let a quote cross a section boundary even for neighbouring sentences", () => {
    const r = check("is called dispatch latency. CPU utilization is the percentage", [
      "S1.4",
      "S2.1",
    ]);
    expect(r.ok).toBe(false);
  });

  it("rejects a quote that mixes fragments with a semicolon (a real model failure)", () => {
    const r = check(
      "schedules processes in the order they arrive; non-preemptive and can cause the convoy effect",
      ["S3.1", "S3.2"],
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("does not appear, word for word");
  });

  it("names the sentence that does contain the quote when the wrong one is cited", () => {
    const r = check("the minimum average waiting time for a given set of processes", ["S3.2"]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("The quote is in S3.4, not in the cited sentence(s) S3.2.");
  });

  it("reports ids that are not in the notes", () => {
    const one = check("anything", ["S9.9"]);
    expect(one).toMatchObject({ ok: false, missingIds: ["S9.9"] });
    expect(one.reason).toBe("Cites S9.9, which is not in the notes.");

    const two = check("anything", ["S1.1", "S8.1", "S9.9"]);
    expect(two.missingIds).toEqual(["S8.1", "S9.9"]);
    expect(two.reason).toBe("Cites S8.1, S9.9, which are not in the notes.");
  });

  it("requires at least one cited id and a non-empty quote", () => {
    expect(check("CPU", []).reason).toBe("No source sentence is cited.");
    expect(check("   ", ["S1.1"]).reason).toBe("No evidence quote was given.");
    expect(check('""', ["S1.1"]).reason).toBe("No evidence quote was given.");
  });

  it("does not accept a quote too short to be evidence", () => {
    for (const q of [".", "the", "CPU", '"busy"', "!!!", "-"]) {
      const r = check(q, ["S1.2"]);
      expect(r.ok, q).toBe(false);
      expect(r.reason, q).toMatch(/No evidence quote was given|too short to be evidence/);
    }
    expect(check("busy and", ["S1.2"]).ok).toBe(true); // two words is the minimum
    expect(check("10 ms", [] as string[]).ok).toBe(false);
  });

  it("deduplicates repeated ids", () => {
    expect(check("hands the CPU to the chosen process", ["S1.3", "S1.3"]).ok).toBe(true);
  });
});

describe("unwrapQuotes", () => {
  it.each([
    ['"abc"', "abc"],
    ["'abc'", "abc"],
    ["“abc”", "abc"],
    ["‘abc’", "abc"],
    ["«abc»", "abc"],
    ['  "abc"  ', "abc"],
    ['""abc""', '"abc"'], // only ONE pair
    ['"abc', '"abc'],
    ['abc"', 'abc"'],
    ["abc", "abc"],
    ['"', '"'],
  ])("%j -> %j", (input, expected) => {
    expect(unwrapQuotes(input)).toBe(expected);
  });
});
