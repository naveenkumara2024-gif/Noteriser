import {
  insufficiencyOf,
  knownIds,
  mapGlossary,
  mapQuestions,
  mapSummary,
} from "../generate/draft";
import { generatorSystem, type Prompt } from "../generate/prompts";
import { renderSource, sectionsOf } from "../generate/render";
import { GlossaryOutput, QuestionsOutput, SummaryOutput, TOOL_NAMES } from "../generate/schemas";
import { type DraftItem, GENERATOR_TEMPERATURE, LONG_DOC_SENTENCES } from "../generate/types";
import type { LlmClient, Usage } from "../ports/llm";
import { ZERO_USAGE } from "../ports/llm";
import type { Verdict } from "../schema/items";
import type { SourceDoc } from "../schema/source";

export interface RepairDeps {
  llm: LlmClient;
  signal?: AbortSignal;
}

export interface RepairResult {
  /** The corrected draft (same id and kind as the original), or null when none was produced. */
  draft: DraftItem | null;
  usage: Usage;
  /** Why there is no draft, or null. */
  note: string | null;
}

/**
 * Only items the notes might still support are worth a second try. A CONTRADICTED item says the
 * opposite of the notes; regenerating it would only invite a more convincing wrong answer.
 */
export function isRepairable(verdict: Verdict): boolean {
  return verdict === "PARTIAL" || verdict === "UNSUPPORTED";
}

/** The item in the same snake_case shape the generator schemas use, so the model recognises it. */
function asGeneratorShape(item: DraftItem): Record<string, unknown> {
  const evidence = { source_ids: item.sourceIds, evidence_quote: item.evidenceQuote };
  switch (item.type) {
    case "summary_point":
      return { ...evidence, text: item.text };
    case "glossary":
      return { ...evidence, term: item.term, text: item.text };
    case "question":
      return {
        ...evidence,
        qtype: item.qtype,
        question: item.question,
        options: item.options ?? [],
        answer: item.answer,
        answer_statement: item.answerStatement,
        answer_source_ids: item.answerSourceIds,
      };
  }
}

const KIND_RULE: Record<DraftItem["type"], string> = {
  summary_point: "Write one summary point, under 25 words.",
  glossary: "Define the same term, using the source's own wording.",
  question:
    "Write one question of the same type (qtype), with its answer_statement and answer_source_ids.",
};

/** The sections the item is about: those it cites, else the one it was generated from, else all. */
function contextSentences(item: DraftItem, doc: SourceDoc) {
  const cited = new Set([
    ...item.sourceIds,
    ...(item.type === "question" ? item.answerSourceIds : []),
  ]);
  const wanted = new Set<number>();
  for (const s of doc.sentences) if (cited.has(s.id)) wanted.add(s.section);
  const fromScope = /^section:(\d+)$/.exec(item.scope)?.[1];
  if (fromScope) wanted.add(Number(fromScope));

  // A short document is cheap to show whole, and gives the model every place it might re-cite.
  if (doc.sentences.length <= LONG_DOC_SENTENCES) return doc.sentences;

  const sections = sectionsOf(doc).filter((s) => wanted.has(s.number));
  // Nothing identifies the item's sections (invalid citations, roll-up): show the opening sections.
  return (sections.length > 0 ? sections : sectionsOf(doc).slice(0, 3)).flatMap((s) => s.sentences);
}

/**
 * One regeneration of a single failed item. The prompt carries the original item and every finding
 * of the verifier verbatim ("closest sentence is S3.4", "mentions 'always'"), and asks for a
 * narrower, more extractive replacement.
 */
export function repairPrompt(item: DraftItem, reasons: readonly string[], doc: SourceDoc): Prompt {
  const problems = reasons.map((r) => `- ${r}`).join("\n");
  return {
    system: generatorSystem(
      `An item from an earlier draft failed review. Write ONE corrected replacement for it.
- ${KIND_RULE[item.type]}
- Fix every problem listed in <problems>.
- Be extractive: reuse the source's own words, and narrow the claim rather than extend it. Drop anything the cited sentences do not state.
- Cite only the sentences that actually contain the content, and take evidence_quote from them (rule 2).
- If the notes cannot support a corrected version, return no item and explain in insufficient_reason.`,
    ),
    user:
      `${renderSource(contextSentences(item, doc))}\n\n` +
      `<item_to_repair>\n${JSON.stringify(asGeneratorShape(item), null, 2)}\n</item_to_repair>\n\n` +
      `<problems>\n${problems}\n</problems>\n\nWrite the corrected item.`,
  };
}

/** Runs the repair. Never throws: a failure is reported in `note` and the original stands. */
export async function repairItem(
  item: DraftItem,
  reasons: readonly string[],
  doc: SourceDoc,
  deps: RepairDeps,
): Promise<RepairResult> {
  const prompt = repairPrompt(item, reasons, doc);
  const known = knownIds(doc);
  const common = {
    role: "generator" as const,
    system: prompt.system,
    user: prompt.user,
    temperature: GENERATOR_TEMPERATURE,
    signal: deps.signal,
  };

  const fail = (note: string, usage: Usage = ZERO_USAGE): RepairResult => ({
    draft: null,
    usage,
    note,
  });

  switch (item.type) {
    case "summary_point": {
      const r = await deps.llm.generateStructured({
        ...common,
        toolName: TOOL_NAMES.summary,
        schema: SummaryOutput,
      });
      if (!r.ok) return fail(`repair call failed: ${r.error.message}`, r.error.usage);
      const first = mapSummary(r.value.value, item.scope, known).items[0];
      return first
        ? { draft: { ...first, itemId: item.itemId }, usage: r.value.usage, note: null }
        : fail(noItemNote(r.value.value.insufficient_reason), r.value.usage);
    }
    case "glossary": {
      const r = await deps.llm.generateStructured({
        ...common,
        toolName: TOOL_NAMES.glossary,
        schema: GlossaryOutput,
      });
      if (!r.ok) return fail(`repair call failed: ${r.error.message}`, r.error.usage);
      const first = mapGlossary(r.value.value, item.scope, known).items[0];
      // The entry must still define the term it was written for.
      return first
        ? {
            draft: { ...first, itemId: item.itemId, term: item.term },
            usage: r.value.usage,
            note: null,
          }
        : fail(noItemNote(r.value.value.insufficient_reason), r.value.usage);
    }
    case "question": {
      const r = await deps.llm.generateStructured({
        ...common,
        toolName: TOOL_NAMES.questions,
        schema: QuestionsOutput,
      });
      if (!r.ok) return fail(`repair call failed: ${r.error.message}`, r.error.usage);
      const first = mapQuestions(r.value.value, item.scope, known).items[0];
      return first
        ? { draft: { ...first, itemId: item.itemId }, usage: r.value.usage, note: null }
        : fail(noItemNote(r.value.value.insufficient_reason), r.value.usage);
    }
  }
}

const noItemNote = (reason: string): string => {
  const why = insufficiencyOf(reason);
  return why
    ? `the model could not write a supported replacement (${why})`
    : "the model returned no replacement";
};
