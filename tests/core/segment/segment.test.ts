import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Value from "typebox/value";
import { describe, expect, it } from "vitest";
import { parseDocument } from "@/core/ingest";
import { SourceDoc } from "@/core/schema";
import { segment } from "@/core/segment";

/** Lore §6.1, sentence by sentence. */
const LORE: [string, string][] = [
  [
    "S1.1",
    "CPU scheduling is the method an operating system uses to decide which process in the ready queue gets the CPU next.",
  ],
  ["S1.2", "Its goal is to keep the CPU busy and to give users acceptable response times."],
  ["S1.3", "The component that hands the CPU to the chosen process is called the dispatcher."],
  [
    "S1.4",
    "The time the dispatcher takes to stop one process and start another is called dispatch latency.",
  ],
  ["S2.1", "CPU utilization is the percentage of time the CPU is busy."],
  ["S2.2", "Throughput is the number of processes completed per unit time."],
  ["S2.3", "Turnaround time is the total time from submission of a process to its completion."],
  ["S2.4", "Waiting time is the total time a process spends in the ready queue."],
  [
    "S2.5",
    "Response time is the time from submission of a request until the first response is produced.",
  ],
  ["S3.1", "First-Come, First-Served (FCFS) schedules processes in the order they arrive."],
  [
    "S3.2",
    "FCFS is non-preemptive and can cause the convoy effect, where short processes wait behind one long process.",
  ],
  ["S3.3", "Shortest Job First (SJF) selects the process with the smallest next CPU burst."],
  [
    "S3.4",
    "SJF gives the minimum average waiting time for a given set of processes, but the length of the next burst must be predicted.",
  ],
  [
    "S3.5",
    "Round Robin (RR) gives each process a fixed time slice called the time quantum, after which the process is preempted and placed at the end of the ready queue.",
  ],
  [
    "S3.6",
    "If the time quantum is very large, RR behaves like FCFS; if it is very small, context-switch overhead increases.",
  ],
];

function seg(text: string) {
  const r = segment(text);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}

const sentenceTexts = (text: string): string[] => seg(text).sentences.map((s) => s.text);
const para = (prefix: string, n: number): string =>
  Array.from({ length: n }, (_, i) => `Sentence ${prefix}${i + 1} states a fact.`).join(" ");

describe("lecture 7 fixture (lore §6.1)", () => {
  const fixture = readFileSync(resolve(process.cwd(), "fixtures/lecture7.md"), "utf8");

  it("yields exactly 3 sections and the 15 lore sentences with stable IDs", async () => {
    const r = await parseDocument({ kind: "text", text: fixture });
    if (!r.ok) throw new Error(r.error.message);
    const doc = r.value;

    expect(doc.sections.map((s) => s.title)).toEqual([
      "What is CPU scheduling?",
      "Scheduling criteria",
      "Scheduling algorithms",
    ]);
    expect(doc.sentences.map((s) => [s.id, s.text])).toEqual(LORE);
    expect(doc.sentences.map((s) => s.position)).toEqual(LORE.map((_, i) => i));
    expect(doc.title).toBe("Lecture 7: CPU Scheduling Basics");
    expect(doc.warnings).toEqual([]);
    expect(doc.stats).toMatchObject({ sentences: 15, sections: 3, excludedBlocks: 0 });
  });

  it("produces a document that satisfies the SourceDoc schema", async () => {
    const r = await parseDocument({ kind: "text", text: fixture });
    if (!r.ok) throw new Error(r.error.message);
    expect(Value.Check(SourceDoc, r.value)).toBe(true);
  });

  it("is deterministic and identical for CRLF input", async () => {
    const a = await parseDocument({ kind: "text", text: fixture });
    const b = await parseDocument({ kind: "text", text: fixture.replace(/\n/g, "\r\n") });
    expect(b).toEqual(a);
  });

  it("treats plain format the same for already-clean text", async () => {
    const a = await parseDocument({ kind: "text", text: fixture, format: "plain" });
    if (!a.ok) throw new Error(a.error.message);
    expect(a.value.sentences.map((s) => s.text)).toEqual(LORE.map(([, t]) => t));
  });
});

