/**
 * Parse a document and print the draft summary, glossary and questions the generator produces.
 * Drafts are unverified: that is Stage 3.
 *
 * Usage: npx tsx scripts/generate.ts <file> [options]
 *   --only summary,glossary,questions   run just these (default: all three)
 *   --concurrency N                     parallel model calls (default 3)
 *   --out result.json                   write the JSON to a file instead of the terminal
 *   --profile nararouter|openrouter     use this provider profile instead of LLM_PROFILE in .env.local
 * Press Ctrl+C at any time to stop; everything that finished is still printed.
 *
 * Needs provider + GEN_MODEL + JUDGE_MODEL and a key (see .env.example). Prints SKIPPED and exits 0
 * when the model setup is incomplete.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import {
  describeSelection,
  EnvError,
  parseEnv,
  warnIfJudgeEqualsGenerator,
} from "../src/config/env";
import {
  type GenerationOutcome,
  type GenerationProgress,
  generateGlossary,
  generateQuestions,
  generateSummary,
  LONG_DOC_SENTENCES,
} from "../src/core/generate";
import { parseDocument } from "../src/core/ingest";
import { addUsage, ZERO_USAGE } from "../src/core/ports/llm";
import { createPiLlmClient } from "../src/llm/pi";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const TASKS = ["summary", "glossary", "questions"] as const;
type Task = (typeof TASKS)[number];

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    only: { type: "string" },
    concurrency: { type: "string" },
    out: { type: "string" },
    profile: { type: "string" },
  },
});

const path = positionals[0];
if (!path) {
  console.error(
    "Usage: npx tsx scripts/generate.ts <file> [--only summary,glossary,questions] [--concurrency N] [--out file.json] [--profile nararouter|openrouter]",
  );
  process.exit(2);
}

const wanted = new Set<Task>(TASKS);
if (values.only) {
  wanted.clear();
  for (const name of values.only.split(",").map((s) => s.trim())) {
    if (!(TASKS as readonly string[]).includes(name)) {
      console.error(`--only: unknown task "${name}". Use: ${TASKS.join(", ")}`);
      process.exit(2);
    }
    wanted.add(name as Task);
  }
}
const concurrency = values.concurrency ? Number(values.concurrency) : undefined;
if (concurrency !== undefined && !(Number.isInteger(concurrency) && concurrency >= 1)) {
  console.error("--concurrency must be a whole number of 1 or more");
  process.exit(2);
}

if (values.profile) process.env.LLM_PROFILE = values.profile;

let env: ReturnType<typeof parseEnv>;
try {
  env = parseEnv({ ...process.env, LLM_MODE: "live" });
} catch (e) {
  if (e instanceof EnvError) {
    console.log(`SKIPPED (model setup incomplete; see .env.example)\n${e.message}`);
    process.exit(0);
  }
  throw e;
}
console.error(`Using:\n  ${describeSelection(env)}`);

const client = await createPiLlmClient(env);
if (!client.ok) {
  console.log(`SKIPPED (${client.error.message})`);
  process.exit(0);
}
const warning = warnIfJudgeEqualsGenerator(env);
if (warning) console.error(`warning: ${warning}`);

const parsed = await parseDocument({
  kind: "file",
  name: basename(path),
  bytes: new Uint8Array(readFileSync(path)),
});
if (!parsed.ok) {
  console.error(`${parsed.error.code}: ${parsed.error.message}`);
  process.exit(1);
}
const doc = parsed.value;

// --- how big is this job? -------------------------------------------------------------------
const sections = doc.sections.length;
const long = doc.sentences.length > LONG_DOC_SENTENCES;
const expected: Record<Task, number> = {
  summary: sections + (long ? 1 : 0),
  glossary: sections,
  questions: long ? sections : 1,
};
const totalCalls = [...wanted].reduce((n, t) => n + expected[t], 0);
const parallel = concurrency ?? 3;
console.error(
  `Document: ${doc.stats.sentences} sentences in ${sections} section(s).` +
    `\nThis will make about ${totalCalls} model call(s) for: ${[...wanted].join(", ")} (${parallel} at a time).` +
    "\nEach call can take 10-60 s on a slow model. Ctrl+C stops and keeps what has finished.",
);
if (totalCalls > 20) {
  console.error(
    "Tip: that is a lot for a first try. Add --only summary, or test with fixtures/lecture7.md.",
  );
}

// --- progress ---------------------------------------------------------------------------------
const startedAt = Date.now();
const startTimes = new Map<string, number>();
let finished = 0;
let inFlight = 0;
let lastActivity = Date.now();

const fmt = (ms: number): string => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
};

function onProgress(e: GenerationProgress): void {
  const key = `${e.task}/${e.scope}`;
  lastActivity = Date.now();
  if (e.phase === "start") {
    startTimes.set(key, Date.now());
    inFlight++;
    return;
  }
  inFlight--;
  finished++;
  const took = fmt(Date.now() - (startTimes.get(key) ?? Date.now()));
  const mark = e.phase === "done" ? "ok  " : "FAIL";
  console.error(
    `[${String(finished).padStart(String(totalCalls).length)}/${totalCalls}] ${mark} ${e.task.padEnd(9)} ${e.scope.padEnd(11)} ${took.padStart(5)}  ${e.detail ?? ""}   (total ${fmt(Date.now() - startedAt)})`,
  );
}

const heartbeat = setInterval(() => {
  if (Date.now() - lastActivity >= 15_000) {
    console.error(
      `   ... still working: ${inFlight} call(s) waiting on the model, ${finished}/${totalCalls} done, ${fmt(Date.now() - startedAt)} elapsed`,
    );
    lastActivity = Date.now();
  }
}, 5_000);

const controller = new AbortController();
let interrupted = false;
process.on("SIGINT", () => {
  if (interrupted) process.exit(130);
  interrupted = true;
  console.error("\nStopping... (press Ctrl+C again to quit immediately)");
  controller.abort();
});

// --- run -----------------------------------------------------------------------------------
const deps = { llm: client.value, signal: controller.signal, concurrency, onProgress };
const empty: GenerationOutcome = {
  items: [],
  failures: [],
  insufficient: [],
  problems: [],
  usage: ZERO_USAGE,
};
const outcomes: Partial<Record<Task, GenerationOutcome>> = {};
if (wanted.has("summary")) outcomes.summary = await generateSummary(doc, deps);
if (wanted.has("glossary")) outcomes.glossary = await generateGlossary(doc, deps);
if (wanted.has("questions")) outcomes.questions = await generateQuestions(doc, deps);
clearInterval(heartbeat);

// --- report -----------------------------------------------------------------------------------
const json = JSON.stringify(outcomes, null, 2);
if (values.out) {
  writeFileSync(values.out, json);
  console.error(`\nWrote ${values.out}`);
} else {
  console.log(json);
}

const all = TASKS.map((t) => outcomes[t] ?? empty);
const usage = all.reduce((u, o) => addUsage(u, o.usage), ZERO_USAGE);
const failures = all.reduce((n, o) => n + o.failures.length, 0);
const count = (t: Task): string => (wanted.has(t) ? String(outcomes[t]?.items.length ?? 0) : "-");
console.error(
  `\nDrafts: ${count("summary")} summary, ${count("glossary")} glossary, ${count("questions")} questions` +
    `${interrupted ? " (stopped early)" : ""}` +
    `\nFailed calls: ${failures}` +
    `\nTokens: in=${usage.inputTokens} out=${usage.outputTokens}  cost: $${usage.costUsd.toFixed(4)}  time: ${fmt(Date.now() - startedAt)}`,
);
// Set the code and let Node exit by itself: process.exit() can cut off a large piped JSON output.
process.exitCode = interrupted ? 130 : failures > 0 ? 1 : 0;
