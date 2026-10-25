import type { StoredRun } from "../../src/core/ports/store";
import type { SourceDoc } from "../../src/core/schema/source";
import { type CaseDraft, type EvalCase, type FailureType, parseCase } from "./cases";

/** Notes text that parses back to exactly this document: a title, then one `##` section per section. */
export function notesFromDoc(doc: SourceDoc): string {
  const parts = doc.title ? [`# ${doc.title}`] : [];
  for (const section of doc.sections) {
    const sentences = doc.sentences.filter((s) => s.section === section.number);
    parts.push(`## ${section.title}\n\n${sentences.map((s) => s.text).join(" ")}`);
  }
  return `${parts.join("\n\n")}\n`;
}

export interface RegressionRequest {
  id: string;
  /** The draft that was wrong (or wrongly flagged), by its item id in the run. */
  itemId: string;
  /** What the verifier should do with it from now on. */
  label: "good" | "bad";
  failureType?: FailureType;
  /** Which attempt's draft: 1 as generated (default), 2 as repaired. */
  attempt?: 1 | 2;
}

/**
 * A confirmed error from a stored run, as a case the evaluation runner loads like any other. The
 * source text is rebuilt from the run's parsed document, and the rebuild is checked: if the sentence
 * ids would not come out the same, no case is written.
 */
export async function regressionFromRun(run: StoredRun, req: RegressionRequest): Promise<EvalCase> {
  if (!run.doc) throw new Error("That run has no stored source document.");
  const attempt = req.attempt ?? 1;
  const draft = run.drafts.find((d) => d.item.itemId === req.itemId && d.attempt === attempt)?.item;
  if (!draft) throw new Error(`Run ${run.runId} has no attempt-${attempt} draft ${req.itemId}.`);
  if (draft.type === "question") {
    throw new Error(
      "Question drafts are not supported by the evaluation cases yet; use the summary or glossary item.",
    );
  }
  if (req.label === "bad" && !req.failureType)
    throw new Error("A bad draft needs --failure <type>.");

  const caseDraft: CaseDraft = {
    type: draft.type,
    ...(draft.type === "glossary" ? { term: draft.term } : {}),
    text: draft.text,
    sourceIds: draft.sourceIds,
    evidenceQuote: draft.evidenceQuote,
    label: req.label,
    failureType: req.label === "bad" ? (req.failureType ?? null) : null,
  };
  const c: EvalCase = {
    id: req.id,
    split: "regression",
    subject: "regression",
    topic: run.doc.title ?? "Regression",
    notes: notesFromDoc(run.doc),
    drafts: [caseDraft],
  };

  const again = await parseCase(c);
  const same =
    again.sentences.length === run.doc.sentences.length &&
    again.sentences.every((s) => run.doc?.sentences.find((o) => o.id === s.id)?.text === s.text);
  if (!same)
    throw new Error("The source text does not rebuild to the same sentence ids; not written.");
  return c;
}
