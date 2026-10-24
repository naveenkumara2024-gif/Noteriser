import type { DraftItem } from "../generate/types";
import type { RemovedItem, ShownItem } from "../pipeline/types";
import type { Usage } from "../ports/llm";
import type { OutcomeCounts, RunReport } from "../schema/report";
import type { SourceDoc } from "../schema/source";

const emptyCounts = (): OutcomeCounts => ({
  generated: 0,
  supported: 0,
  partial: 0,
  removed: 0,
  unreviewed: 0,
});

export interface ReportInput {
  doc: SourceDoc | undefined;
  /**
   * How many drafts the generators produced, counted when they were produced and independently of
   * where they ended up. The report checks that every one of them is accounted for below.
   */
  generated: number;
  shown: readonly ShownItem[];
  removed: readonly RemovedItem[];
  /** Generated but not yet judged (an interrupted run). */
  unreviewed: readonly DraftItem[];
  usage: Usage;
  repairsAttempted: number;
  repairsSucceeded: number;
}

/** Section numbers that have at least one of the given summary points citing one of their sentences. */
export function coveredSections(doc: SourceDoc, summary: readonly ShownItem[]): Set<number> {
  const sectionOf = new Map(doc.sentences.map((s) => [s.id, s.section]));
  const covered = new Set<number>();
  for (const item of summary) {
    for (const id of item.envelope.sourceIds) {
      const section = sectionOf.get(id);
      if (section !== undefined) covered.add(section);
    }
  }
  return covered;
}

/** Lore §6.6, plus per-type counts and cost. */
export function makeReport(input: ReportInput): RunReport {
  const byType = {
    summary_point: emptyCounts(),
    glossary: emptyCounts(),
    question: emptyCounts(),
  };
  let supported = 0;
  let partial = 0;

  for (const s of input.shown) {
    const c = byType[s.envelope.type];
    if (s.envelope.verdict === "SUPPORTED") {
      supported++;
      c.supported++;
    } else {
      partial++;
      c.partial++;
    }
  }
  for (const r of input.removed) byType[r.envelope.type].removed++;
  for (const d of input.unreviewed) byType[d.type].unreviewed++;
  for (const c of Object.values(byType)) {
    c.generated = c.supported + c.partial + c.removed + c.unreviewed;
  }

  const removed = input.removed.length;
  const unreviewed = input.unreviewed.length;
  const accounted = supported + partial + removed + unreviewed;
  const sections = input.doc?.sections.length ?? 0;
  const summaryShown = input.shown.filter((s) => s.envelope.type === "summary_point");
  const covered = input.doc ? coveredSections(input.doc, summaryShown).size : 0;

  return {
    sourceSentences: input.doc?.sentences.length ?? 0,
    sections,
    generated: input.generated,
    supported,
    partial,
    removed,
    unreviewed,
    surplus: input.removed.filter((r) => r.kind === "duplicate" || r.kind === "surplus").length,
    byType,
    coveragePercent: sections === 0 ? 0 : Math.round((covered / sections) * 1000) / 10,
    repairsAttempted: input.repairsAttempted,
    repairsSucceeded: input.repairsSucceeded,
    usage: input.usage,
    reconciles: input.generated === accounted,
  };
}

/** The run report as plain text, in the shape of lore §6.6. */
export function formatReport(r: RunReport): string {
  const t = r.byType;
  const lines = [
    `Source sentences: ${r.sourceSentences}   Sections: ${r.sections}`,
    `Items generated: ${r.generated} (${t.summary_point.generated} summary, ${t.glossary.generated} glossary, ${t.question.generated} questions)`,
    `Accepted (SUPPORTED): ${r.supported}   Partial (flagged): ${r.partial}   Removed: ${r.removed}` +
      (r.unreviewed > 0 ? `   Not reviewed: ${r.unreviewed}` : ""),
    `Shown items: ${r.supported + r.partial}, each with a quote checked against its cited sentences`,
    `Summary coverage: ${r.coveragePercent}% of sections   Repairs: ${r.repairsSucceeded}/${r.repairsAttempted} improved an item`,
    `Tokens: in=${r.usage.inputTokens} out=${r.usage.outputTokens}   Cost: $${r.usage.costUsd.toFixed(4)}`,
    r.reconciles
      ? "Counts reconcile: every generated item is shown or listed as removed"
      : "WARNING: counts do not reconcile; an item is unaccounted for",
  ];
  return lines.join("\n");
}
