import type { Envelope } from "@/core/pipeline";
import { THRESHOLDS } from "@/core/verify/thresholds";

/**
 * Plain-language list of the checks an item did not pass, read from its scores. Shown beside the
 * pipeline's own reasons in the Removed panel so a reader sees which check failed, not just why.
 */
export function failedChecks(item: Envelope): string[] {
  // A supported item passed every check; a stray soft word in its scores is not a failure.
  if (item.verdict === "SUPPORTED") return [];
  const s = item.scores;
  const out: string[] = [];
  if (!s.quoteFound) out.push("Quote check: the quoted words are not in the cited sentences.");
  if (s.entailment === null) {
    out.push("Entailment check: it could not run.");
  } else if (s.entailment < THRESHOLDS.entailmentPartial) {
    out.push(`Entailment check: the notes do not back this up (score ${s.entailment.toFixed(2)}).`);
  } else if (s.entailment < THRESHOLDS.entailmentSupported) {
    out.push(`Entailment check: only partly backed up (score ${s.entailment.toFixed(2)}).`);
  }
  if (s.novelEntities.length > 0) {
    out.push(`New-fact check: not in the notes: ${s.novelEntities.join(", ")}.`);
  }
  if (s.overGeneral.length > 0) {
    out.push(`Wording check: stronger than the notes: ${s.overGeneral.join(", ")}.`);
  }
  if (s.judge === "fail") out.push("Second reviewer: found parts the notes do not support.");
  if (s.judge === "contradiction") out.push("Second reviewer: the notes say the opposite.");
  if (s.judge === "not_run") out.push("Second reviewer: it could not run.");
  return out;
}
