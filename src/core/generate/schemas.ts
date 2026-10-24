import Type from "typebox";
import { stringEnum } from "../schema/string-enum";

/*
 * LLM-facing output schemas. Two rules shape them:
 *  - Evidence first (invariant 4): `source_ids` and `evidence_quote` are declared before the claim
 *    text, so the model commits to its evidence before it writes the claim.
 *  - Provider-portable: every property is required, objects are closed, and there are no
 *    minLength/minItems/pattern keywords. Strict structured-output modes reject or mangle those;
 *    emptiness and id validity are checked after parsing instead (see `draft.ts`).
 */

const sourceIds = Type.Array(Type.String(), {
  description: 'IDs of the source sentences this item relies on, for example ["S2.4"].',
});
const evidenceQuote = Type.String({
  description:
    "One unbroken passage copied exactly from a cited sentence that supports this item. No joined fragments, no paraphrase.",
});
const insufficientReason = Type.String({
  description:
    'Empty string when the notes are sufficient. Otherwise start with "INSUFFICIENT_SOURCE" and say what is missing.',
});

export const SummaryOutput = Type.Object(
  {
    items: Type.Array(
      Type.Object(
        {
          source_ids: sourceIds,
          evidence_quote: evidenceQuote,
          text: Type.String({ description: "The summary point, under 25 words." }),
        },
        { additionalProperties: false },
      ),
    ),
    insufficient_reason: insufficientReason,
  },
  { additionalProperties: false },
);
export type SummaryOutput = Type.Static<typeof SummaryOutput>;

export const GlossaryOutput = Type.Object(
  {
    items: Type.Array(
      Type.Object(
        {
          source_ids: sourceIds,
          evidence_quote: evidenceQuote,
          term: Type.String({ description: "The term exactly as the source writes it." }),
          text: Type.String({ description: "The definition, in the source's own wording." }),
        },
        { additionalProperties: false },
      ),
    ),
    insufficient_reason: insufficientReason,
  },
  { additionalProperties: false },
);
export type GlossaryOutput = Type.Static<typeof GlossaryOutput>;

export const QUESTION_TYPES = ["mcq", "short", "true_false"] as const;

export const QuestionsOutput = Type.Object(
  {
    items: Type.Array(
      Type.Object(
        {
          source_ids: sourceIds,
          evidence_quote: evidenceQuote,
          qtype: stringEnum(QUESTION_TYPES, "Question type."),
          question: Type.String({ description: "The question or, for true_false, the statement." }),
          options: Type.Array(Type.String(), {
            description:
              "For mcq: exactly 4 option texts without letters. Otherwise an empty array.",
          }),
          answer: Type.String({
            description:
              'For mcq: the exact text of the correct option. For true_false: "True" or "False". For short: a one or two sentence answer.',
          }),
          answer_statement: Type.String({
            description:
              "One declarative sentence stating the fact that makes the answer correct, in the source's wording.",
          }),
          answer_source_ids: Type.Array(Type.String(), {
            description: "IDs of the sentences that prove the answer (a subset of source_ids).",
          }),
        },
        { additionalProperties: false },
      ),
    ),
    insufficient_reason: insufficientReason,
  },
  { additionalProperties: false },
);
export type QuestionsOutput = Type.Static<typeof QuestionsOutput>;

export const TOOL_NAMES = {
  summary: "submit_summary",
  glossary: "submit_glossary",
  questions: "submit_questions",
  rollup: "submit_rollup_summary",
} as const;
