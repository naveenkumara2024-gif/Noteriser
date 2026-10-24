import { err, ok, type Result } from "../ports/result";
import type { DocError } from "../schema/source";
import { cleanText } from "./clean";
import type { IngestResult } from "./types";

const FENCE = /^(```|~~~)/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST_PREFIX = /^(\s*(?:[-*+]|\d{1,3}[.)])\s+)(.*)$/;

function stripInline(s: string): string {
  return s
    .replace(/<!--.*?-->/g, "")
    .replace(/(?<!!)\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(?<![\p{L}\p{N}_])__(.+?)__(?![\p{L}\p{N}_])/gu, "$1")
    .replace(/(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?![*\w])/g, "$1")
    .replace(/(?<![\p{L}\p{N}_])_(?!\s)(.+?)(?<!\s)_(?![\p{L}\p{N}_])/gu, "$1")
    .replace(/~~(.+?)~~/g, "$1");
}

/** Strip emphasis, links, quotes and rules; leave headings, lists, tables and code fences for the segmenter. */
export function ingestMarkdown(raw: string): Result<IngestResult, DocError> {
  const text = cleanText(raw);
  if (text === "") return err({ code: "empty", message: "The input is empty." });

  let inFence = false;
  const out = text.split("\n").map((line) => {
    if (FENCE.test(line.trim())) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    if (RULE.test(line)) return "";

    const unquoted = line.replace(/^\s{0,3}(?:>\s?)+/, "");
    const heading = /^(#{1,6}\s+)(.*)$/.exec(unquoted);
    if (heading) return `${heading[1]}${stripInline(heading[2] ?? "")}`;
    const item = LIST_PREFIX.exec(unquoted);
    if (item) return `${item[1]}${stripInline(item[2] ?? "")}`;
    return stripInline(unquoted);
  });

  const cleaned = cleanText(out.join("\n"));
  if (cleaned === "") return err({ code: "empty", message: "The input is empty." });
  return ok({ text: cleaned, warnings: [] });
}
