/**
 * CI-safe regression check: no network, no keys.
 *
 *   npm run eval:ci                       compare with eval/baseline.fake.json, fail on any regression
 *   npm run eval:ci -- --update-baseline  rewrite the baseline (a deliberate act: read the diff)
 *
 * Runs every case and every regression case through the real verifier with the neutral "fake" judge
 * (so it measures the quote check, the entailment model, the novel-fact scan and the wording
 * check), then compares each draft with the recorded baseline. A draft is a regression if it was
 * handled correctly in the baseline and is not now: a bad draft newly passed as SUPPORTED, or a
 * good draft newly not SUPPORTED. Every draft in eval/regressions must be handled correctly, always.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { HfNli } from "../src/nlp/nli";
import { checkCases, loadCases, loadRegressions } from "./lib/cases";
import { computeMetrics, fmtRate } from "./lib/metrics";
import { offlineJudge, verifyCases } from "./lib/runner";

const BASELINE = "eval/baseline.fake.json";
const { values } = parseArgs({
  options: { "update-baseline": { type: "boolean" }, splits: { type: "string" } },
  strict: false,
});

const all = loadCases();
const regressions = loadRegressions();

const problems = [
  ...(await checkCases(all, { requireSplitRule: true })),
  ...(await checkCases(regressions, { rules: null })),
];
if (problems.length > 0) {
  console.error(`The case files are invalid:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}

// `--splits dev` exists so the script itself can be developed without touching the test split.
const splits = values.splits ? new Set(String(values.splits).split(",")) : undefined;
const cases = [...all.filter((c) => !splits || splits.has(c.split)), ...regressions];

const nli = await HfNli.load();
const results = await verifyCases({ cases, nli, llm: offlineJudge("fake"), concurrency: 2 });

const correct = (r: (typeof results)[number]): boolean =>
  r.label === "good" ? r.verdict === "SUPPORTED" : r.verdict !== "SUPPORTED";
const now = Object.fromEntries(
  results.map((r) => [r.id, { verdict: r.verdict, correct: correct(r) }]),
);

const m = computeMetrics(results.filter((r) => r.split !== "regression"));
console.log(
  `Fake-judge run over ${results.length} drafts (${regressions.length} regression cases)`,
);
console.log(`  recall ${fmtRate(m.recall)}   over-flag ${fmtRate(m.overFlag)}`);

if (values["update-baseline"]) {
  writeFileSync(BASELINE, `${JSON.stringify(now, null, 2)}\n`);
  console.log(`Wrote ${BASELINE}. Review the diff before committing it.`);
  process.exit(0);
}

const failures: string[] = [];
for (const r of results.filter((x) => x.split === "regression" && !correct(x))) {
  failures.push(`regression ${r.id} is wrong again: ${r.label} draft got ${r.verdict}`);
}

if (!existsSync(BASELINE)) {
  console.error(`No ${BASELINE}. Create it with \`npm run eval:ci -- --update-baseline\`.`);
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<
  string,
  { verdict: string; correct: boolean }
>;
let unknown = 0;
for (const r of results) {
  const before = baseline[r.id];
  if (!before) {
    unknown++;
    continue;
  }
  if (before.correct && !correct(r)) {
    failures.push(
      `${r.id} regressed: ${before.verdict} -> ${r.verdict} (${r.label} draft: ${r.text.slice(0, 60)})`,
    );
  }
}
const improved = results.filter(
  (r) => baseline[r.id] && !baseline[r.id]?.correct && correct(r),
).length;
if (unknown > 0)
  console.log(
    `Note: ${unknown} drafts are not in the baseline; refresh it with --update-baseline.`,
  );
if (improved > 0) console.log(`Note: ${improved} drafts improved since the baseline.`);

if (failures.length > 0) {
  console.error(`\n${failures.length} regression(s):\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log("No regressions.");
