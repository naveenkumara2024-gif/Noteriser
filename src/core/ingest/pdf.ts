import { extractText } from "unpdf";
import { err, ok, type Result } from "../ports/result";
import type { DocError, DocWarning } from "../schema/source";
import { cleanText } from "./clean";
import type { IngestResult } from "./types";

const MIN_LINES_FOR_LINE_LENGTH_CHECK = 10;
const SHORT_AVG_LINE = 25;
const SYMBOL_RATIO_LIMIT = 0.25;
const GARBLED_RATIO_LIMIT = 0.01;
const MIN_CHARS_FOR_RATIO_CHECKS = 200;
const ORDINARY_PUNCTUATION = /[.,;:!?'"()\-–—’“”]/;

/**
 * Heuristics for text that probably did not extract cleanly (columns, tables, scans, bad encodings).
 * Pure so it can be tested without a PDF.
 */
export function assessExtraction(text: string): DocWarning[] {
  const warnings: DocWarning[] = [];
  const noisy = (detail: string): void => {
    warnings.push({ kind: "noisy_extraction", detail });
  };

  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length >= MIN_LINES_FOR_LINE_LENGTH_CHECK) {
    const avg = lines.reduce((n, l) => n + l.trim().length, 0) / lines.length;
    if (avg < SHORT_AVG_LINE) {
      noisy(
        `Lines are very short on average (${avg.toFixed(0)} characters), which suggests columns, tables or a scanned layout.`,
      );
    }
  }

  const chars = [...text].filter((c) => !/\s/.test(c));
  if (chars.length >= MIN_CHARS_FOR_RATIO_CHECKS) {
    const garbled = chars.filter((c) => c === "�").length / chars.length;
    if (garbled > GARBLED_RATIO_LIMIT) {
      noisy(`${(garbled * 100).toFixed(1)}% of characters could not be decoded.`);
    }
    const symbols =
      chars.filter((c) => !/[\p{L}\p{N}]/u.test(c) && !ORDINARY_PUNCTUATION.test(c)).length /
      chars.length;
    if (symbols > SYMBOL_RATIO_LIMIT) {
      noisy(
        `${(symbols * 100).toFixed(0)}% of characters are symbols, which suggests formulas or a failed extraction.`,
      );
    }
  }
  return warnings;
}

export async function ingestPdf(bytes: Uint8Array): Promise<Result<IngestResult, DocError>> {
  let extracted: string;
  try {
    // pdf.js may detach the buffer it is given, so hand it a copy.
    const { text } = await extractText(new Uint8Array(bytes), { mergePages: true });
    extracted = text;
  } catch (e) {
    return err({
      code: "extraction_failed",
      message: `Could not read this PDF: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  const text = cleanText(extracted);
  if (text === "") {
    return err({
      code: "empty",
      message: "No extractable text in this PDF. It may be a scan; OCR is not supported.",
    });
  }
  return ok({ text, warnings: assessExtraction(text) });
}
