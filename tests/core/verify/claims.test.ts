import { describe, expect, it } from "vitest";
import type { GlossaryDraft, QuestionDraft, SummaryDraft } from "@/core/generate";
import { claimOf } from "@/core/verify";
import { lowerFirst } from "@/core/verify/claims";

const base = {
  itemId: "x-1",
  scope: "s",
  evidenceQuote: "two words",
  idsExist: true,
  problems: [],
};

describe("claimOf", () => {
  it("summary point: its text and sources", () => {
    const item: SummaryDraft = {
      ...base,
      type: "summary_point",
      sourceIds: ["S1.1"],
      text: "A point.",
    };
    expect(claimOf(item)).toEqual({ text: "A point.", citedIds: ["S1.1"] });
  });

  it("glossary: '<term> is <definition>' so it is a proposition", () => {
    const item: GlossaryDraft = {
      ...base,
      type: "glossary",
      sourceIds: ["S1.3"],
      term: "Dispatcher",
      text: "The component that hands the CPU to the chosen process.",
    };
    expect(claimOf(item)).toEqual({
      text: "Dispatcher is the component that hands the CPU to the chosen process.",
      citedIds: ["S1.3"],
    });
  });

  const question = (over: Partial<QuestionDraft>): QuestionDraft => ({
    ...base,
    type: "question",
    sourceIds: ["S3.5", "S3.6"],
    text: "Q?",
    qtype: "short",
    question: "Q?",
    answer: "A",
    answerStatement: "The fact.",
    answerSourceIds: ["S3.6"],
    ...over,
  });

  it("question: the answer statement, supported by the answer's sentences", () => {
    expect(claimOf(question({}))).toEqual({ text: "The fact.", citedIds: ["S3.6"] });
  });

  it("question: falls back to the evidence sentences when no answer sources are given", () => {
    expect(claimOf(question({ answerSourceIds: [] })).citedIds).toEqual(["S3.5", "S3.6"]);
  });
});

describe("lowerFirst", () => {
  it.each([
    ["The component", "the component"],
    ["Forcibly taking", "forcibly taking"],
    ["Time from submission", "time from submission"],
    ["RR behaves like FCFS", "RR behaves like FCFS"],
    ["CPU time", "CPU time"],
    ["iPhone style", "iPhone style"],
    ["a lowercase start", "a lowercase start"],
    ["I", "I"],
    ["", ""],
    ["3 processes", "3 processes"],
  ])("%j -> %j", (input, expected) => {
    expect(lowerFirst(input)).toBe(expected);
  });
});
