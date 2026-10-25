import { beforeAll, describe, expect, it } from "vitest";
import {
  AUDIT_FORMAT,
  escapeMarkdown,
  FLAGGED_TAG,
  renderAnkiTsv,
  renderAuditJson,
  renderMarkdown,
  renderText,
  tsvField,
} from "@/core/export";
import type { RunResult } from "@/core/pipeline";
import type { QuestionItem } from "@/core/schema/items";
import { expectGolden } from "../../support/golden";
import { type Harness, runWith } from "../../support/pipeline";
import { parseTsv } from "../../support/tsv";

const GENERATED_AT = "2026-10-24T12:00:00.000Z";
const opts = { generatedAt: GENERATED_AT };

let h: Harness;
let plain: Harness;
beforeAll(async () => {
  h = await runWith();
  plain = await runWith(undefined, undefined, { plain: true });
});

/** `[S2.4]` citations that are live (not escaped as `\[S2.4\]`). */
const citations = (md: string): string[] =>
  [...md.matchAll(/(?<!\\)\[(S\d+\.\d+)\]/g)].map((m) => m[1] ?? "");

const between = (md: string, from: string, to?: string): string => {
  const a = md.indexOf(from);
  const b = to ? md.indexOf(to, a + from.length) : md.length;
  return md.slice(a, b < 0 ? md.length : b);
};

describe("golden files for the lecture-7 result", () => {
  it("markdown", () => expectGolden("lecture7.md", renderMarkdown(h.result, opts)));
  it("plain text", () => expectGolden("lecture7.txt", renderText(h.result, opts)));
  it("anki tsv", () => expectGolden("lecture7.tsv", renderAnkiTsv(h.result)));
  it("anki tsv with flagged items", () =>
    expectGolden("lecture7-flagged.tsv", renderAnkiTsv(h.result, { includeFlagged: true })));
  it("markdown in plain-language wording", () =>
    expectGolden("lecture7-plain.md", renderMarkdown(plain.result, { ...opts, wording: "plain" })));
});

describe("markdown", () => {
  it("is deterministic: the same result gives the same bytes", () => {
    expect(renderMarkdown(h.result, opts)).toBe(renderMarkdown(h.result, opts));
  });

  it("has the notice, the sections in order, the report and both appendices", () => {
    const md = renderMarkdown(h.result, opts);
    expect(md).toContain(
      "> Generated from instructor-approved notes. Check flagged items against the source.",
    );
    const order = [
      "# Lecture 7: CPU Scheduling Basics",
      "## Summary",
      "## Glossary",
      "## Practice questions",
      "## Answer key",
      "## Run report",
      "## Appendix A: Removed items",
      "## Appendix B: Source sentences",
    ].map((heading) => md.indexOf(heading));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(md).toContain("Counts reconcile: every generated item is shown or listed as removed");
  });

  it("citation round trip: every [S..] exists once in the source appendix, with the stored sentence text", () => {
    const md = renderMarkdown(h.result, opts);
    const appendix = between(md, "## Appendix B: Source sentences");
    const listed = [...appendix.matchAll(/^- (S\d+\.\d+) — (.*)$/gm)].map(
      (m) => [m[1], m[2]] as const,
    );

    // each cited sentence appears once, and the text is exactly the stored sentence
    expect(new Set(listed.map(([id]) => id)).size).toBe(listed.length);
    const stored = new Map(h.result.doc?.sentences.map((s) => [s.id, s.text]));
    for (const [id, text] of listed)
      expect(text, id).toBe(escapeMarkdown(stored.get(id ?? "") ?? ""));

    const cited = new Set(citations(md.slice(0, md.indexOf("## Appendix B"))));
    expect(cited.size).toBeGreaterThan(10);
    for (const id of cited)
      expect(
        listed.map(([i]) => i),
        id,
      ).toContain(id);
    // and nothing is listed that nothing cites
    for (const [id] of listed) expect(cited.has(id ?? ""), id).toBe(true);
  });

  it("never shows a removed item outside its appendix", () => {
    const md = renderMarkdown(h.result, opts);
    const main = md.slice(0, md.indexOf("## Appendix A"));
    const appendix = between(md, "## Appendix A", "## Appendix B");
    const shownTexts = new Set(
      [...h.result.summary, ...h.result.glossary, ...h.result.questions].map(
        (s) => s.envelope.text,
      ),
    );
    for (const r of h.result.removed) {
      // a duplicate can legitimately repeat the wording of the item that was kept
      if (shownTexts.has(r.envelope.text)) continue;
      expect(main, r.envelope.itemId).not.toContain(r.envelope.text);
      expect(appendix, r.envelope.itemId).toContain(r.envelope.text);
    }
    expect(appendix).toContain("sum-7");
    expect(main).not.toContain("most widely used");
    expect(main).not.toContain("impossible to implement");
  });

  it("every flagged item has the literal warning line, and nothing else does", () => {
    const md = renderMarkdown(h.result, opts);
    const flagged = [...h.result.summary, ...h.result.glossary, ...h.result.questions].filter(
      (s) => s.flagged,
    );
    expect(flagged.length).toBeGreaterThan(0);
    const lines = md.split("\n").filter((l) => l.trim().startsWith("⚠ Check against source — "));
    expect(lines).toHaveLength(flagged.length);
    expect(lines[0]).toContain("Only partly supported by the cited text");
  });

  it("keeps answers out of the questions and in a separate answer key", () => {
    const md = renderMarkdown(h.result, opts);
    const questions = between(md, "## Practice questions", "## Answer key");
    const key = between(md, "## Answer key", "## Run report");
    for (const q of h.result.questions) {
      const e = q.envelope as QuestionItem;
      if (e.qtype === "short") {
        expect(questions).not.toContain(e.answer);
        expect(key).toContain(e.answer);
      }
    }
    // numbered the same as the questions
    expect(key.match(/^\d+\./gm)).toHaveLength(h.result.questions.length);
    expect(questions).toContain("   - A. RR behaves like FCFS");
  });

  it("states a degraded, incomplete or failed run at the top", () => {
    const base = structuredClone(h.result);
    expect(renderMarkdown({ ...base, degraded: true }, opts)).toContain("> ⚠ Verifier degraded");
    expect(renderMarkdown({ ...base, status: "incomplete" }, opts)).toContain(
      "> ⚠ This run was stopped",
    );
    expect(renderMarkdown({ ...base, status: "failed" }, opts)).toContain(
      "> ⚠ This run could not produce",
    );
  });

  it("escapes Markdown in item text so it cannot fake a citation or a heading", () => {
    const r: RunResult = structuredClone(h.result);
    const s = r.summary[0];
    if (!s) throw new Error("fixture has a summary");
    s.envelope.text = "# Not a heading [S9.9] *bold* _under_ `code` <b>tag</b>";
    const md = renderMarkdown(r, opts);
    expect(md).toContain(
      "1. \\# Not a heading \\[S9.9\\] \\*bold\\* \\_under\\_ \\`code\\` \\<b\\>tag\\</b\\>",
    );
    expect(citations(md)).not.toContain("S9.9");
  });

  it("writes a run with no source (a failed run) without throwing", () => {
    const failed: RunResult = {
      ...structuredClone(h.result),
      doc: undefined,
      summary: [],
      glossary: [],
      questions: [],
      removed: [],
      status: "failed",
    };
    const md = renderMarkdown(failed, opts);
    expect(md).toContain("# Study aids");
    expect(md).toContain("_Nothing in this section passed the checks._");
  });
});

