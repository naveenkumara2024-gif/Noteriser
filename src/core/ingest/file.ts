import { err, ok, type Result } from "../ports/result";
import type { DocError, DocWarning } from "../schema/source";
import { cleanText } from "./clean";
import { ingestDocx } from "./docx";
import { ingestMarkdown } from "./markdown";
import { ingestPdf } from "./pdf";
import type { IngestResult } from "./types";

const GARBLED_LIMIT = 0.01;

/** Plain text: no structure assumed beyond what the segmenter can see. */
export function ingestPlainText(raw: string): Result<IngestResult, DocError> {
  const text = cleanText(raw);
  if (text === "") return err({ code: "empty", message: "The input is empty." });
  return ok({ text, warnings: [] });
}

function decodeUtf8(bytes: Uint8Array): { text: string; warnings: DocWarning[] } {
  const text = new TextDecoder("utf-8").decode(bytes);
  const garbled = text.length > 0 ? (text.match(/�/g)?.length ?? 0) / text.length : 0;
  const warnings: DocWarning[] =
    garbled > GARBLED_LIMIT
      ? [
          {
            kind: "noisy_extraction",
            detail: "The file does not look like valid UTF-8 text; some characters were replaced.",
          },
        ]
      : [];
  return { text, warnings };
}

/** Dispatch on file extension. Unknown types are rejected rather than guessed. */
export async function ingestFile(
  name: string,
  bytes: Uint8Array,
): Promise<Result<IngestResult, DocError>> {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";

  if (ext === "pdf") return ingestPdf(bytes);
  if (ext === "docx") return ingestDocx(bytes);
  if (ext === "txt" || ext === "md" || ext === "markdown") {
    const { text, warnings } = decodeUtf8(bytes);
    const result = ext === "txt" ? ingestPlainText(text) : ingestMarkdown(text);
    return result.ok
      ? ok({ text: result.value.text, warnings: [...warnings, ...result.value.warnings] })
      : result;
  }
  return err({
    code: "unsupported_type",
    message: `Unsupported file type${ext ? ` ".${ext}"` : ""}. Use .txt, .md, .pdf or .docx.`,
  });
}
