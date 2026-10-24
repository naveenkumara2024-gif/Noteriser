/**
 * Real-model checks. Slow: the first run downloads the NLI model (~160 MB) into .cache/models.
 * Run with `npm run test:slow`. No API key is needed: the judge is a scripted "pass", so these
 * numbers isolate what the entailment model and the deterministic checks do.
 *
 * These examples are the lore's own (§6.2 correct points, §6.5 rejected drafts). If the model fails
 * to separate them, record the numbers; do not edit the examples or thresholds to hide it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DraftItem, GlossaryDraft, QuestionDraft, SummaryDraft } from "@/core/generate";
import type { SourceDoc } from "@/core/schema";
import { createVerifier, type Verification } from "@/core/verify";
import { FakeLlmClient } from "@/llm/fake";
import { HfEmbedder } from "@/nlp/embed";
import { HfNli } from "@/nlp/nli";
import { fixtureDoc } from "../support/docs";

let doc: SourceDoc;
let nli: HfNli;
let embedder: HfEmbedder;
const rows: {
  group: string;
  id: string;
  verdict: string;
  entail: string;
  contra: string;
  ms: number;
  note: string;
}[] = [];

const summary = (id: string, sourceIds: string[], quote: string, text: string): SummaryDraft => ({
  itemId: id,
  type: "summary_point",
  scope: "lore",
  sourceIds,
  evidenceQuote: quote,
  text,
  idsExist: true,
  problems: [],
});

/** Lore §6.2: the six summary points the notes DO support. */
const GOOD: SummaryDraft[] = [
  summary(
    "good-1",
    ["S1.1", "S1.2"],
    "decide which process in the ready queue gets the CPU next",
    "CPU scheduling is how the OS chooses which ready process runs next, aiming to keep the CPU busy and keep response times acceptable.",
  ),
  summary(
    "good-2",
    ["S1.3", "S1.4"],
    "The component that hands the CPU to the chosen process is called the dispatcher",
    "The dispatcher gives the CPU to the chosen process; the time it takes to switch processes is dispatch latency.",
  ),
  summary(
    "good-3",
    ["S2.1", "S2.2", "S2.3", "S2.4", "S2.5"],
    "Throughput is the number of processes completed per unit time",
    "Schedulers are judged by CPU utilization, throughput, turnaround time, waiting time, and response time.",
  ),
  summary(
    "good-4",
    ["S3.1", "S3.2"],
    "FCFS is non-preemptive and can cause the convoy effect",
    "FCFS runs processes in arrival order but can cause the convoy effect, where short processes wait behind a long one.",
  ),
  summary(
    "good-5",
    ["S3.3", "S3.4"],
    "the minimum average waiting time for a given set of processes",
    "SJF minimises average waiting time but needs the next CPU burst length to be predicted.",
  ),
  summary(
    "good-6",
    ["S3.5", "S3.6"],
    "gives each process a fixed time slice called the time quantum",
    "Round Robin gives each process a fixed time quantum and then moves it to the back of the queue; the quantum size trades off FCFS-like behaviour against context-switch overhead.",
  ),
];

/** Lore §6.5: drafts the verifier must not let through. */
const BAD: DraftItem[] = [
  summary(
    "bad-1 unsupported claim",
    ["S3.5"],
    "gives each process a fixed time slice",
    "Round Robin is the most widely used scheduler in modern operating systems.",
  ),
  summary(
    "bad-2 reversed meaning",
    ["S3.4"],
    "the minimum average waiting time for a given set of processes",
    "SJF is impossible to implement in practice.",
  ),
  {
    itemId: "bad-3 invented number",
    type: "question",
    scope: "lore",
    sourceIds: ["S3.6"],
    evidenceQuote: "if it is very small, context-switch overhead increases",
    text: "What is a typical time quantum in milliseconds?",
    idsExist: true,
    problems: [],
    qtype: "short",
    question: "What is a typical time quantum in milliseconds?",
    answer: "10 to 100 ms",
    answerStatement: "A typical time quantum is 10 to 100 milliseconds.",
    answerSourceIds: ["S3.6"],
  } satisfies QuestionDraft,
  {
    itemId: "bad-4 beyond the source",
    type: "glossary",
    scope: "lore",
    sourceIds: ["S3.5"],
    evidenceQuote: "the process is preempted and placed at the end of the ready queue",
    term: "Preemption",
    text: "Forcibly taking the CPU away from a running process.",
    idsExist: true,
    problems: [],
  } satisfies GlossaryDraft,
];

