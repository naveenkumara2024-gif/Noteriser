import { describe, expect, it } from "vitest";
import { parseDocument } from "@/core/ingest";
import { simplifyPrompt } from "@/core/plain";
import { countSyllables, readability } from "@/core/readability";
import { lecture7Fakes, lecture7Llm } from "@/demo";
import { fail } from "@/llm/fake";
import { invariantViolations, LECTURE7, runWith } from "../../support/pipeline";

describe("readability", () => {
  it("counts syllables by vowel groups and ignores a silent final e", () => {
    expect(countSyllables("cat")).toBe(1);
    expect(countSyllables("scheduling")).toBe(3);
    expect(countSyllables("process")).toBe(2);
    expect(countSyllables("make")).toBe(1);
    expect(countSyllables("")).toBe(0);
  });

  it("scores short plain sentences far below long technical ones", () => {
    const plain = readability("The cat sat. The dog ran. We like it.");
    const dense = readability(
      "Preemptive multiprogramming implementations necessitate considerable synchronisation infrastructure, notwithstanding architectural considerations.",
    );
    expect(plain.grade).toBeLessThan(2);
    expect(dense.grade).toBeGreaterThan(15);
    expect(plain.sentences).toBe(3);
    expect(plain.averageSentenceLength).toBeCloseTo(3);
  });

  it("splitting one long sentence into short ones lowers the grade without changing a word", () => {
    const long = readability(
      "CPU scheduling decides which process gets the CPU next and it keeps the CPU busy and it gives acceptable response times.",
    );
    const split = readability(
      "CPU scheduling decides which process gets the CPU next. It keeps the CPU busy. It gives acceptable response times.",
    );
    expect(split.grade).toBeLessThan(long.grade);
  });

  it("scores empty text 0 and never goes negative", () => {
    expect(readability("").grade).toBe(0);
    expect(readability("Go. Go. Go. Go.").grade).toBeGreaterThanOrEqual(0);
  });
});

