import { describe, expect, it } from "vitest";
import type { QuestionDraft } from "@/core/generate";
import { selectQuestions } from "@/core/pipeline";
import type { Entry } from "@/core/pipeline/assemble";
import type { Verdict } from "@/core/schema";
import type { Verification } from "@/core/verify";

let counter = 0;
function entry(
  qtype: QuestionDraft["qtype"],
  verdict: Verdict = "SUPPORTED",
  answerIds: string[] = [`S${++counter}.1`],
): Entry {
  const n = counter + 1000;
  counter++;
  const draft: QuestionDraft = {
    itemId: `q-${n}`,
    type: "question",
    scope: "document",
    sourceIds: answerIds,
    evidenceQuote: "two words",
    text: `Question ${n}?`,
    idsExist: true,
    problems: [],
    qtype,
    question: `Question ${n}?`,
    answer: "A",
    answerStatement: "A.",
    answerSourceIds: answerIds,
  };
  const v = { itemId: draft.itemId, verdict } as Verification;
  return { original: draft, v1: v, final: { draft, v, repaired: false } };
}

const types = (es: Entry[]) => es.map((e) => (e.final.draft as QuestionDraft).qtype);
const ids = (es: Entry[]) => es.map((e) => e.original.itemId);

describe("selectQuestions", () => {
  it("picks exactly n when there are enough", () => {
    const pool = Array.from({ length: 9 }, () => entry("short"));
    const { picked, rest } = selectQuestions(pool, 5);
    expect(picked).toHaveLength(5);
    expect(rest).toHaveLength(4);
  });

  it("returns fewer rather than padding when the notes support fewer", () => {
    const pool = [entry("short"), entry("mcq")];
    const { picked, rest } = selectQuestions(pool, 5);
    expect(picked).toHaveLength(2);
    expect(rest).toEqual([]);
  });

  it("handles n = 0 and an empty pool", () => {
    expect(selectQuestions([entry("short")], 0).picked).toEqual([]);
    expect(selectQuestions([], 5)).toEqual({ picked: [], rest: [] });
  });

  it("spreads the question types when it can", () => {
    const pool = [
      entry("short"),
      entry("short"),
      entry("short"),
      entry("short"),
      entry("true_false"),
      entry("mcq"),
    ];
    const { picked } = selectQuestions(pool, 5);
    expect(new Set(types(picked))).toEqual(new Set(["short", "true_false", "mcq"]));
    expect(types(picked).filter((t) => t === "short")).toHaveLength(3);
  });

  it("uses what exists when only one type is available", () => {
    const pool = Array.from({ length: 6 }, () => entry("short"));
    expect(types(selectQuestions(pool, 5).picked)).toEqual(Array(5).fill("short"));
  });

  it("prefers SUPPORTED over PARTIAL and uses PARTIAL only to fill the gap", () => {
    const supported = [entry("short"), entry("mcq")];
    const partial = [entry("true_false", "PARTIAL"), entry("short", "PARTIAL")];
    const { picked, rest } = selectQuestions([...partial, ...supported], 3);
    expect(picked.filter((e) => e.final.v.verdict === "SUPPORTED")).toHaveLength(2);
    expect(picked.filter((e) => e.final.v.verdict === "PARTIAL")).toHaveLength(1);
    expect(rest).toHaveLength(1);
  });

  it("never lets a PARTIAL question displace a SUPPORTED one", () => {
    const pool = [
      ...Array.from({ length: 5 }, () => entry("short", "SUPPORTED")),
      entry("mcq", "PARTIAL"),
      entry("true_false", "PARTIAL"),
    ];
    const { picked } = selectQuestions(pool, 5);
    expect(picked.every((e) => e.final.v.verdict === "SUPPORTED")).toBe(true);
  });

  it("avoids asking twice about the same sentence when there is a choice", () => {
    const a = entry("short", "SUPPORTED", ["S1.3"]);
    const aAgain = entry("short", "SUPPORTED", ["S1.3"]);
    const b = entry("short", "SUPPORTED", ["S2.4"]);
    const { picked } = selectQuestions([a, aAgain, b], 2);
    expect(ids(picked)).toEqual(ids([a, b]));
  });

  it("returns the picked questions in the order they were drafted", () => {
    const pool = [entry("mcq"), entry("short"), entry("true_false"), entry("short")];
    const { picked } = selectQuestions(pool, 3);
    const order = ids(picked).map((id) => Number(id.slice(2)));
    expect(order).toEqual([...order].sort((x, y) => x - y));
  });

  it("is deterministic", () => {
    const pool = [entry("short"), entry("mcq"), entry("short"), entry("true_false"), entry("mcq")];
    expect(ids(selectQuestions(pool, 3).picked)).toEqual(
      ids(selectQuestions([...pool].reverse(), 3).picked),
    );
  });
});
