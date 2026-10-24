import { describe, expect, it } from "vitest";
import {
  assessExtraction,
  ingestFile,
  ingestMarkdown,
  ingestPdf,
  ingestPlainText,
  parseDocument,
} from "@/core/ingest";
import { htmlToText } from "@/core/ingest/docx";
import { makeDocx } from "../../support/docx";
import { makePdf } from "../../support/pdf";

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

function text(r: Awaited<ReturnType<typeof ingestFile>>): string {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value.text;
}

describe("ingestMarkdown", () => {
  it("strips emphasis, code marks, links and block quotes but keeps structure", () => {
    const r = ingestMarkdown(
      [
        "# Title",
        "",
        "> A **bold** claim with `code`, *italic*, _more_ and [a link](http://x.test).",
        "",
        "- list **item**",
        "1. numbered _item_",
        "",
        "---",
        "",
        "| a | b |",
      ].join("\n"),
    );
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.text).toBe(
      [
        "# Title",
        "",
        "A bold claim with code, italic, more and a link.",
        "",
        "- list item",
        "1. numbered item",
        "",
        "| a | b |",
      ].join("\n"),
    );
  });

  it("leaves code fences untouched", () => {
    const r = ingestMarkdown("```\n**not emphasis** and *this*\n```");
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.text).toContain("**not emphasis** and *this*");
  });

  it("does not eat arithmetic stars or snake_case", () => {
    const r = ingestMarkdown("Compute 2 * 3 * 4 using ready_queue and next_burst.");
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.text).toBe("Compute 2 * 3 * 4 using ready_queue and next_burst.");
  });

  it("keeps images so the segmenter can flag them", () => {
    const r = ingestMarkdown("![diagram](queue.png)");
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.text).toBe("![diagram](queue.png)");
  });
});

describe("empty input", () => {
  it.each(["", "   ", "\n\n\t\n"])("is a typed error for %j", (input) => {
    for (const r of [ingestPlainText(input), ingestMarkdown(input)]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("empty");
    }
  });

  it("is a typed error end to end", async () => {
    const r = await parseDocument({ kind: "text", text: "  \n " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("empty");
  });
});

describe("ingestFile", () => {
  it("rejects unsupported types with a typed error", async () => {
    for (const name of ["notes.doc", "notes.rtf", "notes", "archive.tar.gz"]) {
      const r = await ingestFile(name, bytes("x"));
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("unsupported_type");
    }
  });

  it("strips a BOM and normalises CRLF in .txt", async () => {
    const t = text(await ingestFile("n.TXT", bytes("﻿Line one.\r\nLine two.\r\n")));
    expect(t).toBe("Line one.\nLine two.");
  });

  it("warns when a text file is not valid UTF-8", async () => {
    const r = await ingestFile("bad.txt", new Uint8Array(400).fill(0xff));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.warnings.map((w) => w.kind)).toEqual(["noisy_extraction"]);
  });
});

describe("assessExtraction", () => {
  it("accepts ordinary prose", () => {
    const prose = Array.from(
      { length: 15 },
      () => "This is a perfectly ordinary line of lecture prose.",
    ).join("\n");
    expect(assessExtraction(prose)).toEqual([]);
  });

  it("flags very short average lines (columns / tables / scans)", () => {
    const w = assessExtraction(Array.from({ length: 14 }, () => "ab cd").join("\n"));
    expect(w).toHaveLength(1);
    expect(w[0]?.kind).toBe("noisy_extraction");
    expect(w[0]?.detail).toContain("short");
  });

  it("flags symbol-heavy text", () => {
    const w = assessExtraction("∑∫≈≠∞∂".repeat(60));
    expect(w.some((x) => x.detail.includes("symbols"))).toBe(true);
  });

  it("flags undecodable characters", () => {
    const w = assessExtraction(`${"word ".repeat(80)}${"�".repeat(10)}`);
    expect(w.some((x) => x.detail.includes("could not be decoded"))).toBe(true);
  });

  it("does not warn on tiny inputs", () => {
    expect(assessExtraction("ab\ncd")).toEqual([]);
  });
});

describe("PDF", () => {
  it("extracts text and joins soft-wrapped lines into sentences", async () => {
    const pdf = makePdf([
      "The scheduler selects the next process",
      "from the ready queue every time.",
      "It then runs that process.",
    ]);
    const r = await parseDocument({ kind: "file", name: "notes.pdf", bytes: pdf });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.sentences.map((s) => s.text)).toEqual([
      "The scheduler selects the next process from the ready queue every time.",
      "It then runs that process.",
    ]);
  });

  it("returns a typed error for a PDF with no text layer (scan)", async () => {
    const r = await ingestPdf(makePdf([]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("empty");
      expect(r.error.message).toContain("scan");
    }
  });

  it("returns a typed error for bytes that are not a PDF", async () => {
    const r = await ingestPdf(bytes("definitely not a pdf"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("extraction_failed");
  });

  it("does not consume the caller's buffer", async () => {
    const pdf = makePdf(["Some text lives here."]);
    await ingestPdf(pdf);
    expect(pdf.byteLength).toBeGreaterThan(0);
    const again = await ingestPdf(pdf);
    expect(again.ok).toBe(true);
  });
});

describe("DOCX", () => {
  it("maps Word headings to sections and flags tables", async () => {
    const docx = makeDocx([
      { heading: 1, text: "Lecture Title" },
      { heading: 2, text: "First topic" },
      { p: "Waiting time is the total time spent in the ready queue." },
      {
        table: [
          ["Algorithm", "Wait"],
          ["FCFS", "10"],
        ],
      },
      { heading: 2, text: "Second topic" },
      { p: "Throughput counts completed processes. R&D teams measure it." },
    ]);
    const r = await parseDocument({ kind: "file", name: "lecture.docx", bytes: docx });
    if (!r.ok) throw new Error(r.error.message);
    const doc = r.value;

    expect(doc.title).toBe("Lecture Title");
    expect(doc.sections.map((s) => s.title)).toEqual(["First topic", "Second topic"]);
    expect(doc.sentences.map((s) => s.text)).toEqual([
      "Waiting time is the total time spent in the ready queue.",
      "Throughput counts completed processes.",
      "R&D teams measure it.",
    ]);
    const w = doc.warnings.find((x) => x.kind === "not_processed");
    expect(w?.detail).toContain("table not processed");
    expect(w?.location?.afterSentenceId).toBe("S1.1");
  });

  it("returns a typed error for bytes that are not a DOCX", async () => {
    const r = await ingestFile("x.docx", bytes("not a zip"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("extraction_failed");
  });

  it("decodes entities exactly once", () => {
    expect(htmlToText("<p>a &amp;lt; b &amp; c &lt;d&gt; &#233; &#x41;</p>")).toContain(
      "a &lt; b & c <d> é A",
    );
  });

  it("maps images, lists and line breaks", () => {
    const out = htmlToText(
      '<h2>Topic</h2><ul><li>One</li><li>Two<br />more</li></ul><p><img src="x" /></p>',
    );
    expect(out).toContain("## Topic");
    expect(out).toContain("- One");
    expect(out).toContain("- Two more");
    expect(out).toContain("![image](docx)");
  });
});
