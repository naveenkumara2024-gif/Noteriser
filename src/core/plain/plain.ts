import { generatorSystem, type Prompt } from "../generate/prompts";
import { renderSource } from "../generate/render";
import type { DraftItem } from "../generate/types";
import {
  asGeneratorShape,
  contextSentences,
  type RepairDeps,
  type RepairResult,
  regenerateItem,
} from "../repair/repair";
import type { SourceDoc } from "../schema/source";
import { normalizeForMatch } from "../text";

/** Words per sentence the rewrite aims for. The model is told; the readability grade measures it. */
export const PLAIN_MAX_WORDS = 15;

const KIND_RULE: Record<DraftItem["type"], string> = {
  summary_point: "Write the same summary point.",
  glossary: "Write the same glossary entry: keep the term, simplify only the definition.",
  question:
    "Write the same question: keep qtype, keep every option's meaning and the same correct answer, and fill in answer_statement and answer_source_ids as before.",
};

/**
 * The prompt that asks for a plain-language version of one verified item. It is the repair
 * machinery with a different instruction: same schema, same evidence fields, closed-book. The
 * simplified item is then verified in full like any other; nothing here is trusted.
 *
 * The rules push toward shorter sentences, not new words: a rewrite that swaps in vocabulary the
 * notes never use is exactly what the novel-fact check flags, so synonyms would defeat the point.
 */
export function simplifyPrompt(item: DraftItem, doc: SourceDoc): Prompt {
  return {
    system: generatorSystem(
      `Rewrite ONE item in plain language for a reader who finds the notes hard to read.
- ${KIND_RULE[item.type]}
- Use sentences of at most ${PLAIN_MAX_WORDS} words. Split long sentences instead of joining clauses.
- Keep every technical term exactly as the notes write it. Do not replace a term with a synonym.
- Prefer words that already appear in the notes. Add no new numbers, names, examples or claims.
- Say exactly what the item says: keep its meaning, its modality (can, may, always, only) and its scope.
- Keep source_ids and evidence_quote as they are (rule 2).
- If it cannot be made simpler without changing the meaning, return it unchanged.`,
    ),
    user:
      `${renderSource(contextSentences(item, doc))}\n\n` +
      `<item_to_simplify>\n${JSON.stringify(asGeneratorShape(item), null, 2)}\n</item_to_simplify>\n\n` +
      "Write the plain-language version of the item.",
  };
}

/** One rewrite call. Never throws: a failure is in `note` and the original stands. */
export function simplifyItem(
  item: DraftItem,
  doc: SourceDoc,
  deps: RepairDeps,
): Promise<RepairResult> {
  return regenerateItem(item, simplifyPrompt(item, doc), doc, deps);
}

/** The words a reader has to get through for this item, which is what the readability grade measures. */
export function readableText(item: { text: string; answer?: string }): string {
  return item.answer ? `${item.text} ${item.answer}` : item.text;
}

const norm = (s: string | undefined): string => normalizeForMatch(s ?? "");

/** True when a rewrite changed nothing a reader would notice (the model judged it already plain). */
export function sameContent(a: DraftItem, b: DraftItem): boolean {
  if (a.type !== b.type || norm(a.text) !== norm(b.text)) return false;
  if (a.type === "glossary" && b.type === "glossary") return norm(a.term) === norm(b.term);
  if (a.type === "question" && b.type === "question") {
    return (
      norm(a.answer) === norm(b.answer) &&
      norm(a.answerStatement) === norm(b.answerStatement) &&
      (a.options ?? []).map(norm).join("|") === (b.options ?? []).map(norm).join("|")
    );
  }
  return true;
}
