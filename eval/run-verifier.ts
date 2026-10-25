/**
 * Verifier evaluation: run the real verifier over the labelled cases and write the raw results.
 *
 *   npm run eval -- --judge=fake                 offline: no model calls (judge always passes)
 *   npm run eval -- --judge=live --profile nararouter --split dev
 *   npm run eval -- --judge=live --split test --final     (the test split: once, after tuning)
 *
 * Options: --split dev|test|regressions|all (default dev)  --judge live|fake|off (default fake)
 *          --profile <name>  --concurrency N  --cases id,id  --out <file>  --final
 *          --nli-model <hf id>   compare entailment models (default Xenova/nli-deberta-v3-small)
 *
 * `--split test` and `--split all` need --final: the test split is reported on, never tuned on.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseEnv } from "../src/config/env";
import { THRESHOLDS } from "../src/core/verify";
import { HfNli, NLI_MODEL } from "../src/nlp/nli";
import { checkCases, describeCases, type EvalCase, loadCases, loadRegressions } from "./lib/cases";
import { computeMetrics, fmtRate, percentile } from "./lib/metrics";
import { type JudgeKind, offlineJudge, verifyCases } from "./lib/runner";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const { values } = parseArgs({
  options: {
    split: { type: "string", default: "dev" },
    judge: { type: "string", default: "fake" },
    profile: { type: "string" },
    concurrency: { type: "string" },
    cases: { type: "string" },
    out: { type: "string" },
    final: { type: "boolean" },
    "nli-model": { type: "string" },
  },
  allowPositionals: true,
  // npm passes `--judge=fake` through; both `--judge fake` and `--judge=fake` are accepted.
  strict: false,
});

const split = String(values.split);
const judgeKind = String(values.judge) as JudgeKind;
if (!["dev", "test", "regressions", "all"].includes(split)) {
  console.error("--split must be dev, test, regressions or all");
  process.exit(2);
}
if (!["live", "fake", "off"].includes(judgeKind)) {
  console.error("--judge must be live, fake or off");
  process.exit(2);
}
if ((split === "test" || split === "all") && !values.final) {
  console.error(
    "The test split is for the final report only. Tune on dev; then run `--split test --final` once.",
  );
  process.exit(2);
}
if (values.profile) process.env.LLM_PROFILE = String(values.profile);

const all = loadCases();
const problems = await checkCases(all, { requireSplitRule: true });
if (problems.length > 0) {
  console.error(`The case set is invalid:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}

let selected: EvalCase[] =
  split === "regressions"
    ? loadRegressions()
    : split === "all"
      ? all
      : all.filter((c) => c.split === split);
if (values.cases) {
  const wanted = new Set(String(values.cases).split(","));
  selected = selected.filter((c) => wanted.has(c.id));
}
if (selected.length === 0) {
  console.error("No cases selected.");
  process.exit(2);
}

// --- judge ------------------------------------------------------------------------------------
let llm = offlineJudge("fake");
let judgeLabel = "fake (always passes)";
if (judgeKind === "off") {
  llm = offlineJudge("off");
  judgeLabel = "off (every call fails)";
} else if (judgeKind === "live") {
  const env = parseEnv({ ...process.env, LLM_MODE: "live" });
  const { createPiLlmClient } = await import("../src/llm/pi");
  const client = await createPiLlmClient(env);
  if (!client.ok) {
    console.error(`Live judge unavailable: ${client.error.message}`);
    process.exit(1);
  }
  llm = client.value;
  const j = env.judgeModel;
  judgeLabel = j ? `live ${j.provider}:${j.model}` : "live";
}

console.error(`Judge: ${judgeLabel}`);
console.error(`Cases: ${selected.length} (${split})  ${JSON.stringify(describeCases(selected))}`);
console.error("Loading the entailment model...");
const nliModel = values["nli-model"] ? String(values["nli-model"]) : NLI_MODEL;
const nli = await HfNli.load({ model: nliModel });

const started = Date.now();
const results = await verifyCases({
  cases: selected,
  nli,
  llm,
  concurrency: values.concurrency ? Number(values.concurrency) : judgeKind === "live" ? 3 : 1,
  onProgress: (done, total) => {
    if (done % 10 === 0 || done === total) console.error(`  ${done}/${total} drafts`);
  },
});

const metrics = computeMetrics(results);
const latencies = results.map((r) => r.latencyMs);
const usage = results.reduce(
  (u, r) => ({
    inputTokens: u.inputTokens + r.usage.inputTokens,
    outputTokens: u.outputTokens + r.usage.outputTokens,
    costUsd: u.costUsd + r.usage.costUsd,
  }),
  { inputTokens: 0, outputTokens: 0, costUsd: 0 },
);

const out = resolve(String(values.out ?? `eval/results/${split}-${judgeKind}.json`));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify(
    {
      meta: {
        startedAt: new Date(started).toISOString(),
        wallSeconds: Math.round((Date.now() - started) / 1000),
        split,
        judge: judgeKind,
        judgeLabel,
        nliModel,
        thresholds: THRESHOLDS,
        concurrency: values.concurrency ? Number(values.concurrency) : null,
        drafts: results.length,
        degradedDrafts: results.filter((r) => r.degraded).length,
        latencyMs: {
          mean: Math.round(latencies.reduce((a, b) => a + b, 0) / Math.max(1, latencies.length)),
          p50: percentile(latencies, 0.5),
          p95: percentile(latencies, 0.95),
        },
        usage,
      },
      summary: metrics,
      results,
    },
    null,
    2,
  )}\n`,
);

console.log(`\nWrote ${out}`);
console.log(`Verifier recall (bad drafts not SUPPORTED): ${fmtRate(metrics.recall)}`);
console.log(`  rejected outright (UNSUPPORTED/CONTRADICTED): ${fmtRate(metrics.hardRecall)}`);
console.log(`Over-flag rate (good drafts not SUPPORTED): ${fmtRate(metrics.overFlag)}`);
console.log(`Balanced accuracy: ${(metrics.balancedAccuracy * 100).toFixed(1)}%`);
console.log(`Bad drafts passed as SUPPORTED: ${metrics.slipped}`);
if (results.some((r) => r.degraded)) {
  console.log(
    `Note: ${results.filter((r) => r.degraded).length} drafts were degraded (a check did not run).`,
  );
}
