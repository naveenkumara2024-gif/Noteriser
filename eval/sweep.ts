/**
 * Threshold sweep on the DEV split only.
 *
 *   npm run eval:sweep -- --in eval/results/dev-live.json
 *
 * Re-decides every dev draft from the stored check results over a grid, picks the point with the
 * highest recall subject to over-flag <= 15%, and writes eval/thresholds.recommended.json. It never
 * changes src/core/verify/thresholds.ts: the diff is printed for a person to decide on.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { THRESHOLDS } from "../src/core/verify";
import { type DraftResult, fmtRate, pct } from "./lib/metrics";
import { diffThresholds, runSweep } from "./lib/sweep";

const { values } = parseArgs({
  options: {
    in: { type: "string", default: "eval/results/dev-live.json" },
    max: { type: "string", default: "0.15" },
  },
  strict: false,
});

const file = JSON.parse(readFileSync(String(values.in), "utf8")) as {
  meta: { split: string; judge: string; judgeLabel: string; thresholds: typeof THRESHOLDS };
  results: DraftResult[];
};
if (file.meta.split !== "dev") {
  console.error(`The sweep only reads the dev split; this file is "${file.meta.split}".`);
  process.exit(2);
}
if (file.results.some((r) => r.split !== "dev")) {
  console.error("This file contains drafts that are not from the dev split.");
  process.exit(2);
}

const sweep = runSweep(file.results, {
  maxOverFlag: Number(values.max),
  current: file.meta.thresholds,
});
const line = (name: string, c: { metrics: ReturnType<typeof runSweep>["current"]["metrics"] }) =>
  `${name.padEnd(12)} recall ${fmtRate(c.metrics.recall)}   over-flag ${fmtRate(c.metrics.overFlag)}   balanced ${pct(c.metrics.balancedAccuracy)}`;

console.log(`Judge: ${file.meta.judgeLabel}`);
console.log(
  `Grid: ${sweep.gridSize} points; ${sweep.feasible} meet over-flag <= ${pct(sweep.maxOverFlag, 0)}\n`,
);
console.log(line("current", sweep.current));

if (!sweep.best) {
  console.log(
    "\nNo grid point meets the over-flag limit, so the recommendation is to KEEP the current thresholds.",
  );
  if (sweep.lowestOverFlag) {
    console.log(line("least over-flag", sweep.lowestOverFlag));
    console.log(`  at ${JSON.stringify(sweep.lowestOverFlag.thresholds)} (information only)`);
  }
  writeFileSync("eval/results/sweep-dev.json", `${JSON.stringify(sweep, null, 2)}\n`);
  writeFileSync(
    "eval/thresholds.recommended.json",
    `${JSON.stringify(
      {
        thresholds: file.meta.thresholds,
        basis: {
          split: "dev",
          judge: file.meta.judgeLabel,
          decision: "keep-current",
          reason: `No point on the grid reaches over-flag <= ${pct(sweep.maxOverFlag, 0)}; the lowest reachable with recall >= 90% is ${sweep.lowestOverFlag ? pct(sweep.lowestOverFlag.metrics.overFlag.rate) : "n/a"} against ${pct(sweep.current.metrics.overFlag.rate)} today, a difference within noise on ${file.results.length} drafts. The over-flags come from checks that thresholds do not control; see eval/RESULTS.md.`,
          drafts: file.results.length,
          devMetricsAtCurrent: {
            recall: sweep.current.metrics.recall.rate,
            overFlag: sweep.current.metrics.overFlag.rate,
          },
          applied: false,
        },
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    "\nWrote eval/thresholds.recommended.json (keep current) and eval/results/sweep-dev.json.",
  );
  process.exit(0);
}

console.log(line("recommended", sweep.best));
console.log("\nDiff against src/core/verify/thresholds.ts (not applied):");
console.log(diffThresholds(file.meta.thresholds, sweep.best.thresholds));
console.log("\nTop candidates:");
for (const c of sweep.top) {
  console.log(
    `  ${JSON.stringify(c.thresholds)}  recall ${pct(c.metrics.recall.rate)}  over-flag ${pct(c.metrics.overFlag.rate)}  d=${c.distance.toFixed(2)}`,
  );
}
console.log("\nOne step either way from the recommendation:");
for (const n of sweep.neighbours)
  console.log(
    `  ${n.change.padEnd(40)} recall ${pct(n.candidate.metrics.recall.rate)}  over-flag ${pct(n.candidate.metrics.overFlag.rate)}`,
  );

writeFileSync("eval/results/sweep-dev.json", `${JSON.stringify(sweep, null, 2)}\n`);
writeFileSync(
  "eval/thresholds.recommended.json",
  `${JSON.stringify(
    {
      thresholds: sweep.best.thresholds,
      basis: {
        split: "dev",
        judge: file.meta.judgeLabel,
        rule: `maximise recall (bad drafts not SUPPORTED) subject to over-flag <= ${pct(sweep.maxOverFlag, 0)}`,
        drafts: file.results.length,
        devMetricsAtCurrent: {
          recall: sweep.current.metrics.recall.rate,
          overFlag: sweep.current.metrics.overFlag.rate,
        },
        devMetricsAtRecommended: {
          recall: sweep.best.metrics.recall.rate,
          overFlag: sweep.best.metrics.overFlag.rate,
        },
        applied: false,
      },
    },
    null,
    2,
  )}\n`,
);
console.log(
  "\nWrote eval/thresholds.recommended.json and eval/results/sweep-dev.json (nothing was applied).",
);
