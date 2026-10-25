import type { Envelope, ShownItem } from "@/core/pipeline";
import type { QuestionItem } from "@/core/schema/items";

const isQuestion = (e: Envelope): e is QuestionItem => "qtype" in e;
const sentence = (s: string): string => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/** What is said for an item: a glossary entry says its term first; a question reads its options, lettered. */
export function speakableText(e: Envelope): string {
  if (isQuestion(e)) {
    const lead = e.qtype === "true_false" ? "True or false: " : "";
    const options = (e.options ?? []).map((o, i) => `${"ABCD"[i] ?? i + 1}. ${sentence(o)}`);
    return [`${lead}${e.text}`, ...options].join(" ");
  }
  return e.term ? `${e.term}. ${e.text}` : e.text;
}

/** Where an item's displayed text starts inside what is spoken: after a glossary term, or after "True or false: ". */
export function textOffsetOf(e: Envelope): number {
  if (isQuestion(e)) return e.qtype === "true_false" ? "True or false: ".length : 0;
  return e.term ? `${e.term}. `.length : 0;
}

/** The answer is a separate utterance: it is read only when asked for, after "Reveal answer". */
export const speakableAnswer = (q: QuestionItem): string => `Answer: ${q.answer}`;

/**
 * The queue for reading a whole list aloud. It is built from shown items only, so a removed item
 * can never be spoken; `pick` chooses the wording being displayed (original or plain language).
 */
export function queueFor(
  items: readonly ShownItem[],
  pick: (item: ShownItem) => Envelope,
): { id: string; text: string; textOffset: number }[] {
  return items.map((item) => {
    const e = pick(item);
    return { id: e.itemId, text: speakableText(e), textOffset: textOffsetOf(e) };
  });
}
