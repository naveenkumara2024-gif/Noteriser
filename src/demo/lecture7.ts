import { TOOL_NAMES } from "../core/generate/schemas";
import { FakeLlmClient, type FakeStep, type RecordedRequest } from "../llm/fake";
import { CONTRADICTED, ENTAILED, FakeEmbedder, FakeNli, NEUTRAL } from "../nlp/fake";

/**
 * A scripted run over `fixtures/lecture7.md` that reproduces the situation in lore §6: six good
 * summary points, drafts the verifier must reject, a glossary entry that goes beyond the source and
 * needs narrowing, and eight question candidates of which five survive. No keys, no models.
 *
 * Expected outcome (the tests pin this): 24 drafts -> 18 supported, 1 partial (Preemption, flagged),
 * 5 removed (one unsupported summary claim, one contradicted, one question with invented numbers,
 * one duplicate question, one valid surplus question).
 */

const reply = (items: unknown[], insufficient_reason = "") => ({ items, insufficient_reason });
const insufficient = (why: string) => reply([], `INSUFFICIENT_SOURCE: ${why}`);

const point = (ids: string[], quote: string, text: string) => ({
  source_ids: ids,
  evidence_quote: quote,
  text,
});
const term = (id: string, quote: string, name: string, text: string) => ({
  source_ids: [id],
  evidence_quote: quote,
  term: name,
  text,
});
const question = (q: {
  ids: string[];
  quote: string;
  qtype: "mcq" | "short" | "true_false";
  question: string;
  options?: string[];
  answer: string;
  statement: string;
  answerIds?: string[];
}) => ({
  source_ids: q.ids,
  evidence_quote: q.quote,
  qtype: q.qtype,
  question: q.question,
  options: q.options ?? [],
  answer: q.answer,
  answer_statement: q.statement,
  answer_source_ids: q.answerIds ?? q.ids,
});

const SUMMARY: Record<number, unknown[]> = {
  1: [
    point(
      ["S1.1", "S1.2"],
      "decide which process in the ready queue gets the CPU next",
      "CPU scheduling decides which process in the ready queue gets the CPU next and keeps the CPU busy with acceptable response times.",
    ),
    point(
      ["S1.3", "S1.4"],
      "The component that hands the CPU to the chosen process is called the dispatcher",
      "The dispatcher gives the CPU to the chosen process, and the time it takes to switch is called dispatch latency.",
    ),
  ],
  2: [
    point(
      ["S2.1", "S2.2", "S2.3", "S2.4", "S2.5"],
      "Throughput is the number of processes completed per unit time",
      "CPU utilization, throughput, turnaround time, waiting time and response time are the measures of a scheduler.",
    ),
  ],
  3: [
    point(
      ["S3.1", "S3.2"],
      "FCFS is non-preemptive and can cause the convoy effect",
      "FCFS runs processes in arrival order and can cause the convoy effect, where short processes wait behind one long process.",
    ),
    point(
      ["S3.3", "S3.4"],
      "the minimum average waiting time for a given set of processes",
      "SJF gives the minimum average waiting time, but the next burst length must be predicted.",
    ),
    point(
      ["S3.5", "S3.6"],
      "gives each process a fixed time slice called the time quantum",
      "Round Robin gives each process a fixed time quantum; a very small quantum increases context-switch overhead.",
    ),
    // Rejected: nothing in the notes says this (lore §6.5).
    point(
      ["S3.5"],
      "gives each process a fixed time slice",
      "Round Robin is the most widely used scheduler in modern operating systems.",
    ),
    // Rejected: reverses the notes (lore §6.5).
    point(
      ["S3.4"],
      "the minimum average waiting time for a given set of processes",
      "SJF is impossible to implement in practice.",
    ),
  ],
};

const GLOSSARY: Record<number, unknown[]> = {
  1: [
    term(
      "S1.3",
      "The component that hands the CPU to the chosen process",
      "Dispatcher",
      "The component that hands the CPU to the chosen process.",
    ),
    term(
      "S1.4",
      "The time the dispatcher takes to stop one process and start another",
      "Dispatch latency",
      "The time the dispatcher takes to stop one process and start another.",
    ),
  ],
  2: [
    term(
      "S2.3",
      "Turnaround time is the total time from submission of a process to its completion",
      "Turnaround time",
      "Total time from submission of a process to its completion.",
    ),
    term(
      "S2.4",
      "Waiting time is the total time a process spends in the ready queue",
      "Waiting time",
      "Total time a process spends in the ready queue.",
    ),
    term(
      "S2.5",
      "Response time is the time from submission of a request until the first response is produced",
      "Response time",
      "Time from submission of a request until the first response is produced.",
    ),
  ],
  3: [
    term(
      "S3.2",
      "where short processes wait behind one long process",
      "Convoy effect",
      "Short processes waiting behind one long process.",
    ),
    term(
      "S3.5",
      "a fixed time slice called the time quantum",
      "Time quantum",
      "The fixed time slice each process gets in Round Robin.",
    ),
    // Goes beyond the source (lore §6.5); the repair narrows it to what S3.5 says.
    term(
      "S3.5",
      "the process is preempted and placed at the end of the ready queue",
      "Preemption",
      "Forcibly taking the CPU away from a running process.",
    ),
  ],
};