describe("sections", () => {
  it("numbers sections and sentences from 1 and flattens heading levels", () => {
    const doc = seg("# Title\n\n## Sub\nOne here.\n\n### Subsub\nTwo here.");
    expect(doc.title).toBe("Title");
    expect(doc.sections.map((s) => s.title)).toEqual(["Sub", "Subsub"]);
    expect(doc.sentences.map((s) => s.id)).toEqual(["S1.1", "S2.1"]);
  });

  it("does not make a title of a lone heading that has content", () => {
    const doc = seg("# Only heading\nSome content here.");
    expect(doc.title).toBeUndefined();
    expect(doc.sections.map((s) => s.title)).toEqual(["Only heading"]);
  });

  it("drops empty sections and renumbers", () => {
    const doc = seg("## A\n## B\nText here is long enough.");
    expect(doc.sections.map((s) => s.title)).toEqual(["B"]);
    expect(doc.sentences[0]?.id).toBe("S1.1");
  });

  it("keeps content before the first heading in an 'Untitled section'", () => {
    const doc = seg("Opening remark before any heading.\n\n## Real section\nBody sentence.");
    expect(doc.sections.map((s) => s.title)).toEqual(["Untitled section", "Real section"]);
  });

  it.each([
    ["Section N: pattern", "Section 1: Introduction\nBody sentence here.", "Introduction"],
    ["numbered heading", "1. What is it?\nBody sentence here.", "What is it?"],
    ["numbered heading with ) ", "2) Overview of terms\nBody sentence here.", "Overview of terms"],
    ["markdown with trailing hashes", "## Wrap up ##\nBody sentence here.", "Wrap up"],
  ])("detects heading: %s", (_name, input, title) => {
    expect(seg(input).sections[0]?.title).toBe(title);
  });

  it("does not mistake a numbered list for headings", () => {
    const doc = seg("1. Alpha item\n2. Beta item\n3. Gamma item");
    expect(doc.sentences.map((s) => s.text)).toEqual(["Alpha item", "Beta item", "Gamma item"]);
    expect(doc.sections).toHaveLength(1);
  });

  it("does not make a heading of a long numbered sentence", () => {
    const doc = seg("1. This is a full sentence that happens to start with a number.\nMore text.");
    expect(doc.sections.map((s) => s.title)).toEqual(["Notes"]);
  });
});

describe("lines and sentences", () => {
  it("gives every bullet its own sentence, with or without terminal punctuation", () => {
    expect(sentenceTexts("- Alpha\n- Beta.\n* Gamma")).toEqual(["Alpha", "Beta.", "Gamma"]);
  });

  it("joins an indented bullet continuation onto its bullet", () => {
    expect(sentenceTexts("- A bullet that wraps\n  onto a second line.\n- Next one.")).toEqual([
      "A bullet that wraps onto a second line.",
      "Next one.",
    ]);
  });

  it("joins soft-wrapped lines of a paragraph", () => {
    expect(
      sentenceTexts("The scheduler picks the next\nprocess from the queue. It then runs it."),
    ).toEqual(["The scheduler picks the next process from the queue.", "It then runs it."]);
  });

  it("keeps a line that ends in punctuation as a boundary", () => {
    expect(sentenceTexts("First one ends here.\nsecond starts lowercase.")).toEqual([
      "First one ends here.",
      "second starts lowercase.",
    ]);
  });

  it("treats a short unpunctuated line before a capitalised line as a title, not a wrap", () => {
    expect(sentenceTexts("Scheduling criteria\nCPU utilization is high.")).toEqual([
      "Scheduling criteria",
      "CPU utilization is high.",
    ]);
  });

  it("handles Unicode text", () => {
    expect(sentenceTexts("Caf\u00E9 \u00FCber alles. \u00C7a va bien.")).toEqual([
      "Caf\u00E9 \u00FCber alles.",
      "\u00C7a va bien.",
    ]);
  });
});