beforeAll(async () => {
  doc = await fixtureDoc();
  nli = await HfNli.load();
  embedder = await HfEmbedder.load();
});

async function run(group: string, items: DraftItem[]): Promise<Verification[]> {
  const verifier = createVerifier(doc, {
    nli,
    embedder,
    llm: new FakeLlmClient({ submit_verdict: { unsupported_parts: [], verdict: "pass" } }),
  });
  const out: Verification[] = [];
  for (const item of items) {
    const t0 = performance.now();
    const v = await verifier.verify(item);
    rows.push({
      group,
      id: item.itemId,
      verdict: v.verdict,
      entail: v.nli ? v.nli.entailment.toFixed(3) : "-",
      contra: v.nli ? v.nli.contradiction.toFixed(3) : "-",
      ms: Math.round(performance.now() - t0),
      note: v.reasons[0]?.slice(0, 70) ?? "",
    });
    out.push(v);
  }
  return out;
}

afterAll(() => {
  const header =
    "| group | item | verdict | entailment | contradiction | ms | first reason |\n|---|---|---|---|---|---|---|\n";
  const body = rows
    .map(
      (r) =>
        `| ${r.group} | ${r.id} | ${r.verdict} | ${r.entail} | ${r.contra} | ${r.ms} | ${r.note} |`,
    )
    .join("\n");
  // Vitest hides console output of passing runs, so the table is also written where it can be read.
  mkdirSync(".cache", { recursive: true });
  writeFileSync(".cache/stage3-slow-results.md", `${header}${body}\n`);
  console.log("\n=== Stage 3 real-model results (judge scripted as 'pass') ===");
  console.table(rows);
});

describe("real NLI + deterministic checks on the lore examples", () => {
  it("never lets a §6.5 draft through as SUPPORTED", async () => {
    const results = await run("bad (§6.5)", BAD);
    for (const [i, v] of results.entries()) {
      expect(v.verdict, `${BAD[i]?.itemId}: ${v.reasons.join(" | ")}`).not.toBe("SUPPORTED");
    }
  }, 120_000);

  it("§6.5 'SJF is impossible…' is detected as a contradiction by the real model", async () => {
    const [v] = await run("bad (detail)", [BAD[1] as DraftItem]);
    expect(v?.nli?.contradiction ?? 0).toBeGreaterThan(0.5);
    expect(v?.verdict).toBe("CONTRADICTED");
  }, 60_000);

  it("§6.5 'most widely used…' is neutral to its source, not entailed", async () => {
    const [v] = await run("bad (detail)", [BAD[0] as DraftItem]);
    expect(v?.nli?.entailment ?? 1).toBeLessThan(0.5);
    expect(v?.verdict).toBe("UNSUPPORTED");
  }, 60_000);

  it("keeps the §6.2 correct points apart from the bad drafts", async () => {
    const good = await run("good (§6.2)", GOOD);
    const bad = await run("bad (§6.5, again)", BAD.slice(0, 2));
    const worstGood = Math.min(...good.map((v) => v.nli?.entailment ?? 0));
    const bestBad = Math.max(...bad.map((v) => v.nli?.entailment ?? 0));
    console.log(
      `lowest good entailment ${worstGood.toFixed(3)} vs highest bad ${bestBad.toFixed(3)}`,
    );
    expect(worstGood).toBeGreaterThan(bestBad);
    for (const v of good) {
      expect(v.verdict, `${v.itemId}: ${v.reasons.join(" | ")}`).not.toBe("CONTRADICTED");
    }
  }, 120_000);

  it("windows a premise that is longer than the model accepts instead of truncating", async () => {
    const long = Array.from(
      { length: 80 },
      (_, i) => `Filler sentence ${i} talks about nothing relevant at all today.`,
    );
    const premise = [
      ...long.slice(0, 40),
      "The dispatcher hands the CPU to the chosen process.",
      ...long.slice(40),
    ];
    const { scoreEntailment } = await import("@/core/verify");
    const units = premise.map((text) => ({ text, section: 1, heading: null }));
    const r = await scoreEntailment(
      nli,
      units,
      "The dispatcher hands the CPU to the chosen process.",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.calls).toBeGreaterThan(1);
      expect(r.value.entailment).toBeGreaterThan(0.85);
    }
  }, 120_000);
});
