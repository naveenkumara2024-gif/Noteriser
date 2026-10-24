import type { SourceDoc, SourceSentence } from "../schema/source";

export interface SectionView {
  number: number;
  title: string;
  sentences: SourceSentence[];
}

export function sectionsOf(doc: SourceDoc): SectionView[] {
  const byId = new Map(doc.sentences.map((s) => [s.id, s]));
  return doc.sections.map((sec) => ({
    number: sec.number,
    title: sec.title,
    sentences: sec.sentenceIds.flatMap((id) => {
      const s = byId.get(id);
      return s ? [s] : [];
    }),
  }));
}

/** The delimiter is part of the injection defence: source text must not be able to close it. */
const neutralise = (text: string): string => text.replace(/<(\/?)source/gi, "&lt;$1source");

/**
 * `<source>` block with numbered sentences, grouped under section headings:
 *
 *     ## Section 2: Scheduling criteria
 *     [S2.1] CPU utilization is ...
 */
export function renderSource(sentences: SourceSentence[]): string {
  const lines: string[] = ["<source>"];
  let current: number | undefined;
  for (const s of sentences) {
    if (s.section !== current) {
      current = s.section;
      lines.push(`## Section ${s.section}: ${neutralise(s.sectionTitle)}`);
    }
    lines.push(`[${s.id}] ${neutralise(s.text)}`);
  }
  lines.push("</source>");
  return lines.join("\n");
}
