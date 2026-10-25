import type { Envelope, RemovedItem, RunResult, ShownItem } from "../pipeline/types";
import { formatReport } from "../report";
import type { QuestionItem } from "../schema/items";
import type { SourceDoc } from "../schema/source";
import { failedChecks } from "./checks";
import {
  DEGRADED_NOTICE,
  FAILED_NOTICE,
  INCOMPLETE_NOTICE,
  QUESTION_TYPE_LABEL,
  REMOVAL_LABEL,
  TRUST_NOTICE,
} from "./labels";

export interface ExportOptions {
  /** Which wording to export. `plain` uses a verified plain-language version where one exists. */
  wording?: "original" | "plain";
  /** When the run was made (ISO). Passed in so the export stays a pure function of its inputs. */
  generatedAt?: string;
}

export interface ExportItem {
  id: string;
  term?: string;
  text: string;
  sourceIds: string[];
  /** Set for partial items: the reason to check them. */
  flag?: string;
  /** Plain-language mode: why the original wording was kept. */
  keptOriginal?: string;
  question?: {
    typeLabel: string;
    options: string[];
    answer: string;
    answerSourceIds: string[];
  };
}

export interface ExportRemoved {
  id: string;
  label: string;
  term?: string;
  text: string;
  reasons: string[];
  failedChecks: string[];
  citedIds: string[];
  repairNote?: string;
  duplicateOf?: string;
}

export interface ExportSourceGroup {
  heading: string;
  sentences: { id: string; text: string }[];
}

/** Everything a human-readable export says, decided once so Markdown and text cannot drift apart. */
export interface ExportModel {
  title: string;
  notice: string;
  /** Statements about the run that a reader must see (degraded, incomplete, failed, plain wording). */
  banners: string[];
  generatedAt?: string;
  report: string;
  summary: ExportItem[];
  glossary: ExportItem[];
  questions: ExportItem[];
  removed: ExportRemoved[];
  /** Every sentence cited by a shown item, once, in document order. */
  sources: ExportSourceGroup[];
  notices: string[];
  docWarnings: string[];
}

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

function itemOf(shown: ShownItem, wording: "original" | "plain"): ExportItem {
  const plain = shown.plain;
  const e: Envelope =
    wording === "plain" && plain?.status === "simplified" ? plain.envelope : shown.envelope;
  const flagged = e === shown.envelope ? shown.flagged : false;
  const q = "qtype" in e ? (e as QuestionItem) : undefined;

  return {
    id: e.itemId,
    ...(e.term ? { term: oneLine(e.term) } : {}),
    text: oneLine(e.text),
    sourceIds: [...e.sourceIds],
    ...(flagged
      ? { flag: oneLine(e.flagReason ?? "Part of this is not clearly in the notes.") }
      : {}),
    ...(wording === "plain" && plain?.status === "kept_original"
      ? { keptOriginal: plain.reason }
      : {}),
    ...(q
      ? {
          question: {
            typeLabel: QUESTION_TYPE_LABEL[q.qtype],
            options: (q.options ?? []).map(oneLine),
            answer: oneLine(q.answer),
            answerSourceIds: [...q.answerSourceIds],
          },
        }
      : {}),
  };
}

function removedOf(r: RemovedItem): ExportRemoved {
  const e = r.envelope;
  const q = "qtype" in e ? (e as QuestionItem) : undefined;
  const checks = r.kind === "duplicate" || r.kind === "surplus" ? [] : failedChecks(e);
  return {
    id: e.itemId,
    label: REMOVAL_LABEL[r.kind],
    ...(e.term ? { term: oneLine(e.term) } : {}),
    text: oneLine(e.text),
    reasons: r.reasons.map(oneLine),
    failedChecks: checks,
    citedIds: [...new Set([...e.sourceIds, ...(q?.answerSourceIds ?? [])])],
    ...(r.repairAttempted && r.repairNote ? { repairNote: oneLine(r.repairNote) } : {}),
    ...(r.duplicateOf ? { duplicateOf: r.duplicateOf } : {}),
  };
}

/** The cited sentences, grouped by section, each once, in document order. */
function sourcesOf(doc: SourceDoc | undefined, items: readonly ExportItem[]): ExportSourceGroup[] {
  if (!doc) return [];
  const cited = new Set(
    items.flatMap((i) => [...i.sourceIds, ...(i.question?.answerSourceIds ?? [])]),
  );
  return doc.sections
    .map((section) => ({
      heading: section.title,
      sentences: doc.sentences
        .filter((s) => s.section === section.number && cited.has(s.id))
        .map((s) => ({ id: s.id, text: oneLine(s.text) })),
    }))
    .filter((g) => g.sentences.length > 0);
}

export function buildModel(result: RunResult, options: ExportOptions = {}): ExportModel {
  const wording = options.wording === "plain" && result.plain ? "plain" : "original";
  const summary = result.summary.map((s) => itemOf(s, wording));
  const glossary = result.glossary.map((s) => itemOf(s, wording));
  const questions = result.questions.map((s) => itemOf(s, wording));

  const banners: string[] = [];
  if (result.status === "failed") banners.push(FAILED_NOTICE);
  if (result.status === "incomplete") banners.push(INCOMPLETE_NOTICE);
  if (result.degraded) banners.push(DEGRADED_NOTICE);
  if (wording === "plain") {
    banners.push(
      "Plain-language wording: each rewrite was checked against the source like every other item. An item whose rewrite could not be verified keeps its original wording and says so.",
    );
  }

  return {
    title: result.doc?.title ?? "Study aids",
    notice: TRUST_NOTICE,
    banners,
    ...(options.generatedAt ? { generatedAt: options.generatedAt } : {}),
    report: formatReport(result.report),
    summary,
    glossary,
    questions,
    removed: result.removed.map(removedOf),
    sources: sourcesOf(result.doc, [...summary, ...glossary, ...questions]),
    notices: result.warnings.map((w) => oneLine(w.message)),
    docWarnings: (result.doc?.warnings ?? []).map(
      (w) => `${oneLine(w.detail)}${w.location ? ` (line ${w.location.line})` : ""}`,
    ),
  };
}
