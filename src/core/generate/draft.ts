import type { SourceDoc } from "../schema/source";
import type { GlossaryOutput, QuestionsOutput, SummaryOutput } from "./schemas";
import type { GlossaryDraft, QuestionDraft, SummaryDraft } from "./types";

const ID = /S\d+\.\d+/gi;
const INSUFFICIENT_PREFIX = /^\s*INSUFFICIENT_SOURCE\s*[:\-–—]?\s*/i;

/** What a mapper returns before ids are assigned in a stable order. */
export type Unnumbered<T extends { itemId: string }> = Omit<T, "itemId">;

export interface Mapped<T> {
  items: T[];
  problems: string[];
}

/** Tolerates "s2.4", "[S2.4]" and "S2.4, S2.5" inside one string; keeps first-seen order, no repeats. */
export function parseIds(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const r of raw) for (const m of r.matchAll(ID)) seen.add(m[0].toUpperCase());
  return [...seen];
}

export function knownIds(doc: Pick<SourceDoc, "sentences">): ReadonlySet<string> {
  return new Set(doc.sentences.map((s) => s.id));
}

/** The model's own "not enough source" signal, without the sentinel prefix; undefined when sufficient. */
export function insufficiencyOf(reason: string): string | undefined {
  const cleaned = reason.replace(INSUFFICIENT_PREFIX, "").trim();
  if (cleaned !== "") return cleaned;
  return reason.trim() === "" ? undefined : "INSUFFICIENT_SOURCE";
}

function checkIds(ids: string[], known: ReadonlySet<string>, label: string): string[] {
  const problems: string[] = [];
  if (ids.length === 0) problems.push(`${label}: no source ids cited`);
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0)
    problems.push(`${label}: cites ids not in the notes (${unknown.join(", ")})`);
  return problems;
}

const blank = (s: string): boolean => s.trim() === "";

const ID_LABEL = /\[S\d+\.\d+\]\s*/gi;

/**
 * Models often copy our "[S2.4]" labels into the quote. They are annotations we added to the prompt,
 * not source words, so they are removed before the quote is checked against the source. Nothing else
 * is touched: whether the remaining words really appear in the notes is the verifier's job.
 */
export function cleanQuote(quote: string): string {
  return quote.replace(ID_LABEL, "").replace(/\s+/g, " ").trim();
}

export function mapSummary(
  out: SummaryOutput,
  scope: string,
  known: ReadonlySet<string>,
): Mapped<Unnumbered<SummaryDraft>> {
  const items: Unnumbered<SummaryDraft>[] = [];
  const problems: string[] = [];
  for (const [i, raw] of out.items.entries()) {
    if (blank(raw.text)) {
      problems.push(`${scope} item ${i + 1}: dropped, empty text`);
      continue;
    }
    const sourceIds = parseIds(raw.source_ids);
    const own = checkIds(sourceIds, known, "summary point");
    if (blank(cleanQuote(raw.evidence_quote))) own.push("summary point: empty evidence_quote");
    items.push({
      type: "summary_point",
      scope,
      sourceIds,
      evidenceQuote: cleanQuote(raw.evidence_quote),
      text: raw.text.trim(),
      idsExist: sourceIds.length > 0 && sourceIds.every((id) => known.has(id)),
      problems: own,
    });
  }
  return { items, problems };
}

export function mapGlossary(
  out: GlossaryOutput,
  scope: string,
  known: ReadonlySet<string>,
): Mapped<Unnumbered<GlossaryDraft>> {
  const items: Unnumbered<GlossaryDraft>[] = [];
  const problems: string[] = [];
  for (const [i, raw] of out.items.entries()) {
    if (blank(raw.text) || blank(raw.term)) {
      problems.push(`${scope} item ${i + 1}: dropped, empty term or definition`);
      continue;
    }
    const sourceIds = parseIds(raw.source_ids);
    const own = checkIds(sourceIds, known, `glossary "${raw.term.trim()}"`);
    if (blank(cleanQuote(raw.evidence_quote)))
      own.push(`glossary "${raw.term.trim()}": empty evidence_quote`);
    items.push({
      type: "glossary",
      scope,
      term: raw.term.trim(),
      sourceIds,
      evidenceQuote: cleanQuote(raw.evidence_quote),
      text: raw.text.trim(),
      idsExist: sourceIds.length > 0 && sourceIds.every((id) => known.has(id)),
      problems: own,
    });
  }
  return { items, problems };
}

export function mapQuestions(
  out: QuestionsOutput,
  scope: string,
  known: ReadonlySet<string>,
): Mapped<Unnumbered<QuestionDraft>> {
  const items: Unnumbered<QuestionDraft>[] = [];
  const problems: string[] = [];
  for (const [i, raw] of out.items.entries()) {
    if (blank(raw.question) || blank(raw.answer) || blank(raw.answer_statement)) {
      problems.push(`${scope} item ${i + 1}: dropped, empty question, answer or answer statement`);
      continue;
    }
    const sourceIds = parseIds(raw.source_ids);
    const answerSourceIds = parseIds(raw.answer_source_ids);
    const own = [
      ...checkIds(sourceIds, known, "question"),
      ...checkIds(answerSourceIds, known, "question answer"),
    ];
    if (blank(cleanQuote(raw.evidence_quote))) own.push("question: empty evidence_quote");

    const options = raw.options.map((o) => o.trim()).filter((o) => o !== "");
    const answer = raw.answer.trim();
    if (raw.qtype === "mcq") {
      if (options.length !== 4) own.push(`mcq: expected 4 options, got ${options.length}`);
      if (!options.includes(answer)) own.push("mcq: answer is not one of the options");
      if (new Set(options).size !== options.length) own.push("mcq: duplicate options");
    } else if (options.length > 0) {
      own.push(`${raw.qtype}: options given but not expected`);
    }
    if (raw.qtype === "true_false" && answer !== "True" && answer !== "False") {
      own.push('true_false: answer must be "True" or "False"');
    }

    const everyId = [...sourceIds, ...answerSourceIds];
    items.push({
      type: "question",
      scope,
      qtype: raw.qtype,
      sourceIds,
      evidenceQuote: cleanQuote(raw.evidence_quote),
      text: raw.question.trim(),
      question: raw.question.trim(),
      ...(options.length > 0 ? { options } : {}),
      answer,
      answerStatement: raw.answer_statement.trim(),
      answerSourceIds,
      idsExist: everyId.length > 0 && everyId.every((id) => known.has(id)),
      problems: own,
    });
  }
  return { items, problems };
}

/** Stable ids (`sum-1`, `glo-3`, `q-7`) assigned after parallel calls are put back in order. */
export function numberItems<T extends { itemId: string }>(
  prefix: string,
  items: Unnumbered<T>[],
  startAt = 1,
): T[] {
  return items.map((item, i) => ({ ...item, itemId: `${prefix}-${startAt + i}` }) as T);
}
