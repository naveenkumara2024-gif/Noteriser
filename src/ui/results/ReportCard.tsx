import type { RunReport } from "@/core/schema/report";
import { copy } from "../copy";

const usd = (n: number): string => `$${n.toFixed(4)}`;

/** Lore §6.6, with the reconciliation (invariant 3) stated in words. */
export function ReportCard({ report }: { report: RunReport }) {
  const t = report.byType;
  const rows: [string, string][] = [
    ["Source sentences", String(report.sourceSentences)],
    ["Sections", String(report.sections)],
    [
      "Items generated",
      `${report.generated} (${t.summary_point.generated} summary, ${t.glossary.generated} glossary, ${t.question.generated} questions)`,
    ],
    ["Accepted (supported)", String(report.supported)],
    ["Partial (flagged)", String(report.partial)],
    [
      "Removed",
      `${report.removed}${report.surplus > 0 ? ` (${report.surplus} valid but not needed)` : ""}`,
    ],
    ["Summary coverage", `${Math.round(report.coveragePercent)}% of sections`],
    ["Repairs", `${report.repairsSucceeded} of ${report.repairsAttempted} improved an item`],
  ];
  if (report.unreviewed > 0) rows.splice(5, 0, ["Not yet checked", String(report.unreviewed)]);
  if (report.usage.costUsd > 0) {
    rows.push([
      "Model use",
      `${report.usage.inputTokens} tokens in, ${report.usage.outputTokens} out, ${usd(report.usage.costUsd)}`,
    ]);
  }

  return (
    <section aria-labelledby="report-heading" className="rounded-lg border border-line p-4">
      <h2 id="report-heading" className="text-xl font-semibold">
        {copy.report.heading}
      </h2>
      <dl className="mt-3 grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-6 gap-y-1">
        {rows.map(([name, value]) => (
          <div key={name} className="contents">
            <dt className="text-muted">{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 font-medium">
        {report.reconciles ? copy.report.reconciles(report.generated) : copy.report.mismatch}
      </p>
    </section>
  );
}
