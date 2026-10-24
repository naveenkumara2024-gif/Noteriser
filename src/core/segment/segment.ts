import { err, ok, type Result } from "../ports/result";
import type { DocError, DocWarning, Section, SourceDoc, SourceSentence } from "../schema/source";
import { scan } from "./scan";
import { splitSentences } from "./sentences";

/** Sentence-final punctuation, optionally followed by closing quotes/brackets. */
const TERMINATOR = /[.!?…:;]["'”’)\]]*$/;
const MIN_SENTENCES = 10;
// Fallback sectioning for notes without headings (lore §4).
const GROUP_SIZE = 6;
const MIN_GROUP = 3;
const PARAGRAPH_TARGET = 5;
// A short line standing alone before an uppercase line is a title, not a soft-wrapped sentence.
const MAX_TITLE_WORDS = 6;

interface Logical {
  text: string;
  bullet: boolean;
  physical: number;
}
interface Draft {
  text: string;
  paragraph: number;
}
interface DraftSection {
  title: string;
  level: number;
  drafts: Draft[];
  /** The title was made up by us ("Notes", "Part 2"), not written in the document. */
  generated?: boolean;
}
interface Excluded {
  what: string;
  preview: string;
  lineCount: number;
  line: number;
  afterCount: number;
}

function isSoftWrap(
  open: Logical,
  line: { text: string; bullet: boolean; indent: number },
): boolean {
  if (line.bullet) return false;
  if (TERMINATOR.test(open.text)) return false;
  if (open.bullet) return line.indent > 0 || /^\p{Ll}/u.test(line.text);
  const isTitleLike = open.physical === 1 && open.text.split(/\s+/).length <= MAX_TITLE_WORDS;
  return !(isTitleLike && /^\p{Lu}/u.test(line.text));
}

function regroup(drafts: Draft[]): { groups: Draft[][]; by: "paragraph" | "size" } {
  const paragraphs = new Map<number, Draft[]>();
  for (const d of drafts) paragraphs.set(d.paragraph, [...(paragraphs.get(d.paragraph) ?? []), d]);

  const groups: Draft[][] = [];
  let by: "paragraph" | "size";
  if (paragraphs.size > 1) {
    by = "paragraph";
    let acc: Draft[] = [];
    for (const p of paragraphs.values()) {
      acc = [...acc, ...p];
      if (acc.length >= PARAGRAPH_TARGET) {
        groups.push(acc);
        acc = [];
      }
    }
    if (acc.length > 0) {
      const last = groups[groups.length - 1];
      if (acc.length < MIN_GROUP && last) last.push(...acc);
      else groups.push(acc);
    }
  } else {
    by = "size";
    for (let i = 0; i < drafts.length; i += GROUP_SIZE)
      groups.push(drafts.slice(i, i + GROUP_SIZE));
    const tail = groups[groups.length - 1];
    const before = groups[groups.length - 2];
    if (groups.length > 1 && tail && before && tail.length < MIN_GROUP) {
      before.push(...tail);
      groups.pop();
    }
  }
  return { groups, by };
}

/**
 * Turn cleaned text into a `SourceDoc`: sections, uniquely identified sentences, and warnings for
 * anything excluded. Heading levels are flattened (every heading starts a section). Deterministic.
 */
export function segment(
  text: string,
  inputWarnings: DocWarning[] = [],
): Result<SourceDoc, DocError> {
  const items = scan(text);
  const hasHeadings = items.some((i) => i.type === "heading");

  const sections: DraftSection[] = [];
  const excluded: Excluded[] = [];
  let current: DraftSection | undefined;
  let open: Logical | undefined;
  let paragraph = 0;
  let total = 0;

  const flush = (): void => {
    if (!open) return;
    if (!current) {
      current = {
        title: hasHeadings ? "Untitled section" : "Notes",
        level: 2,
        drafts: [],
        generated: true,
      };
      sections.push(current);
    }
    for (const s of splitSentences(open.text)) {
      current.drafts.push({ text: s, paragraph });
      total++;
    }
    open = undefined;
  };

  for (const item of items) {
    switch (item.type) {
      case "blank":
        flush();
        paragraph++;
        break;
      case "heading":
        flush();
        paragraph++;
        current = { title: item.title, level: item.level, drafts: [] };
        sections.push(current);
        break;
      case "excluded":
        flush();
        paragraph++;
        excluded.push({
          what: item.what,
          preview: item.preview,
          lineCount: item.lineCount,
          line: item.line,
          afterCount: total,
        });
        break;
      case "line":
        if (open && isSoftWrap(open, item)) {
          open.text += ` ${item.text}`;
          open.physical++;
        } else {
          flush();
          open = { text: item.text, bullet: item.bullet, physical: 1 };
        }
        break;
    }
  }
  flush();

  if (total === 0) {
    const n = excluded.length;
    return err({
      code: "no_sentences",
      message:
        n > 0
          ? `No readable sentences found; ${n} block(s) were not processed (tables, formulas, code or images).`
          : "No readable sentences found.",
    });
  }

  let docTitle: string | undefined;
  let kept: { title: string; drafts: Draft[]; generated?: boolean }[];
  const warnings: DocWarning[] = [...inputWarnings];
  let noHeadingsDetail: string | undefined;

  if (hasHeadings) {
    const first = sections[0];
    if (
      first &&
      first.level === 1 &&
      first.drafts.length === 0 &&
      sections.some((s) => s.drafts.length > 0)
    ) {
      docTitle = first.title;
    }
    kept = sections.filter((s) => s.drafts.length > 0);
  } else {
    const { groups, by } = regroup(sections.flatMap((s) => s.drafts));
    kept = groups.map((drafts, i) => ({
      title: groups.length === 1 ? "Notes" : `Part ${i + 1}`,
      drafts,
      generated: true,
    }));
    noHeadingsDetail = `No headings found; split into ${groups.length} part(s) by ${by === "paragraph" ? "paragraph breaks" : "sentence count"}.`;
  }

  const sentences: SourceSentence[] = [];
  const outSections: Section[] = [];
  kept.forEach((sec, si) => {
    const number = si + 1;
    const sentenceIds: string[] = [];
    sec.drafts.forEach((d, di) => {
      const id = `S${number}.${di + 1}`;
      sentences.push({
        id,
        section: number,
        sectionTitle: sec.title,
        text: d.text,
        position: sentences.length,
      });
      sentenceIds.push(id);
    });
    outSections.push({
      number,
      title: sec.title,
      ...(sec.generated ? { generatedTitle: true } : {}),
      sentenceIds,
    });
  });

  for (const e of excluded) {
    const afterSentenceId = e.afterCount > 0 ? sentences[e.afterCount - 1]?.id : undefined;
    warnings.push({
      kind: "not_processed",
      detail: `${e.what} not processed (${e.lineCount} line${e.lineCount === 1 ? "" : "s"}): "${e.preview}"`,
      location: afterSentenceId ? { line: e.line, afterSentenceId } : { line: e.line },
    });
  }
  if (noHeadingsDetail) warnings.push({ kind: "no_headings", detail: noHeadingsDetail });
  if (sentences.length < MIN_SENTENCES) {
    warnings.push({
      kind: "too_short",
      detail: `Only ${sentences.length} sentence(s); expect fewer summary points and possibly fewer than five questions.`,
    });
  }

  return ok({
    ...(docTitle ? { title: docTitle } : {}),
    sentences,
    sections: outSections,
    warnings,
    stats: {
      sentences: sentences.length,
      sections: outSections.length,
      characters: text.length,
      excludedBlocks: excluded.length,
    },
  });
}
