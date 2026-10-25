/**
 * Pipeline evaluation: generate from each case's NOTES with live models, run the whole pipeline,
 * and write the sheet two human reviewers fill in.
 *
 *   npm run eval:e2e -- --profile nararouter --cases bio-01,cs-01
 *
 * Writes eval/results/e2e-<case>.json (the run result) and rebuilds eval/review-sheet.csv from every
 * e2e result present, so a later run adds rows instead of replacing them. The case drafts are NOT
 * used here: this measures what the generators and the verifier produce together.
 *
 * A single case takes several minutes on a free model; run a few at a time.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { describeSelection, parseEnv } from "../src/config/env";
import { type RunResult, runPipeline } from "../src/core/pipeline";
import { formatReport } from "../src/core/report";
import { HfEmbedder } from "../src/nlp/embed";
import { HfNli } from "../src/nlp/nli";
import { MemoryRunStore } from "../src/store/memory";
import { loadCases } from "./lib/cases";
import { reviewRowsFor, type SheetRow, sheetToCsv } from "./lib/sheet";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const { values } = parseArgs({
  options: {
    profile: { type: "string" },
    cases: { type: "string" },
    concurrency: { type: "string" },
  },
  strict: false,
});
if (values.profile) process.env.LLM_PROFILE = String(values.profile);

const wanted = values.cases ? new Set(String(values.cases).split(",")) : undefined;
const cases = loadCases().filter((c) => !wanted || wanted.has(c.id));
if (cases.length === 0) {
  console.error("No cases selected (use --cases id,id).");
  process.exit(2);
}

const env = parseEnv({ ...process.env, LLM_MODE: "live" });
const { createPiLlmClient } = await import("../src/llm/pi");
const client = await createPiLlmClient(env);
if (!client.ok) {
  console.error(`Models unavailable: ${client.error.message}`);
  process.exit(1);
}
console.error(`Using:\n  ${describeSelection(env)}`);
const [nli, embedder] = await Promise.all([HfNli.load(), HfEmbedder.load()]);

for (const c of cases) {
  const started = Date.now();
  console.error(`\n== ${c.id} (${c.topic}) ==`);
  const result = await runPipeline(
    { document: { kind: "text", text: c.notes } },
    {
      llm: client.value,
      nli,
      embedder,
      store: new MemoryRunStore(),
      clock: () => new Date(),
      newId: () => `eval-${c.id}-${randomUUID().slice(0, 6)}`,
      concurrency: values.concurrency ? Number(values.concurrency) : 2,
      onEvent: (e) => {
        if (e.type === "stage" && e.status === "start") console.error(`  > ${e.stage}`);
      },
    },
  );
  const seconds = Math.round((Date.now() - started) / 1000);
  console.error(`  ${result.status} in ${seconds}s\n${formatReport(result.report)}`);
  writeFileSync(
    `eval/results/e2e-${c.id}.json`,
    `${JSON.stringify({ caseId: c.id, seconds, models: describeSelection(env), result }, null, 2)}\n`,
  );
}

// Rebuild the sheet from every e2e result on disk, keeping reviewers' marks for rows that exist.
const old = existsSync("eval/review-sheet.csv")
  ? (await import("./lib/sheet")).sheetFromCsv(readFileSync("eval/review-sheet.csv", "utf8"))
  : [];
const marks = new Map(old.map((r) => [`${r.case}|${r.item_id}|${r.text}`, r]));

const rows: SheetRow[] = [];
for (const file of readdirSync("eval/results")
  .filter((f) => /^e2e-.*\.json$/.test(f))
  .sort()) {
  const { caseId, result } = JSON.parse(readFileSync(`eval/results/${file}`, "utf8")) as {
    caseId: string;
    result: RunResult;
  };
  for (const row of reviewRowsFor(caseId, result)) {
    const before = marks.get(`${row.case}|${row.item_id}|${row.text}`);
    rows.push(
      before
        ? { ...row, reviewer1: before.reviewer1, reviewer2: before.reviewer2, notes: before.notes }
        : row,
    );
  }
}
writeFileSync("eval/review-sheet.csv", sheetToCsv(rows));
console.log(
  `\nWrote eval/review-sheet.csv with ${rows.length} rows. Two reviewers fill reviewer1 and reviewer2 (supported | unsupported | unclear), then run \`npm run eval:kappa\`.`,
);