describe("plain-language wording", () => {
  it("uses a verified plain version where there is one and the original where not, and says so", () => {
    const md = renderMarkdown(plain.result, { ...opts, wording: "plain" });
    expect(md).toContain("Plain-language wording: each rewrite was checked against the source");
    expect(md).toContain(
      "CPU scheduling decides which process gets the CPU next. It keeps the CPU busy.",
    );
    // the rewrite the verifier rejected is not exported; the original is, with the reason
    expect(md).not.toContain("slowest method");
    expect(md).toContain("FCFS runs processes in arrival order and can cause the convoy effect");
    expect(md).toContain("_Kept original wording: the simplified version could not be verified._");
  });

  it("keeps flags and the citation round trip in plain wording", () => {
    const md = renderMarkdown(plain.result, { ...opts, wording: "plain" });
    expect(
      md.split("\n").filter((l) => l.trim().startsWith("⚠ Check against source — ")),
    ).toHaveLength(1);
    const listed = new Set([...md.matchAll(/^- (S\d+\.\d+) — /gm)].map((m) => m[1]));
    for (const id of citations(md.slice(0, md.indexOf("## Appendix B"))))
      expect(listed.has(id)).toBe(true);
  });

  it("falls back to the original wording when the run has no plain versions", () => {
    expect(renderMarkdown(h.result, { ...opts, wording: "plain" })).toBe(
      renderMarkdown(h.result, opts),
    );
  });
});

