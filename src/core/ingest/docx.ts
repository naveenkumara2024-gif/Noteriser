import mammoth from "mammoth";
import { err, ok, type Result } from "../ports/result";
import type { DocError } from "../schema/source";
import { cleanText } from "./clean";
import type { IngestResult } from "./types";

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&(?:lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

const stripTags = (s: string): string => s.replace(/<[^>]+>/g, "");
// Entities are decoded once, at the very end, so "&amp;lt;" correctly stays the literal text "&lt;".
const oneLine = (s: string): string => stripTags(s).replace(/\s+/g, " ").trim();

/**
 * mammoth emits small, well-formed HTML. Map it to the Markdown-ish text the segmenter reads:
 * headings -> `#`, list items -> `-`, table rows -> `| a | b |` (so tables get flagged), images -> `![]()`.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    stripTags(
      html
        // First: a later block handler would otherwise strip <br> and fuse the words around it.
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<img\b[^>]*>/gi, "\n\n![image](docx)\n\n")
        .replace(/<h([1-6])\b[^>]*>(.*?)<\/h\1>/gis, (_, n: string, inner: string) => {
          const title = oneLine(inner);
          return title ? `\n\n${"#".repeat(Number(n))} ${title}\n\n` : "\n\n";
        })
        .replace(/<tr\b[^>]*>(.*?)<\/tr>/gis, (_, row: string) => {
          const cells = [...row.matchAll(/<t[dh]\b[^>]*>(.*?)<\/t[dh]>/gis)].map((m) =>
            oneLine(m[1] ?? ""),
          );
          return `\n| ${cells.join(" | ")} |\n`;
        })
        .replace(/<li\b[^>]*>(.*?)<\/li>/gis, (_, inner: string) => `\n- ${oneLine(inner)}\n`)
        .replace(/<p\b[^>]*>(.*?)<\/p>/gis, (_, inner: string) => `\n\n${oneLine(inner)}\n\n`),
    ),
  );
}

export async function ingestDocx(bytes: Uint8Array): Promise<Result<IngestResult, DocError>> {
  let html: string;
  try {
    ({ value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) }));
  } catch (e) {
    return err({
      code: "extraction_failed",
      message: `Could not read this DOCX: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  const text = cleanText(htmlToText(html));
  if (text === "") return err({ code: "empty", message: "This DOCX contains no text." });
  return ok({ text, warnings: [] });
}
