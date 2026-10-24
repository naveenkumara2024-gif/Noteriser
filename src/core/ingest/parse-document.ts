import type { Result } from "../ports/result";
import type { DocError, SourceDoc } from "../schema/source";
import { segment } from "../segment/segment";
import { ingestFile, ingestPlainText } from "./file";
import { ingestMarkdown } from "./markdown";

export type DocumentInput =
  /** Pasted text. Markdown handling is on by default: it is harmless on plain prose and keeps headings. */
  | { kind: "text"; text: string; format?: "plain" | "markdown" }
  | { kind: "file"; name: string; bytes: Uint8Array };

/** Raw input -> numbered `SourceDoc`, the single source of truth every later stage cites. */
export async function parseDocument(input: DocumentInput): Promise<Result<SourceDoc, DocError>> {
  const ingested =
    input.kind === "file"
      ? await ingestFile(input.name, input.bytes)
      : input.format === "plain"
        ? ingestPlainText(input.text)
        : ingestMarkdown(input.text);

  if (!ingested.ok) return ingested;
  return segment(ingested.value.text, ingested.value.warnings);
}
