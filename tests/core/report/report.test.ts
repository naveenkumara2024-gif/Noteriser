import { describe, expect, it } from "vitest";
import { coveredSections, formatReport, makeReport } from "@/core/report";
import { runWith } from "../../support/pipeline";

async function inputs() {
  const { result } = await runWith();
  const shown = [...result.summary, ...result.glossary, ...result.questions];
  if (!result.doc) throw new Error("no doc");
  return {
    result,
    base: {
      doc: result.doc,
      generated: 24,
      shown,
      removed: result.removed,
      unreviewed: [],
      usage: result.report.usage,
      repairsAttempted: 3,
      repairsSucceeded: 0,
    },
  };
}

describe("makeReport", () => {
  it("counts each bucket and reconciles against the independent generated count", async () => {
    const { base } = await inputs();
    const r = makeReport(base);
    expect(r).toMatchObject({
      generated: 24,
      supported: 18,
      partial: 1,
      removed: 5,
      unreviewed: 0,
    });
    expect(r.reconciles).toBe(true);
  });

  it("flags an item that is unaccounted for", async () => {
    const { base } = await inputs();
    expect(makeReport({ ...base, generated: 25 }).reconciles).toBe(false);
    expect(makeReport({ ...base, generated: 23 }).reconciles).toBe(false);
  });

  it("counts items not yet judged, so an interrupted run still reconciles", async () => {
    const { base, result } = await inputs();
    const draft = {
      itemId: "sum-99",
      type: "summary_point" as const,
      scope: "section:1",
      sourceIds: ["S1.1"],
      evidenceQuote: "two words",
      text: "Unjudged.",
      idsExist: true,
      problems: [],
    };
    const r = makeReport({ ...base, generated: 25, unreviewed: [draft] });
    expect(r.unreviewed).toBe(1);
    expect(r.byType.summary_point.unreviewed).toBe(1);
    expect(r.reconciles).toBe(true);
    expect(result.report.unreviewed).toBe(0);
  });

  it("breaks the counts down by kind and they add up to the totals", async () => {
    const { base } = await inputs();
    const t = makeReport(base).byType;
    const sum = (k: "generated" | "supported" | "partial" | "removed") =>
      t.summary_point[k] + t.glossary[k] + t.question[k];
    expect(sum("generated")).toBe(24);
    expect(sum("supported")).toBe(18);
    expect(sum("partial")).toBe(1);
    expect(sum("removed")).toBe(5);
  });

  it("separates valid-but-unneeded removals (duplicates, surplus) from failures", async () => {
    const { base } = await inputs();
    expect(makeReport(base).surplus).toBe(2);
  });

  it("measures how many sections have a shown summary point", async () => {
    const { base } = await inputs();
    expect(makeReport(base).coveragePercent).toBe(100);
    const none = base.shown.filter((s) => s.envelope.type !== "summary_point");
    expect(makeReport({ ...base, shown: none, generated: 18 + 0 }).coveragePercent).toBe(0);
    const onlySec1 = base.shown.filter(
      (s) =>
        s.envelope.type !== "summary_point" ||
        s.envelope.sourceIds.every((id) => id.startsWith("S1.")),
    );
    expect(makeReport({ ...base, shown: onlySec1 }).coveragePercent).toBeCloseTo(33.3, 1);
  });

  it("copes with a run that never produced a document", () => {
    const r = makeReport({
      doc: undefined,
      generated: 0,
      shown: [],
      removed: [],
      unreviewed: [],
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      repairsAttempted: 0,
      repairsSucceeded: 0,
    });
    expect(r).toMatchObject({
      sourceSentences: 0,
      sections: 0,
      coveragePercent: 0,
      reconciles: true,
    });
  });
});

describe("coveredSections", () => {
  it("is the set of sections that shown summary points cite", async () => {
    const { result } = await inputs();
    if (!result.doc) throw new Error("no doc");
    expect(coveredSections(result.doc, result.summary)).toEqual(new Set([1, 2, 3]));
    expect(coveredSections(result.doc, [])).toEqual(new Set());
  });
});

describe("formatReport", () => {
  it("prints the lore §6.6 shape", async () => {
    const { result } = await inputs();
    const text = formatReport(result.report);
    expect(text).toContain("Source sentences: 15   Sections: 3");
    expect(text).toContain("Items generated: 24 (8 summary, 8 glossary, 8 questions)");
    expect(text).toContain("Accepted (SUPPORTED): 18   Partial (flagged): 1   Removed: 5");
    expect(text).toContain("Counts reconcile");
    expect(text).not.toContain("WARNING");
  });

  it("shouts when the counts do not add up", async () => {
    const { base } = await inputs();
    expect(formatReport(makeReport({ ...base, generated: 99 }))).toContain("WARNING");
  });

  it("mentions items that were not reviewed", async () => {
    const { result } = await inputs();
    const text = formatReport({ ...result.report, unreviewed: 4 });
    expect(text).toContain("Not reviewed: 4");
  });
});