describe("plain text", () => {
  it("has no Markdown markup, flags as WARNING lines, and the same items", () => {
    const txt = renderText(h.result, opts);
    expect(txt).not.toMatch(/\*\*|^#|`|\[S\d/m);
    expect(
      txt.split("\n").filter((l) => l.trim().startsWith("WARNING: Check against source - ")),
    ).toHaveLength(1);
    expect(txt).toContain(
      "Generated from instructor-approved notes. Check flagged items against the source.",
    );
    expect(txt).toContain("1. CPU scheduling decides which process in the ready queue");
    expect(txt).toContain("(Source: S1.1, S1.2)");
    expect(txt).toContain("A. RR behaves like FCFS");
  });

  it("never shows a removed item before the appendix", () => {
    const txt = renderText(h.result, opts);
    const main = txt.slice(0, txt.indexOf("APPENDIX A"));
    expect(main).not.toContain("most widely used");
    expect(main).not.toContain("impossible to implement");
    expect(main).not.toContain("typical time quantum");
  });
});

describe("anki tsv", () => {
  it("has the three header lines and one row per unflagged glossary term and question", () => {
    const { headers, rows } = parseTsv(renderAnkiTsv(h.result));
    expect(headers).toEqual(["#separator:tab", "#html:false", "#tags column:3"]);
    const unflagged = [...h.result.glossary, ...h.result.questions].filter((s) => !s.flagged);
    expect(rows).toHaveLength(unflagged.length);
    expect(rows.every((r) => r.length === 3)).toBe(true);
    // no summary points, and the flagged Preemption entry is excluded by default
    expect(rows.map((r) => r[0]).join("|")).not.toContain("Preemption");
    expect(rows.find((r) => r[0] === "Dispatcher")).toEqual([
      "Dispatcher",
      "The component that hands the CPU to the chosen process.",
      "S1.3",
    ]);
  });

  it("can include flagged items, tagging them so they can be found in Anki", () => {
    const { rows } = parseTsv(renderAnkiTsv(h.result, { includeFlagged: true }));
    const pre = rows.find((r) => r[0] === "Preemption");
    expect(pre?.[2]).toBe(`S3.5 ${FLAGGED_TAG}`);
    expect(rows).toHaveLength(h.result.glossary.length + h.result.questions.length);
  });

  it("puts a multiple-choice question's options on the front and only the answer on the back", () => {
    const { rows } = parseTsv(renderAnkiTsv(h.result));
    const mcq = rows.find((r) => r[0]?.startsWith("In Round Robin"));
    expect(mcq?.[0]).toBe(
      "In Round Robin, what happens if the time quantum is made very small?\nA. RR behaves like FCFS\nB. Context-switch overhead increases\nC. Throughput becomes zero\nD. Processes are never preempted",
    );
    expect(mcq?.[1]).toBe("Context-switch overhead increases");
    expect(mcq?.[2]).toBe("S3.6");
  });

  it("round-trips awkward text: quotes and a leading # survive; whitespace is collapsed to one line", () => {
    const r: RunResult = structuredClone(h.result);
    const nasty = [
      { term: "Tab\tterm", text: 'He said "stop"\nthen\tleft' },
      { term: "#hash first", text: "starts with a hash" },
      { term: '"quoted" start', text: 'ends with "quotes"' },
      { term: "a, b; c", text: "commas, semicolons; and 'apostrophes'" },
    ];
    r.glossary = nasty.map((n, i) => {
      const base = structuredClone(h.result.glossary[0]);
      if (!base) throw new Error("fixture has glossary");
      base.envelope = { ...base.envelope, itemId: `glo-x${i}`, term: n.term, text: n.text };
      base.flagged = false;
      return base;
    });
    r.questions = [];
    const { rows } = parseTsv(renderAnkiTsv(r));
    expect(rows.map((row) => row.slice(0, 2))).toEqual([
      ["Tab term", 'He said "stop" then left'],
      ["#hash first", "starts with a hash"],
      ['"quoted" start', 'ends with "quotes"'],
      ["a, b; c", "commas, semicolons; and 'apostrophes'"],
    ]);
  });

  it("the field writer and an independent reader agree on tabs, line breaks and quotes", () => {
    const fields = ["tab\there", "line\nbreak", 'quote " inside', "#starts with hash", "", "plain"];
    const line = fields.map(tsvField).join("\t");
    expect(parseTsv(`${line}\n`).rows).toEqual([fields]);
  });

  it("tsvField quotes exactly when it must", () => {
    expect(tsvField("plain text")).toBe("plain text");
    expect(tsvField("a\tb")).toBe('"a\tb"');
    expect(tsvField("a\nb")).toBe('"a\nb"');
    expect(tsvField('say "hi"')).toBe('"say ""hi"""');
    expect(tsvField("#comment")).toBe('"#comment"');
  });
});

describe("audit json", () => {
  it("is labelled, parseable and carries drafts, verifications, rejections and usage", async () => {
    const stored = await h.store.getRun(h.result.runId);
    if (!stored) throw new Error("run is stored");
    const audit = JSON.parse(renderAuditJson(stored));

    expect(audit.format).toBe(AUDIT_FORMAT);
    expect(audit.contains_source_text).toBe(true);
    expect(audit.source.sentences).toHaveLength(15);
    expect(audit.drafts.length).toBeGreaterThanOrEqual(24);
    expect(audit.verifications.length).toBeGreaterThanOrEqual(24);
    expect(audit.removed).toHaveLength(5);
    expect(audit.removed.every((r: { reasons: string[] }) => r.reasons.length > 0)).toBe(true);
    expect(audit.shown.summary).toHaveLength(h.result.summary.length);
    expect(audit.usage.inputTokens).toBe(h.result.report.usage.inputTokens);
    expect(audit.report.reconciles).toBe(true);
    // scores for every shown item, so a reviewer can see why it was accepted
    expect(audit.shown.glossary[0].envelope.scores).toHaveProperty("entailment");
  });
});
