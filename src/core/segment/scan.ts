export type ExcludedKind = "table" | "latex" | "code block" | "image";

export type ScanItem =
  | { type: "blank" }
  | { type: "heading"; title: string; level: number; line: number }
  | { type: "excluded"; what: ExcludedKind; preview: string; lineCount: number; line: number }
  | { type: "line"; text: string; bullet: boolean; indent: number; line: number };

const MD_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const SECTION_HEADING = /^section\s+\d+\s*[:.\-–—]\s*(\S.*)$/i;
const NUMBERED_HEADING = /^(\d{1,2})[.)]\s+(\S.*)$/;
const NUMBERED_ITEM = /^\s*\d{1,2}[.)]\s/;
const LIST_ITEM = /^(\s*)(?:[-*+•▪◦‣]|\d{1,3}[.)])\s+(\S.*)$/;
const IMAGE_ONLY = /^!\[[^\]]*\]\([^)]*\)$/;
const IMAGE_INLINE = /!\[[^\]]*\]\([^)]*\)/g;
const FENCE = /^(```|~~~)/;
const MAX_NUMBERED_HEADING_WORDS = 10;

/** Strip numbering and trailing markup so titles read cleanly ("1. What is X?" -> "What is X?"). */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/^section\s+\d+\s*[:.\-–—]\s*/i, "")
    .replace(/^\d{1,2}[.)]\s+/, "")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const isTableRow = (s: string): boolean => (s.match(/\|/g)?.length ?? 0) >= 2;

function latexEnd(trimmed: string): { single: boolean; end: string } | undefined {
  if (trimmed.startsWith("$$")) {
    return { single: trimmed.length >= 4 && trimmed.endsWith("$$"), end: "$$" };
  }
  if (trimmed.startsWith("\\[")) return { single: trimmed.includes("\\]"), end: "\\]" };
  const env = /^\\begin\{([^}]+)\}/.exec(trimmed);
  if (env) {
    const end = `\\end{${env[1]}}`;
    return { single: trimmed.includes(end), end };
  }
  return undefined;
}

function nextNonBlank(lines: string[], from: number): string | undefined {
  for (let i = from; i < lines.length; i++) {
    const l = lines[i];
    if (l !== undefined && l.trim() !== "") return l;
  }
  return undefined;
}

/**
 * Classify physical lines. Anything that cannot be turned into sentences (tables, LaTeX, code,
 * images) becomes an `excluded` item so the caller can warn instead of dropping it silently.
 */
export function scan(text: string): ScanItem[] {
  const lines = text.split("\n");
  const items: ScanItem[] = [];

  let fence: { marker: string; start: number; count: number; preview: string } | undefined;
  let latex: { end: string; start: number; count: number; preview: string } | undefined;
  let table: { start: number; count: number; preview: string } | undefined;
  let prevNonBlank: string | undefined;

  const flushTable = (): void => {
    if (!table) return;
    items.push({
      type: "excluded",
      what: "table",
      preview: table.preview,
      lineCount: table.count,
      line: table.start,
    });
    table = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    const lineNo = i + 1;

    if (fence) {
      fence.count++;
      if (trimmed.startsWith(fence.marker)) {
        items.push({
          type: "excluded",
          what: "code block",
          preview: fence.preview,
          lineCount: fence.count,
          line: fence.start,
        });
        fence = undefined;
      }
      continue;
    }
    if (latex) {
      latex.count++;
      if (trimmed.includes(latex.end)) {
        items.push({
          type: "excluded",
          what: "latex",
          preview: latex.preview,
          lineCount: latex.count,
          line: latex.start,
        });
        latex = undefined;
      }
      continue;
    }

    if (isTableRow(trimmed)) {
      if (table) table.count++;
      else table = { start: lineNo, count: 1, preview: trimmed.slice(0, 60) };
      prevNonBlank = raw;
      continue;
    }
    flushTable();

    if (trimmed === "") {
      items.push({ type: "blank" });
      continue;
    }

    const fenceMatch = FENCE.exec(trimmed);
    if (fenceMatch?.[1]) {
      fence = { marker: fenceMatch[1], start: lineNo, count: 1, preview: trimmed.slice(0, 60) };
      prevNonBlank = raw;
      continue;
    }

    const tex = latexEnd(trimmed);
    if (tex) {
      if (tex.single) {
        items.push({
          type: "excluded",
          what: "latex",
          preview: trimmed.slice(0, 60),
          lineCount: 1,
          line: lineNo,
        });
      } else {
        latex = { end: tex.end, start: lineNo, count: 1, preview: trimmed.slice(0, 60) };
      }
      prevNonBlank = raw;
      continue;
    }

    if (IMAGE_ONLY.test(trimmed)) {
      items.push({
        type: "excluded",
        what: "image",
        preview: trimmed.slice(0, 60),
        lineCount: 1,
        line: lineNo,
      });
      prevNonBlank = raw;
      continue;
    }

    const md = MD_HEADING.exec(trimmed);
    if (md?.[1] && md[2] !== undefined) {
      const title = cleanTitle(md[2]);
      if (title) items.push({ type: "heading", title, level: md[1].length, line: lineNo });
      prevNonBlank = raw;
      continue;
    }

    const sec = SECTION_HEADING.exec(trimmed);
    if (sec?.[1]) {
      items.push({ type: "heading", title: cleanTitle(sec[1]), level: 2, line: lineNo });
      prevNonBlank = raw;
      continue;
    }

    const num = NUMBERED_HEADING.exec(trimmed);
    if (num?.[2]) {
      const title = num[2];
      const next = nextNonBlank(lines, i + 1);
      const isHeading =
        title.split(/\s+/).length <= MAX_NUMBERED_HEADING_WORDS &&
        !/[.;,]$/.test(title) &&
        next !== undefined &&
        !NUMBERED_ITEM.test(next) &&
        !(prevNonBlank !== undefined && NUMBERED_ITEM.test(prevNonBlank));
      if (isHeading) {
        items.push({ type: "heading", title: cleanTitle(title), level: 2, line: lineNo });
        prevNonBlank = raw;
        continue;
      }
    }

    // Inline images inside prose: drop the markup, but say so.
    let body = raw;
    const inlineImage = body.match(IMAGE_INLINE)?.[0];
    if (inlineImage) {
      items.push({
        type: "excluded",
        what: "image",
        preview: inlineImage.slice(0, 60),
        lineCount: 1,
        line: lineNo,
      });
      body = body.replace(IMAGE_INLINE, " ");
      if (body.trim() === "") {
        prevNonBlank = raw;
        continue;
      }
    }

    const item = LIST_ITEM.exec(body);
    if (item?.[2] !== undefined) {
      items.push({
        type: "line",
        text: item[2].trim(),
        bullet: true,
        indent: item[1]?.length ?? 0,
        line: lineNo,
      });
    } else {
      items.push({
        type: "line",
        text: body.trim(),
        bullet: false,
        indent: body.length - body.trimStart().length,
        line: lineNo,
      });
    }
    prevNonBlank = raw;
  }

  flushTable();
  if (fence) {
    items.push({
      type: "excluded",
      what: "code block",
      preview: fence.preview,
      lineCount: fence.count,
      line: fence.start,
    });
  }
  if (latex) {
    items.push({
      type: "excluded",
      what: "latex",
      preview: latex.preview,
      lineCount: latex.count,
      line: latex.start,
    });
  }
  return items;
}
