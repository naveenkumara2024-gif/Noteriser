import type { SourceDoc } from "../schema/source";
import { knownIds, mapQuestions, numberItems } from "./draft";
import { questionsPrompt } from "./prompts";
import { sectionsOf } from "./render";
import { concurrencyOf, generateCall, mapPool, mergeCalls } from "./run";
import { QuestionsOutput, TOOL_NAMES } from "./schemas";
import {
  type GenerateDeps,
  type GenerationOutcome,
  LONG_DOC_SENTENCES,
  QUESTION_CANDIDATES,
  type QuestionDraft,
} from "./types";

/**
 * Over-generates candidates (default 8) so the verifier can reject some and five still remain.
 * Short documents get one call over the whole text; long ones get per-section calls with the
 * candidate budget split in proportion to section length. Choosing the final five happens later.
 */
export async function generateQuestions(
  doc: SourceDoc,
  deps: GenerateDeps,
  candidates = QUESTION_CANDIDATES,
): Promise<GenerationOutcome> {
  const known = knownIds(doc);
  const total = doc.sentences.length;

  const jobs =
    total <= LONG_DOC_SENTENCES
      ? [{ scope: "document", label: "the notes", sentences: doc.sentences, n: candidates }]
      : sectionsOf(doc).map((sec) => ({
          scope: `section:${sec.number}`,
          label: `Section ${sec.number}: ${sec.title}`,
          sentences: sec.sentences,
          n: Math.max(1, Math.round((candidates * sec.sentences.length) / total)),
        }));

  const calls = await mapPool(jobs, concurrencyOf(deps), (job) =>
    generateCall(
      deps,
      job.scope,
      TOOL_NAMES.questions,
      QuestionsOutput,
      questionsPrompt({ sentences: job.sentences }, job.n, job.label),
      (v) => ({ ...mapQuestions(v, job.scope, known), insufficientReason: v.insufficient_reason }),
    ),
  );

  const merged = mergeCalls(calls);
  return { ...merged, items: numberItems<QuestionDraft>("q", merged.items) };
}
