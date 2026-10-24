import type { DocWarning } from "../schema/source";

/**
 * Cleaned plain text plus extraction warnings. Headings are carried in the text itself as
 * Markdown `#` lines (that is how Markdown, DOCX and pasted text all express them), so the
 * segmenter has one structure to understand.
 */
export interface IngestResult {
  text: string;
  warnings: DocWarning[];
}
