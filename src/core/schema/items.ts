import Type from "typebox";
import { SentenceId } from "./source";

export const ItemType = Type.Union([
  Type.Literal("summary_point"),
  Type.Literal("glossary"),
  Type.Literal("question"),
]);
export type ItemType = Type.Static<typeof ItemType>;

export const Verdict = Type.Union([
  Type.Literal("SUPPORTED"),
  Type.Literal("PARTIAL"),
  Type.Literal("UNSUPPORTED"),
  Type.Literal("CONTRADICTED"),
]);
export type Verdict = Type.Static<typeof Verdict>;

export const JudgeOutcome = Type.Union([
  Type.Literal("pass"),
  Type.Literal("fail"),
  Type.Literal("contradiction"),
  Type.Literal("not_run"),
]);
export type JudgeOutcome = Type.Static<typeof JudgeOutcome>;

/** One entry per check. `entailment: null` means the NLI check did not run (invariant 1). */
export const Scores = Type.Object({
  quoteFound: Type.Boolean(),
  entailment: Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]),
  novelEntities: Type.Array(Type.String()),
  overGeneral: Type.Array(Type.String()),
  judge: JudgeOutcome,
});
export type Scores = Type.Static<typeof Scores>;

/** Shared by summary points, glossary entries and questions. Field order is evidence-first on purpose. */
export const ItemEnvelope = Type.Object({
  itemId: Type.String({ minLength: 1 }),
  type: ItemType,
  sourceIds: Type.Array(SentenceId, { minItems: 1 }),
  evidenceQuote: Type.String({ minLength: 1 }),
  text: Type.String({ minLength: 1 }),
  /** Glossary entries only: the term that `text` defines. */
  term: Type.Optional(Type.String({ minLength: 1 })),
  verdict: Verdict,
  scores: Scores,
  flagReason: Type.Union([Type.String(), Type.Null()]),
});
export type ItemEnvelope = Type.Static<typeof ItemEnvelope>;

export const QuestionType = Type.Union([
  Type.Literal("mcq"),
  Type.Literal("short"),
  Type.Literal("true_false"),
]);
export type QuestionType = Type.Static<typeof QuestionType>;

export const QuestionFields = Type.Object({
  qtype: QuestionType,
  question: Type.String({ minLength: 1 }),
  options: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 2 })),
  answer: Type.String({ minLength: 1 }),
  /** Declarative restatement of the answer; this, not the question, is what NLI and the judge verify. */
  answerStatement: Type.String({ minLength: 1 }),
  answerSourceIds: Type.Array(SentenceId, { minItems: 1 }),
});
export type QuestionFields = Type.Static<typeof QuestionFields>;

export const QuestionItem = Type.Intersect([ItemEnvelope, QuestionFields]);
export type QuestionItem = Type.Static<typeof QuestionItem>;
