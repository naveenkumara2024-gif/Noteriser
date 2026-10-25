import type { StoredRun } from "../ports/store";

export const AUDIT_FORMAT = "notebridge-audit/1";

/**
 * Everything a reviewer needs to check a run without re-running it: the source, every draft as
 * generated and as repaired, every verification with its four check scores, what was shown, what was
 * removed and why, and the usage. It contains the full source text, so it is as sensitive as the run
 * and is labelled as such.
 */
export function renderAuditJson(run: StoredRun): string {
  const result = run.result;
  const audit = {
    format: AUDIT_FORMAT,
    contains_source_text: true,
    note: "Contains the full source text and every generated draft. Treat it like the notes themselves; delete it when the review is done.",
    run: { runId: run.runId, createdAt: run.createdAt, status: run.status },
    source: run.doc ?? null,
    report: result?.report ?? null,
    usage: result?.report.usage ?? null,
    degraded: result?.degraded ?? null,
    warnings: result?.warnings ?? [],
    shown: result
      ? { summary: result.summary, glossary: result.glossary, questions: result.questions }
      : null,
    removed: result?.removed ?? [],
    plain: result?.plain ?? null,
    feedback: run.feedback ?? [],
    drafts: run.drafts,
    verifications: run.verifications,
    events: run.events,
  };
  return `${JSON.stringify(audit, null, 2)}\n`;
}