describe("notes without headings (lore §4)", () => {
  it("groups paragraphs into parts of at least five sentences", () => {
    const doc = seg(`${para("a", 3)}\n\n${para("b", 3)}\n\n${para("c", 3)}`);
    expect(doc.sections.map((s) => [s.title, s.sentenceIds.length])).toEqual([
      ["Part 1", 6],
      ["Part 2", 3],
    ]);
    const w = doc.warnings.find((x) => x.kind === "no_headings");
    expect(w?.detail).toContain("paragraph breaks");
  });

  it("falls back to groups of six sentences for one big paragraph, merging a tiny tail", () => {
    const doc = seg(para("x", 14));
    expect(doc.sections.map((s) => s.sentenceIds.length)).toEqual([6, 8]);
    expect(doc.warnings.find((x) => x.kind === "no_headings")?.detail).toContain("sentence count");
  });

  it("keeps a short note as a single 'Notes' section with both warnings", () => {
    const doc = seg(para("s", 3));
    expect(doc.sections.map((s) => s.title)).toEqual(["Notes"]);
    expect(doc.warnings.map((w) => w.kind).sort()).toEqual(["no_headings", "too_short"]);
  });

  it("warns too_short under ten sentences even with headings", () => {
    const doc = seg("## A\nOne here. Two here.");
    expect(doc.warnings.map((w) => w.kind)).toEqual(["too_short"]);
  });
});

describe("content that cannot be processed is flagged, never silently dropped", () => {
  const withBlock = (block: string): string =>
    `## Topic\nBefore the block comes this sentence.\n\n${block}\n\nAfter the block comes this one.`;

  it.each([
    ["table", "| Algo | Wait |\n|------|------|\n| FCFS | 10 |"],
    ["code block", "```\nwhile (true) { run(); }\n```"],
    ["latex", "$$\nE = mc^2\n$$"],
    ["latex (single line)", "$$x^2 + y^2$$"],
    ["latex (environment)", "\\begin{equation}\na = b\n\\end{equation}"],
    ["image", "![diagram of the queue](queue.png)"],
  ])("%s", (what, block) => {
    const doc = seg(withBlock(block));
    expect(doc.sentences.map((s) => s.text)).toEqual([
      "Before the block comes this sentence.",
      "After the block comes this one.",
    ]);
    const w = doc.warnings.find((x) => x.kind === "not_processed");
    expect(w?.detail).toContain(`${what.split(" (")[0]} not processed`);
    expect(w?.location?.afterSentenceId).toBe("S1.1");
    expect(doc.stats.excludedBlocks).toBe(1);
  });

  it("records an inline image and keeps the surrounding sentence", () => {
    const doc = seg("## T\nLook at ![diagram](d.png) closely. Next sentence.");
    expect(doc.sentences.map((s) => s.text)).toEqual(["Look at closely.", "Next sentence."]);
    expect(doc.warnings.find((w) => w.kind === "not_processed")?.detail).toContain("image");
  });

  it("flags an unterminated code fence instead of swallowing silently", () => {
    const doc = seg("## T\nKept sentence.\n\n```\nnever closed");
    expect(doc.sentences.map((s) => s.text)).toEqual(["Kept sentence."]);
    expect(doc.warnings.some((w) => w.kind === "not_processed")).toBe(true);
  });

  it("errors when nothing readable remains", () => {
    const r = segment("| a | b |\n| c | d |");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("no_sentences");
      expect(r.error.message).toContain("1 block");
    }
  });

  it("errors on punctuation-only input", () => {
    const r = segment("...");
    expect(r.ok).toBe(false);
  });
});

describe("generated section titles are marked (so they are never mistaken for source text)", () => {
  it("marks 'Notes', 'Part N' and 'Untitled section', but not real headings", () => {
    const parts = seg(`${para("a", 3)}\n\n${para("b", 3)}\n\n${para("c", 3)}`);
    expect(parts.sections.map((s) => s.generatedTitle)).toEqual([true, true]);

    const notes = seg(para("s", 3));
    expect(notes.sections[0]).toMatchObject({ title: "Notes", generatedTitle: true });

    const mixed = seg("Opening remark before any heading.\n\n## Real section\nBody sentence.");
    expect(mixed.sections[0]).toMatchObject({ title: "Untitled section", generatedTitle: true });
    expect(mixed.sections[1]).not.toHaveProperty("generatedTitle");
  });

  it("the lecture fixture's headings are all real", async () => {
    const text = readFileSync(resolve(process.cwd(), "fixtures/lecture7.md"), "utf8");
    const r = await parseDocument({ kind: "text", text });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.sections.some((s) => s.generatedTitle)).toBe(false);
    expect(Value.Check(SourceDoc, r.value)).toBe(true);
  });
});