const QUESTIONS: unknown[] = [
  question({
    ids: ["S1.3"],
    quote: "hands the CPU to the chosen process",
    qtype: "short",
    question: "What is the role of the dispatcher?",
    answer: "It hands the CPU to the process chosen by the scheduler.",
    statement: "The dispatcher hands the CPU to the chosen process.",
  }),
  question({
    ids: ["S2.3", "S2.4"],
    quote: "Waiting time is the total time a process spends in the ready queue",
    qtype: "short",
    question: "How does waiting time differ from turnaround time?",
    answer:
      "Waiting time is the time spent in the ready queue; turnaround time is the total time from submission to completion.",
    statement:
      "Waiting time is the time spent in the ready queue, while turnaround time is the total time from submission to completion.",
  }),
  question({
    ids: ["S3.4"],
    quote: "SJF gives the minimum average waiting time",
    qtype: "true_false",
    question: "SJF gives the minimum average waiting time for a given set of processes.",
    answer: "True",
    statement: "SJF gives the minimum average waiting time for a given set of processes.",
  }),
  question({
    ids: ["S3.2"],
    quote: "FCFS is non-preemptive and can cause the convoy effect",
    qtype: "short",
    question: "Why can FCFS cause the convoy effect?",
    answer: "Because it is non-preemptive, so short processes wait behind one long process.",
    statement: "FCFS is non-preemptive, so short processes wait behind one long process.",
  }),
  question({
    ids: ["S3.6"],
    quote: "if it is very small, context-switch overhead increases",
    qtype: "mcq",
    question: "In Round Robin, what happens if the time quantum is made very small?",
    options: [
      "RR behaves like FCFS",
      "Context-switch overhead increases",
      "Throughput becomes zero",
      "Processes are never preempted",
    ],
    answer: "Context-switch overhead increases",
    statement: "If the time quantum is very small, context-switch overhead increases.",
  }),
  // Rejected: invented numbers (lore §6.5).
  question({
    ids: ["S3.6"],
    quote: "if it is very small, context-switch overhead increases",
    qtype: "short",
    question: "What is a typical time quantum in milliseconds?",
    answer: "10 to 100 ms",
    statement: "A typical time quantum is 10 to 100 milliseconds.",
  }),
  // Valid, and a good candidate: a true/false about FCFS.
  question({
    ids: ["S3.1"],
    quote: "schedules processes in the order they arrive",
    qtype: "true_false",
    question: "FCFS schedules processes in the order they arrive.",
    answer: "True",
    statement: "FCFS schedules processes in the order they arrive.",
  }),
  // Duplicate of the first question.
  question({
    ids: ["S1.3"],
    quote: "hands the CPU to the chosen process",
    qtype: "short",
    question: "What is the role of the dispatcher?",
    answer: "It gives the CPU to the process the scheduler picked.",
    statement: "The dispatcher hands the CPU to the chosen process.",
  }),
];

/** What the repair step answers, by the kind of item it is asked to fix. */
const REPAIRED_GLOSSARY = term(
  "S3.5",
  "the process is preempted and placed at the end of the ready queue",
  "Preemption",
  "A process being stopped after its time slice and placed at the end of the ready queue.",
);

const isRepair = (req: RecordedRequest): boolean => req.user.includes("<item_to_repair>");
const isSimplify = (req: RecordedRequest): boolean => req.user.includes("<item_to_simplify>");

/**
 * Plain-language rewrites, keyed by the original wording. They shorten sentences and reuse the
 * notes' own words. Anything not listed comes back unchanged ("already plain"), and two are
 * scripted to show the fallbacks: one rewrite adds a claim the notes do not make (the verifier
 * rejects it), and the narrowed Preemption entry cannot be simplified at all.
 */
