/**
 * Run the whole pipeline on a document: parse, generate, verify, repair once, assemble.
 *
 * Usage: npx tsx scripts/run.ts <file> [options]
 *   --fake                 scripted models, no keys, no downloads (only meaningful for fixtures/lecture7.md)
 *   --profile <name>       provider profile for this run (see .env.example); default LLM_PROFILE
 *   --verbose              also print every verdict as it happens
 *   --export <file.jsonl>  write the run's audit trail (needs a stored run; contains the source text)
 *   --concurrency N        parallel model calls (default 3 for generation, 4 for review)
 * Press Ctrl+C to stop; what finished is still reported.
 *
 * Real mode loads the entailment model (first run downloads about 160 MB) and stores the run in
 * data/noteriser.db, purged after RUN_TTL_HOURS. Fake mode keeps everything in memory.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import {
  describeSelection,
  EnvError,
  parseEnv,
  warnIfJudgeEqualsGenerator,
} from "../src/config/env";
import type { DocumentInput } from "../src/core/ingest";
import {
  type PipelineDeps,
  type RunEvent,
  type RunResult,
  runPipeline,
  type ShownItem,
} from "../src/core/pipeline";
import type { RunStore } from "../src/core/ports/store";
import { formatReport } from "../src/core/report";
import { lecture7Fakes } from "../src/demo";
import { MemoryRunStore } from "../src/store/memory";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    fake: { type: "boolean" },
    profile: { type: "string" },
    verbose: { type: "boolean" },
    export: { type: "string" },
    concurrency: { type: "string" },
  },
});

const path = positionals[0];
if (!path) {
  console.error(
    "Usage: npx tsx scripts/run.ts <file> [--fake] [--profile name] [--verbose] [--export file.jsonl]",
  );
  process.exit(2);
}
const concurrency = values.concurrency ? Number(values.concurrency) : undefined;
if (concurrency !== undefined && !(Number.isInteger(concurrency) && concurrency >= 1)) {
  console.error("--concurrency must be a whole number of 1 or more");
  process.exit(2);
}
if (values.profile) process.env.LLM_PROFILE = values.profile;

const say = (line: string): void => console.error(line);
const fmt = (ms: number): string => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
};

// --- dependencies ---------------------------------------------------------------------------
const bytes = new Uint8Array(readFileSync(path));
const document: DocumentInput = { kind: "file", name: basename(path), bytes };

let deps: Omit<PipelineDeps, "clock" | "newId" | "onEvent" | "signal">;
let stopPurge: (() => void) | undefined;

if (values.fake) {
  if (basename(path) !== "lecture7.md") {
    say(
      "note: --fake is scripted for fixtures/lecture7.md; other files will give meaningless results",
    );
  }
  deps = { ...lecture7Fakes(), store: new MemoryRunStore(), concurrency };
} else {
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
  say(`Using:\n  ${describeSelection(env)}`);
  const warning = warnIfJudgeEqualsGenerator(env);
  if (warning) say(`warning: ${warning}`);

  const { createPiLlmClient } = await import("../src/llm/pi");
  const client = await createPiLlmClient(env);
  if (!client.ok) {
    console.log(`SKIPPED (${client.error.message})`);
    process.exit(0);
  }
  say("Loading the entailment model (the first run downloads about 160 MB)...");
  const { HfNli } = await import("../src/nlp/nli");
  const { HfEmbedder } = await import("../src/nlp/embed");
  const [nli, embedder] = await Promise.all([HfNli.load(), HfEmbedder.load()]);

  const { SqliteRunStore } = await import("../src/store/sqlite");
  const { startPurgeSchedule } = await import("../src/store/purge");
  const store = SqliteRunStore.open(process.env.NOTERISER_DB ?? "data/noteriser.db");
  const purge = startPurgeSchedule(store, { ttlHours: env.runTtlHours });
  stopPurge = purge.stop;
  deps = { llm: client.value, nli, embedder, store, concurrency };
}

// --- run ----------------------------------------------------------------------------------------
const startedAt = Date.now();
const startTimes = new Map<string, number>();
let interrupted = false;
const controller = new AbortController();
process.on("SIGINT", () => {
  if (interrupted) process.exit(130);
  interrupted = true;
  say("\nStopping... (press Ctrl+C again to quit immediately)");
  controller.abort();
});

function show(e: RunEvent): void {
  const t = `(${fmt(Date.now() - startedAt)})`;
  switch (e.type) {
    case "stage":
      if (e.status === "start") say(`> ${e.stage} ${t}`);
      break;
    case "progress": {
      const key = `${e.task}/${e.scope}`;
      if (e.phase === "start") startTimes.set(key, Date.now());
      else {
        const took = fmt(Date.now() - (startTimes.get(key) ?? Date.now()));
        say(
          `    ${e.phase === "done" ? "ok  " : "FAIL"} ${e.task.padEnd(9)} ${e.scope.padEnd(11)} ${took.padStart(5)}  ${e.detail ?? ""}`,
        );
      }
      break;
    }
    case "verdict":
      if (values.verbose)
        say(
          `    ${e.itemId.padEnd(7)} #${e.attempt} ${e.verdict}${e.degraded ? " (degraded)" : ""}`,
        );
      break;
    case "repaired":
      say(
        `    repair ${e.itemId.padEnd(7)} ${e.outcome} -> ${e.verdict}${e.note ? ` (${e.note})` : ""}`,
      );
      break;
    case "removed":
      say(`    removed ${e.itemId.padEnd(7)} ${e.kind}`);
      break;
    case "warning":
      say(`  ! ${e.code}: ${e.message}`);
      break;
    case "error":
      say(`  ERROR ${e.code}: ${e.message}`);
      break;
    default:
      break;
  }
}

const result = await runPipeline(
  { document },
  {
    ...deps,
    clock: () => new Date(),
    newId: () => `run-${randomUUID().slice(0, 8)}`,
    signal: controller.signal,
    onEvent: show,
  },
);
stopPurge?.();

// --- output -------------------------------------------------------------------------------------
const cites = (s: ShownItem): string => `[${s.envelope.sourceIds.join(", ")}]`;
const mark = (s: ShownItem): string =>
  s.flagged ? `\n     ! CHECK AGAINST SOURCE: ${s.envelope.flagReason ?? ""}` : "";

function render(r: RunResult): string {
  const out: string[] = [];
  out.push(`# ${r.doc?.title ?? "Study aids"}`, "");
  out.push("## Summary");
  for (const [i, s] of r.summary.entries()) {
    out.push(`${i + 1}. ${s.envelope.text} ${cites(s)}${mark(s)}`);
  }
  out.push("", "## Glossary");
  for (const g of r.glossary) {
    const term = g.envelope.term;
    out.push(`- ${term ? `**${term}**: ` : ""}${g.envelope.text} ${cites(g)}${mark(g)}`);
  }
  out.push("", "## Questions");
  r.questions.forEach((q, i) => {
    const e = q.envelope as { qtype?: string; options?: string[]; answer?: string };
    out.push(`${i + 1}. (${e.qtype ?? "?"}) ${q.envelope.text}${mark(q)}`);
    for (const [k, o] of (e.options ?? []).entries()) out.push(`     ${"ABCD"[k]}) ${o}`);
    out.push(`     Answer: ${e.answer ?? ""} ${cites(q)}`);
  });
  out.push("", `## Removed items (${r.removed.length})`);
  for (const x of r.removed) {
    out.push(`- ${x.envelope.itemId} [${x.kind}] ${x.envelope.text}`);
    out.push(`    why: ${x.reasons.join(" ")}`);
    if (x.repairNote) out.push(`    repair: ${x.repairNote}`);
  }
  if (r.warnings.length > 0) {
    out.push("", "## Notices");
    for (const w of r.warnings) out.push(`- ${w.message}`);
  }
  if (r.degraded)
    out.push(
      "",
      "!! VERIFIER DEGRADED: some checks did not run; do not treat these items as verified.",
    );
  return out.join("\n");
}

console.log(render(result));
console.log(
  `\n--- Run report (${result.runId}, ${result.status}, ${fmt(Date.now() - startedAt)}) ---`,
);
console.log(formatReport(result.report));

if (values.export) {
  const text = await (deps.store as RunStore).exportJsonl(result.runId);
  if (text) {
    writeFileSync(values.export, text);
    say(`Wrote the audit trail to ${values.export} (it contains the source text)`);
  }
}
process.exitCode = result.status === "complete" ? 0 : interrupted ? 130 : 1;
