import Type from "typebox";

/** `S{section}.{n}`, both 1-based. Stable for identical input. */
export const SentenceId = Type.String({ pattern: "^S[1-9][0-9]*\\.[1-9][0-9]*$" });
export type SentenceId = Type.Static<typeof SentenceId>;

export const SourceSentence = Type.Object({
  id: SentenceId,
  section: Type.Integer({ minimum: 1 }),
  sectionTitle: Type.String(),
  text: Type.String({ minLength: 1 }),
  /** 0-based index across the whole document. */
  position: Type.Integer({ minimum: 0 }),
});
export type SourceSentence = Type.Static<typeof SourceSentence>;

export const Section = Type.Object({
  number: Type.Integer({ minimum: 1 }),
  title: Type.String(),
  /** True when the title is a placeholder we invented ("Notes", "Part 2"); it is not source text. */
  generatedTitle: Type.Optional(Type.Boolean()),
  sentenceIds: Type.Array(SentenceId, { minItems: 1 }),
});
export type Section = Type.Static<typeof Section>;

export const DocWarningKind = Type.Union([
  Type.Literal("not_processed"),
  Type.Literal("noisy_extraction"),
  Type.Literal("no_headings"),
  Type.Literal("too_short"),
]);
export type DocWarningKind = Type.Static<typeof DocWarningKind>;

export const DocWarning = Type.Object({
  kind: DocWarningKind,
  detail: Type.String(),
  /** Where excluded content sat in the input (1-based line) and the sentence it follows, if any. */
  location: Type.Optional(
    Type.Object({
      line: Type.Integer({ minimum: 1 }),
      afterSentenceId: Type.Optional(SentenceId),
    }),
  ),
});
export type DocWarning = Type.Static<typeof DocWarning>;

export const SourceDoc = Type.Object({
  /** Document title when the input opens with a lone top-level heading. */
  title: Type.Optional(Type.String()),
  sentences: Type.Array(SourceSentence, { minItems: 1 }),
  sections: Type.Array(Section, { minItems: 1 }),
  warnings: Type.Array(DocWarning),
  stats: Type.Object({
    sentences: Type.Integer({ minimum: 1 }),
    sections: Type.Integer({ minimum: 1 }),
    characters: Type.Integer({ minimum: 0 }),
    excludedBlocks: Type.Integer({ minimum: 0 }),
  }),
});
export type SourceDoc = Type.Static<typeof SourceDoc>;

/** Why a document could not be turned into a `SourceDoc`. */
export interface DocError {
  code: "empty" | "unsupported_type" | "extraction_failed" | "no_sentences";
  message: string;
}
