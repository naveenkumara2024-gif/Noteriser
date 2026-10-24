import { describe, expect, it } from "vitest";
import { normalizeForMatch } from "@/core/text";

describe("normalizeForMatch", () => {
  it.each([
    ["curly quotes and em dash", "“Waiting time” — it’s total", '"waiting time" - it\'s total'],
    ["whitespace and case", "  Waiting\n\ttime   IS  total ", "waiting time is total"],
    ["NFKC ligatures and width", "ﬁle ＡB", "file ab"],
    ["zero-width and soft hyphen", "wait​ing­ time", "waiting time"],
    ["bullet markers", "- CPU utilization", "cpu utilization"],
    ["numbered markers", "3. CPU utilization", "cpu utilization"],
    ["emphasis and code", "**Waiting** `time` is _total_", "waiting time is total"],
    ["snake_case is preserved", "the ready_queue holds it", "the ready_queue holds it"],
    ["en dash and minus", "5 – 3 − 1", "5 - 3 - 1"],
    ["stacked markers", "- - nested", "nested"],
  ])("%s", (_name, input, expected) => {
    expect(normalizeForMatch(input)).toBe(expected);
  });

  it("makes a model's quote comparable with source text", () => {
    const source = 'It\'s the "ready queue" that holds   waiting processes.';
    const quote = "It’s the “ready queue” that holds waiting processes.";
    expect(normalizeForMatch(source)).toBe(normalizeForMatch(quote));
  });

  it("keeps wrapping quote marks (callers unwrap a model's outer quotes before matching)", () => {
    expect(normalizeForMatch("“ready queue”")).toBe('"ready queue"');
  });

  it("does not conflate different words", () => {
    expect(normalizeForMatch("minimum")).not.toBe(normalizeForMatch("maximum"));
    expect(normalizeForMatch("can cause")).not.toBe(normalizeForMatch("cannot cause"));
  });

  it("is idempotent on seeded random input", () => {
    const pieces = [
      "a",
      "B",
      " ",
      "\n",
      "\t",
      "-",
      "*",
      "_",
      "`",
      "~",
      "~~",
      "“",
      "”",
      "—",
      "1",
      "1.",
      ".",
      "​",
      "ﬁ",
      "İ",
      "- ",
      "1. ",
      "**",
      "__",
      " ",
    ];
    let seed = 20261024;
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 3000; i++) {
      const len = Math.floor(next() * 30);
      let s = "";
      for (let j = 0; j < len; j++) s += pieces[Math.floor(next() * pieces.length)];
      const once = normalizeForMatch(s);
      expect(normalizeForMatch(once), JSON.stringify(s)).toBe(once);
    }
  });
});