const PLAIN_TEXT: Record<string, string> = {
  "CPU scheduling decides which process in the ready queue gets the CPU next and keeps the CPU busy with acceptable response times.":
    "CPU scheduling decides which process gets the CPU next. It keeps the CPU busy. It gives acceptable response times.",
  "The dispatcher gives the CPU to the chosen process, and the time it takes to switch is called dispatch latency.":
    "The dispatcher gives the CPU to the chosen process. The time it takes to switch is called dispatch latency.",
  // Rejected: the rewrite invents a claim.
  "FCFS runs processes in arrival order and can cause the convoy effect, where short processes wait behind one long process.":
    "FCFS runs processes in arrival order. It is the slowest method. It can cause the convoy effect.",
  "SJF gives the minimum average waiting time, but the next burst length must be predicted.":
    "SJF gives the minimum average waiting time. The next burst length must be predicted.",
  "Round Robin gives each process a fixed time quantum; a very small quantum increases context-switch overhead.":
    "Round Robin gives each process a fixed time quantum. A very small quantum increases context-switch overhead.",
  "The component that hands the CPU to the chosen process.":
    "The part that gives the CPU to the chosen process.",
  "Total time from submission of a process to its completion.":
    "The total time from submission of a process until it is complete.",
  "Total time a process spends in the ready queue.":
    "The total time a process waits in the ready queue.",
  "Time from submission of a request until the first response is produced.":
    "The time from submission of a request until the first response.",
  "Short processes waiting behind one long process.":
    "Short processes that wait behind one long process.",
  "The fixed time slice each process gets in Round Robin.":
    "The fixed slice of time each process gets in Round Robin.",
};
const PLAIN_QUESTION: Record<string, { question?: string; answer?: string }> = {
  "What is the role of the dispatcher?": { answer: "It gives the CPU to the chosen process." },
  "How does waiting time differ from turnaround time?": {
    question: "How is waiting time different from turnaround time?",
    answer:
      "Waiting time is the time in the ready queue. Turnaround time is the total time from submission to completion.",
  },
  "SJF gives the minimum average waiting time for a given set of processes.": {
    question: "SJF gives the minimum average waiting time.",
  },
  "Why can FCFS cause the convoy effect?": {
    answer: "It is non-preemptive. Short processes wait behind one long process.",
  },
  "In Round Robin, what happens if the time quantum is made very small?": {
    question: "What happens if the Round Robin time quantum is very small?",
  },
};

/** The scripted answer to a plain-language rewrite request for one item. */
function simplified(req: RecordedRequest) {
  const json = /<item_to_simplify>\n([\s\S]*?)\n<\/item_to_simplify>/.exec(req.user)?.[1] ?? "{}";
  const item = JSON.parse(json) as Record<string, unknown>;
  const text = typeof item.text === "string" ? item.text : undefined;
  if (text?.startsWith("A process being stopped after its time slice")) {
    return insufficient("this cannot be said more simply without changing it");
  }
  if (typeof item.question === "string") {
    const edit = PLAIN_QUESTION[item.question];
    return reply([
      edit
        ? { ...item, question: edit.question ?? item.question, answer: edit.answer ?? item.answer }
        : item,
    ]);
  }
  return reply([
    text !== undefined && PLAIN_TEXT[text] ? { ...item, text: PLAIN_TEXT[text] } : item,
  ]);
}
const sectionOf = (req: RecordedRequest): number =>
  Number(/Section (\d+),/.exec(req.user)?.[1] ?? 0);

/**
 * Scripted generator, judge and repair, keyed the way the real tools are. `overrides` replace any
 * tool's script, which lets tests make the judge fail or disagree.
 */
export function lecture7Llm(overrides: Record<string, FakeStep | FakeStep[]> = {}): FakeLlmClient {
  return new FakeLlmClient({
    [TOOL_NAMES.summary]: (req) =>
      isSimplify(req)
        ? simplified(req)
        : isRepair(req)
          ? insufficient("the notes do not say this")
          : reply(SUMMARY[sectionOf(req)] ?? []),
    [TOOL_NAMES.glossary]: (req) =>
      isSimplify(req)
        ? simplified(req)
        : isRepair(req)
          ? reply([REPAIRED_GLOSSARY])
          : reply(GLOSSARY[sectionOf(req)] ?? []),
    [TOOL_NAMES.questions]: (req) =>
      isSimplify(req)
        ? simplified(req)
        : isRepair(req)
          ? insufficient("the notes give no such number")
          : reply(QUESTIONS),
    submit_verdict: (req) => {
      const claim = /<claim>\n([\s\S]*?)\n<\/claim>/.exec(req.user)?.[1] ?? "";
      return /forcibly/i.test(claim)
        ? { unsupported_parts: ["forcibly taking the CPU away"], verdict: "fail" }
        : { unsupported_parts: [], verdict: "pass" };
    },
    submit_distractor_review: {
      options: [
        "RR behaves like FCFS",
        "Throughput becomes zero",
        "Processes are never preempted",
      ].map((option) => ({
        option,
        reason: "Not supported by the notes.",
        could_be_correct: false,
      })),
    },
    ...overrides,
  });
}

/** Stand-in for the entailment model: behaves like the real one does on the lore examples. */
export function lecture7Nli(): FakeNli {
  return new FakeNli((_premise, hypothesis) => {
    if (/impossible/i.test(hypothesis)) return CONTRADICTED;
    if (/most widely used|typical time quantum|slowest/i.test(hypothesis)) return NEUTRAL;
    // Moderate: the claim goes somewhat beyond its source, and so does the narrowed version.
    if (/^Preemption is/i.test(hypothesis)) {
      return { entailment: 0.7, neutral: 0.25, contradiction: 0.05 };
    }
    return ENTAILED;
  });
}

export function lecture7Fakes() {
  return { llm: lecture7Llm(), nli: lecture7Nli(), embedder: new FakeEmbedder() };
}
