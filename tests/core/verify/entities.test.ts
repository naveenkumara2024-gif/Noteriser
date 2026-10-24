import { describe, expect, it } from "vitest";
import { buildVocab, findNovelEntities, findOverGeneral, OVERGENERAL_LEXICON } from "@/core/verify";
import { stem } from "@/core/verify/entities";
import { fixtureDoc } from "../../support/docs";

const vocabOf = (...texts: string[]) => buildVocab(texts.map((text) => ({ text })));

describe("findNovelEntities: hard (invented facts)", () => {
  const v = vocabOf(
    "The dispatch takes 10 ms and 3,500 jobs ran.",
    "The probability was 0.25 and the ratio 3.5.",
    "Round Robin (RR) gives each process a fixed time slice.",
    "CPU scheduling is the method an operating system uses to decide which process runs next.",
  );

  it.each([
    ["10 ms", "The delay is 20 ms.", ["20"]],
    ["a number that IS in the notes", "The delay is 10 ms.", []],
    ["thousands separators", "It ran 3500 jobs.", []],
    ["thousands separators (source 3,500)", "It ran 3,500 jobs.", []],
    ["a different thousands number", "It ran 4,500 jobs.", ["4,500"]],
    ["fractional numbers", "The ratio was 3.5.", []],
    ["a fractional number not in the notes", "The ratio was 3.6.", ["3.6"]],
    ["a year", "It was introduced in 1998.", ["1998"]],
    ["a percentage", "It handles 50% of loads.", ["50"]],
    ["a range", "It takes 5 to 7 ms.", ["5", "7"]],
  ])("%s", (_name, claim, hard) => {
    expect(findNovelEntities(claim, v).hard).toEqual(hard);
  });

  it("catches an invented formula, but not a repeated one", () => {
    expect(findNovelEntities("Sorting takes O(n log n) time.", v).hard).toContain("O(n log n)");
    const known = vocabOf("The cost is O(n log n) overall.");
    expect(findNovelEntities("Sorting takes O(n log n) time.", known).hard).toEqual([]);
  });

  it("does not report the letter inside a formula as a name", () => {
    expect(findNovelEntities("Sorting takes O(n log n) time.", v).hard).toEqual(["O(n log n)"]);
  });

  it("flags a proper noun that is not sentence-initial", () => {
    expect(findNovelEntities("Many systems such as Linux use it.", v).hard).toEqual(["Linux"]);
  });

  it("ignores sentence-initial capitals (it cannot tell names from ordinary starts)", () => {
    const e = findNovelEntities("Linux uses it.", v);
    expect(e.hard).toEqual([]);
    expect(e.soft).toContain("linux"); // but an unseen ordinary-looking word is a soft signal
  });

  it("accepts capitalised names that the notes use", () => {
    expect(findNovelEntities("Scheduling uses Round Robin here.", v).hard).toEqual([]);
  });

  it("flags an acronym the notes never use", () => {
    expect(findNovelEntities("It resembles FIFO queues.", v).hard).toEqual(["FIFO"]);
  });

  it("accepts an acronym the notes use, with or without a plural s", () => {
    expect(findNovelEntities("Each uses RR here.", v).hard).toEqual([]);
    const withCpu = vocabOf("The CPU is busy.");
    expect(findNovelEntities("Two CPUs are busy.", withCpu).hard).toEqual([]);
  });

  it("accepts an acronym whose expansion is in the notes (OS = operating system)", () => {
    expect(findNovelEntities("The OS picks the next process.", v).hard).toEqual([]);
    expect(
      findNovelEntities("The OS stops here.", vocabOf("Nothing relevant appears.")).hard,
    ).toEqual(["OS"]);
  });

  it("does not mistake the S of a two-letter acronym for a plural", () => {
    expect(findNovelEntities("The OS runs.", vocabOf("An operating system runs.")).hard).toEqual(
      [],
    );
  });

  it("ignores single letters", () => {
    expect(findNovelEntities("Then I go to a.", v).hard).toEqual([]);
  });
});

describe("findNovelEntities: soft (unseen ordinary words)", () => {
  const v = vocabOf(
    "SJF selects the process with the smallest next CPU burst.",
    "Scheduling is performed by the scheduler.",
  );

  it("matches inflected forms of words the notes use", () => {
    expect(findNovelEntities("The scheduler selected processes while scheduling.", v).soft).toEqual(
      [],
    );
    expect(findNovelEntities("Selecting is performed.", v).soft).toEqual([]);
  });

  it("reports unseen content words once, lowercased", () => {
    const e = findNovelEntities("The kernel chooses kernel threads quickly.", v);
    expect(e.soft).toEqual(["kernel", "chooses", "threads", "quickly"]);
  });

  it("never reports short words, stop words, or numbers as soft", () => {
    expect(findNovelEntities("It has been used with some other cases.", v).soft).toEqual([]);
  });

  it("works on the real fixture: a faithful paraphrase has few unseen words", async () => {
    const doc = await fixtureDoc();
    const vocab = buildVocab(doc.sentences);
    const e = findNovelEntities(
      "SJF minimises average waiting time but needs the next CPU burst length to be predicted.",
      vocab,
    );
    expect(e.hard).toEqual([]);
    expect(e.soft.length).toBeLessThan(3);
  });
});

describe("stem", () => {
  it.each([
    ["selects", "select"],
    ["selecting", "select"],
    ["selection", "select"],
    ["scheduling", "schedu"],
    ["schedules", "schedu"],
    ["scheduler", "schedu"],
    ["cat", "cat"],
  ])("%s -> %s", (word, expected) => {
    expect(stem(word)).toBe(expected);
  });
});

describe("findOverGeneral", () => {
  it.each(OVERGENERAL_LEXICON.map((w) => [w]))(
    "flags '%s' only when the source lacks it",
    (word) => {
      const claim = `The scheduler is ${word} fair.`;
      expect(findOverGeneral(claim, "The scheduler is fair.")).toEqual([word]);
      expect(findOverGeneral(claim, `The scheduler is ${word} fair.`)).toEqual([]);
    },
  );

  it("matches whole words only", () => {
    expect(findOverGeneral("The ball allowed small bests.", "Nothing.")).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(findOverGeneral("ALWAYS runs.", "It runs.")).toEqual(["always"]);
  });

  it("reports the longest of overlapping phrases once", () => {
    expect(findOverGeneral("It is most commonly used.", "It is used.")).toEqual(
      ["commonly", "most commonly"].filter((w) => w === "most commonly"),
    );
  });

  it("reports several at once, in lexicon order", () => {
    expect(
      findOverGeneral(
        "RR is the best and is always fair, usually.",
        "RR gives each process a slice.",
      ),
    ).toEqual(["always", "best", "usually"]);
  });

  it("does not flag the lore's real examples that the source supports", () => {
    expect(
      findOverGeneral(
        "SJF gives the minimum average waiting time for a given set of processes.",
        "SJF gives the minimum average waiting time for a given set of processes, but the length of the next burst must be predicted.",
      ),
    ).toEqual([]);
  });
});