describe("plain-language mode on the lecture-7 scenario", () => {
  const plainRun = () => runWith(undefined, LECTURE7, { plain: true });

  it("is off unless asked: no plain fields, no plain stage", async () => {
    const h = await runWith();
    expect(h.result.plain).toBeUndefined();
    expect(h.result.summary.every((s) => s.plain === undefined)).toBe(true);
    expect(h.events.some((e) => e.type === "stage" && e.stage === "plain")).toBe(false);
  });

  it("lowers the average readability grade strictly, and states the numbers", async () => {
    const { result } = await plainRun();
    const p = result.plain;
    expect(p).toBeDefined();
    expect(p?.attempted).toBe(19);
    expect(p?.simplified).toBeGreaterThan(0);
    expect(p?.simplified).toBe(11);
    expect((p?.simplified ?? 0) + (p?.unchanged ?? 0) + (p?.keptOriginal ?? 0)).toBe(p?.attempted);
    expect(p?.gradeAfter).toBeLessThan(p?.gradeBefore ?? 0);
  });

  it("verifies every offered rewrite in full, and every one is easier to read", async () => {
    const h = await plainRun();
    expect(invariantViolations(h)).toEqual([]);
    const simplified = [...h.result.summary, ...h.result.glossary, ...h.result.questions].filter(
      (s) => s.plain?.status === "simplified",
    );
    expect(simplified.length).toBeGreaterThan(5);
    for (const s of simplified) {
      expect(s.plain?.status === "simplified" && s.plain.envelope.verdict).toBe("SUPPORTED");
    }
  });

  it("keeps the original when the rewrite adds a claim the notes do not make", async () => {
    const { result } = await plainRun();
    const fcfs = result.summary.find((s) => s.envelope.text.startsWith("FCFS runs processes"));
    expect(fcfs?.plain).toMatchObject({
      status: "kept_original",
      reason: "the simplified version could not be verified",
    });
    // the original wording is untouched and still the item's text
    expect(fcfs?.envelope.text).toContain("convoy effect, where short processes wait");
    expect(fcfs?.envelope.verdict).toBe("SUPPORTED");
  });

  it("keeps the original when no simplified version can be written (and it stays flagged)", async () => {
    const { result } = await plainRun();
    const pre = result.glossary.find((s) => s.envelope.term === "Preemption");
    expect(pre?.flagged).toBe(true);
    expect(pre?.plain).toMatchObject({
      status: "kept_original",
      reason: "the simplified version could not be written",
    });
  });

  it("reports already-plain items as unchanged, not as simplified", async () => {
    const { result } = await plainRun();
    const latency = result.glossary.find((s) => s.envelope.term === "Dispatch latency");
    expect(latency?.plain?.status).toBe("unchanged");
  });

  it("does not change what is shown, the removed list, or the report counts", async () => {
    const base = await runWith();
    const plain = await plainRun();
    const strip = (r: typeof base.result) => ({
      summary: r.summary.map((s) => s.envelope),
      glossary: r.glossary.map((s) => s.envelope),
      questions: r.questions.map((s) => s.envelope),
      removed: r.removed.map((x) => x.envelope.itemId),
      counts: { ...r.report, usage: undefined },
    });
    expect(strip(plain.result)).toEqual(strip(base.result));
  });

  it("counts the extra model use in the run's usage", async () => {
    const base = await runWith();
    const plain = await plainRun();
    expect(plain.result.report.usage.inputTokens).toBeGreaterThan(
      base.result.report.usage.inputTokens,
    );
  });

  it("emits a plain stage after assemble and one event per item", async () => {
    const h = await plainRun();
    const stages = h.events
      .filter((e) => e.type === "stage")
      .map((e) => `${e.type === "stage" && e.stage}:${e.type === "stage" && e.status}`);
    expect(stages.slice(-4)).toEqual([
      "assemble:start",
      "assemble:end",
      "plain:start",
      "plain:end",
    ]);
    expect(h.events.filter((e) => e.type === "plain")).toHaveLength(19);
    const seqs = h.events.map((e) => e.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it("never offers a simplified version when the judge is down (nothing can be SUPPORTED)", async () => {
    const llm = lecture7Llm({ submit_verdict: fail("provider", "judge unavailable") });
    const h = await runWith({ llm, nli: lecture7Fakes().nli }, LECTURE7, { plain: true });
    expect(h.result.degraded).toBe(true);
    expect(h.result.plain?.simplified).toBe(0);
    expect(invariantViolations(h)).toEqual([]);
  });

  it("is skipped for a cancelled run, which stays incomplete", async () => {
    const controller = new AbortController();
    const h = await runWith(
      {
        signal: controller.signal,
        onEvent: (e) => {
          if (e.type === "stage" && e.stage === "plain" && e.status === "start") controller.abort();
        },
      },
      LECTURE7,
      { plain: true },
    );
    expect(h.result.status).toBe("incomplete");
    expect(h.events.find((e) => e.type === "error")).toMatchObject({ code: "aborted" });
  });
});

describe("simplify prompt", () => {
  it("asks for short sentences and the notes' own words, and carries the item and the source", async () => {
    const parsed = await parseDocument({ kind: "text", text: LECTURE7 });
    if (!parsed.ok) throw new Error("fixture must parse");
    const prompt = simplifyPrompt(
      {
        itemId: "sum-1",
        type: "summary_point",
        scope: "section:1",
        sourceIds: ["S1.1"],
        evidenceQuote: "decide which process",
        text: "CPU scheduling decides which process gets the CPU.",
        idsExist: true,
        problems: [],
      },
      parsed.value,
    );
    expect(prompt.system).toContain("at most 15 words");
    expect(prompt.system).toMatch(/technical term/i);
    expect(prompt.system).toMatch(/no new numbers|Add no new/i);
    expect(prompt.user).toContain("<item_to_simplify>");
    expect(prompt.user).toContain("[S1.1]");
  });
});
