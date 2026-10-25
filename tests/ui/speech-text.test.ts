import { describe, expect, it } from "vitest";
import type { QuestionItem } from "@/core/schema/items";
import { queueFor, speakableAnswer, speakableText, textOffsetOf } from "@/ui/speech-text";
import { runWith } from "../support/pipeline";

describe("what is spoken", () => {
  it("a glossary entry says its term first", async () => {
    const { result } = await runWith();
    const g = result.glossary.find((x) => x.envelope.term === "Dispatcher")?.envelope;
    expect(g && speakableText(g)).toBe(
      "Dispatcher. The component that hands the CPU to the chosen process.",
    );
  });

  it("a multiple-choice question reads its options, lettered", async () => {
    const { result } = await runWith();
    const q = result.questions.find(
      (x) => "qtype" in x.envelope && x.envelope.qtype === "mcq",
    )?.envelope;
    const text = q ? speakableText(q) : "";
    expect(text).toContain("A. RR behaves like FCFS.");
    expect(text).toContain("B. Context-switch overhead increases.");
    expect(text).toContain("D. Processes are never preempted.");
  });

  it("a true/false question is introduced as one, and never contains its answer", async () => {
    const { result } = await runWith();
    const q = result.questions.find(
      (x) => "qtype" in x.envelope && x.envelope.qtype === "true_false",
    )?.envelope as QuestionItem;
    expect(speakableText(q).startsWith("True or false: ")).toBe(true);
    expect(speakableText(q)).not.toContain("Answer");
  });

  it("no question reads its answer until the answer is asked for", async () => {
    const { result } = await runWith();
    for (const s of result.questions) {
      const q = s.envelope as QuestionItem;
      // "True"/"False" match the "True or false:" lead-in, and a multiple-choice answer is one of
      // the options read out, so for those the check is that nothing marks the right one.
      if (q.qtype === "short") expect(speakableText(q)).not.toContain(q.answer);
      else expect(speakableText(q)).not.toMatch(/\banswer\b|\bcorrect\b/i);
    }
    const first = result.questions[0]?.envelope as QuestionItem;
    expect(speakableAnswer(first)).toBe(`Answer: ${first.answer}`);
  });
});

describe("text offsets", () => {
  it("point at where the displayed text begins inside what is spoken", async () => {
    const { result } = await runWith();
    for (const s of [...result.summary, ...result.glossary, ...result.questions]) {
      const e = s.envelope;
      const spoken = speakableText(e);
      const at = textOffsetOf(e);
      expect(spoken.slice(at, at + e.text.length), e.itemId).toBe(e.text);
    }
  });
});

describe("queues", () => {
  it("contain only shown items, never a removed one", async () => {
    const { result } = await runWith();
    const removed = new Set(result.removed.map((r) => r.envelope.itemId));
    expect(removed.size).toBeGreaterThan(0);
    const queue = [
      ...queueFor(result.summary, (i) => i.envelope),
      ...queueFor(result.glossary, (i) => i.envelope),
      ...queueFor(result.questions, (i) => i.envelope),
    ];
    expect(queue.length).toBe(
      result.summary.length + result.glossary.length + result.questions.length,
    );
    for (const q of queue) expect(removed.has(q.id)).toBe(false);
    // and none of the removed wording is in what is said
    const said = queue.map((q) => q.text).join(" ");
    expect(said).not.toContain("most widely used");
    expect(said).not.toContain("impossible to implement");
  });

  it("use the plain wording only where a verified plain version exists", async () => {
    const { result } = await runWith(undefined, undefined, { plain: true });
    const pick = (i: (typeof result.summary)[number]) =>
      i.plain?.status === "simplified" ? i.plain.envelope : i.envelope;
    const queue = queueFor(result.summary, pick);
    const first = result.summary[0];
    expect(first?.plain?.status).toBe("simplified");
    expect(queue[0]?.text).toBe(
      first?.plain?.status === "simplified" ? first.plain.envelope.text : "",
    );
    // the rejected rewrite ("slowest") is never spoken; the FCFS item keeps its original wording
    expect(queue.map((q) => q.text).join(" ")).not.toContain("slowest");
  });
});
