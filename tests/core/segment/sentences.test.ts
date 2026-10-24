import { describe, expect, it } from "vitest";
import { splitSentences } from "@/core/segment";

describe("splitSentences", () => {
  it.each([
    [
      "e.g. before a capital stays joined",
      "Use e.g. A queue is fine. Then stop.",
      ["Use e.g. A queue is fine.", "Then stop."],
    ],
    [
      "titles stay joined",
      "Dr. Smith said it. Prof. Jones agreed.",
      ["Dr. Smith said it.", "Prof. Jones agreed."],
    ],
    ["figure references", "See Fig. 3 for details. Next.", ["See Fig. 3 for details.", "Next."]],
    [
      "decimals and versions",
      "The latency was 3.5 ms. It then rose to v2.0 later.",
      ["The latency was 3.5 ms.", "It then rose to v2.0 later."],
    ],
    [
      "units that look like titles still end sentences (ms, sec)",
      "It waited 40 ms. Then it ran for 5 sec. Next came I/O.",
      ["It waited 40 ms.", "Then it ran for 5 sec.", "Next came I/O."],
    ],
    [
      "initials chain, but not 'Vitamin C.'",
      "J. R. Smith wrote it. Vitamin C. The body needs it.",
      ["J. R. Smith wrote it.", "Vitamin C.", "The body needs it."],
    ],
    [
      "et al. and etc. may end a sentence",
      "Smith et al. showed this. Another point etc. The end.",
      ["Smith et al. showed this.", "Another point etc.", "The end."],
    ],
    [
      "quotes and parentheses",
      'He said "stop." Then he left. (See above.) Next one.',
      ['He said "stop."', "Then he left.", "(See above.)", "Next one."],
    ],
    [
      "ellipsis and mixed terminators",
      "Wait... what? Yes! Fine.",
      ["Wait... what?", "Yes!", "Fine."],
    ],
    [
      "currency and accents",
      "Café costs €3.50 today. Ça va.",
      ["Café costs €3.50 today.", "Ça va."],
    ],
    [
      "a semicolon does not split (lore S3.6)",
      "If the time quantum is very large, RR behaves like FCFS; if it is very small, context-switch overhead increases.",
      [
        "If the time quantum is very large, RR behaves like FCFS; if it is very small, context-switch overhead increases.",
      ],
    ],
    ["internal whitespace is collapsed", "One   sentence here.", ["One sentence here."]],
  ])("%s", (_name, input, expected) => {
    expect(splitSentences(input)).toEqual(expected);
  });

  it("returns nothing for empty or punctuation-only input", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   ")).toEqual([]);
    expect(splitSentences("...")).toEqual([]);
    expect(splitSentences(". . .")).toEqual([]);
  });

  it("keeps a trailing abbreviation fragment rather than losing text", () => {
    expect(splitSentences("Ask Dr.")).toEqual(["Ask Dr."]);
  });
});
