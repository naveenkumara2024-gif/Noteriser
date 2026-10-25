/**
 * Human-review metrics from the filled review sheet (eval/review-sheet.csv).
 *
 *   npm run eval:kappa
 *
 * Two reviewers fill `reviewer1` and `reviewer2` with supported, unsupported or unclear for every
 * row. This prints Cohen's kappa and the lore's faithfulness, unsupported-slip and question-quality
 * metrics against their targets, and writes eval/results/human-review.json.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pct } from "./lib/metrics";
import { humanMetrics, sheetFromCsv } from "./lib/sheet";

const { values } = parseArgs({
  options: { sheet: { type: "string", default: "eval/review-sheet.csv" } },
  strict: false,
});
const path = String(values.sheet);
if (!existsSync(path)) {
  console.error(`No review sheet at ${path}. Run \`npm run eval:e2e\` first.`);
  process.exit(2);
}

const m = humanMetrics(sheetFromCsv(readFileSync(path, "utf8")));
if (m.labelled === 0) {
  console.error(
    `The sheet has ${m.rows} rows but no row has both reviewer1 and reviewer2 filled in, so there is nothing to measure yet.`,
  );
  process.exit(2);
}

const f = (x: number | null): string => (x === null || Number.isNaN(x) ? "n/a" : pct(x));
const flag = (x: number | null, ok: (v: number) => boolean): string =>
  x === null || Number.isNaN(x) ? "" : ok(x) ? "  (meets target)" : "  (MISSES target)";

console.log(
  `Rows: ${m.rows}   labelled by both reviewers: ${m.labelled}   contested: ${m.contested}`,
);
console.log(
  `Cohen's kappa: ${Number.isNaN(m.kappa.kappa) ? "n/a" : m.kappa.kappa.toFixed(2)}  (observed agreement ${f(m.kappa.observed)}, expected by chance ${f(m.kappa.expected)})`,
);
console.log(
  `Faithfulness:        ${f(m.faithfulness)}  target >= 95%${flag(m.faithfulness, (v) => v >= 0.95)}`,
);
console.log(
  `Unsupported slip:    ${f(m.unsupportedSlip)}  target <= 2%${flag(m.unsupportedSlip, (v) => v <= 0.02)}`,
);
console.log(
  `Question quality:    ${f(m.questionQuality)}  target >= 90%${flag(m.questionQuality, (v) => v >= 0.9)}`,
);
console.log(
  `Verifier's SUPPORTED items that both reviewers agree with: ${f(m.verifierSupportedAgreement)}`,
);

writeFileSync("eval/results/human-review.json", `${JSON.stringify(m, null, 2)}\n`);
