import type { RunResult } from "../pipeline/types";
import { OPTION_LETTERS } from "./labels";
import { buildModel, type ExportItem, type ExportOptions } from "./model";

export interface AnkiOptions extends ExportOptions {
  /** Include partially supported (flagged) items. Off by default: a flashcard is memorised, not re-checked. */
  includeFlagged?: boolean;
}

/** A tag on cards made from flagged items, so they can be found and reviewed in Anki. */
export const FLAGGED_TAG = "check-against-source";

/**
 * One TSV field. A field with a tab, a line break or a double quote is wrapped in double quotes
 * with inner quotes doubled, which Anki's importer reads back exactly. A field starting with `#`
 * is quoted too, so it cannot be mistaken for one of Anki's header lines.
 */
export function tsvField(value: string): string {
  return /[\t\r\n"]/.test(value) || value.startsWith("#")
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

function cardOf(item: ExportItem): { front: string; back: string } | undefined {
  if (item.question) {
    const options = item.question.options.map((o, i) => `${OPTION_LETTERS[i] ?? i + 1}. ${o}`);
    return {
      front: [item.text, ...options].join("\n"),
      back: item.question.answer,
    };
  }
  return item.term ? { front: item.term, back: item.text } : undefined;
}

/**
 * Flashcards for Anki: glossary terms and questions (not summary points), one per line as
 * `front<TAB>back<TAB>tags`, where the tags are the source sentence ids ("S2.4 S2.5"). The three
 * header lines tell Anki the separator, that fields are plain text, and which column holds tags.
 */
export function renderAnkiTsv(result: RunResult, options: AnkiOptions = {}): string {
  const model = buildModel(result, options);
  const lines = ["#separator:tab", "#html:false", "#tags column:3"];
  for (const item of [...model.glossary, ...model.questions]) {
    if (item.flag && !options.includeFlagged) continue;
    const card = cardOf(item);
    if (!card) continue;
    const ids = [...item.sourceIds, ...(item.question?.answerSourceIds ?? [])];
    const tags = [...new Set(ids), ...(item.flag ? [FLAGGED_TAG] : [])].join(" ");
    lines.push([card.front, card.back, tags].map(tsvField).join("\t"));
  }
  return `${lines.join("\n")}\n`;
}
