import type { RunResult } from "../pipeline/types";
import { OPTION_LETTERS } from "./labels";
import { buildModel, type ExportItem, type ExportModel, type ExportOptions } from "./model";

/** Escapes what Markdown would otherwise act on. `[` and `]` are escaped so the only live `[S2.4]` in a file is a real citation. */
export function escapeMarkdown(s: string): string {
  return s.replace(/([\\`*_[\]<>~])/g, "\\$1").replace(/^(#+\s|[-+]\s|\d+[.)]\s|>)/, "\\$1");
}

const cite = (ids: readonly string[]): string => ids.map((id) => `[${id}]`).join(" ");

/** Literal warning line for a flagged item (invariant 6: text, not colour). */
export const FLAG_LINE = (reason: string): string => `⚠ Check against source — ${reason}`;

function itemLines(item: ExportItem, body: string): string[] {
  const lines = [body];
  if (item.flag) lines.push("", `   ${FLAG_LINE(escapeMarkdown(item.flag))}`);
  if (item.keptOriginal) {
    lines.push("", `   _Kept original wording: ${escapeMarkdown(item.keptOriginal)}._`);
  }
  return lines;
}

const NOTHING = "_Nothing in this section passed the checks._";

/** The study aids as Markdown: answers in their own section, removed items and sources in appendices. */
function renderMarkdownModel(m: ExportModel): string {
  const out: string[] = [`# ${escapeMarkdown(m.title)}`, "", `> ${escapeMarkdown(m.notice)}`, ""];
  for (const banner of m.banners) out.push(`> ⚠ ${escapeMarkdown(banner)}`, "");
  if (m.generatedAt) out.push(`_Generated ${m.generatedAt.slice(0, 10)}._`, "");

  out.push("## Summary", "");
  if (m.summary.length === 0) out.push(NOTHING, "");
  m.summary.forEach((item, i) => {
    out.push(
      ...itemLines(item, `${i + 1}. ${escapeMarkdown(item.text)} ${cite(item.sourceIds)}`),
      "",
    );
  });

  out.push("## Glossary", "");
  if (m.glossary.length === 0) out.push(NOTHING, "");
  for (const item of m.glossary) {
    const term = item.term ? `**${escapeMarkdown(item.term)}**: ` : "";
    out.push(
      ...itemLines(item, `- ${term}${escapeMarkdown(item.text)} ${cite(item.sourceIds)}`),
      "",
    );
  }

  out.push("## Practice questions", "");
  if (m.questions.length === 0) out.push(NOTHING, "");
  m.questions.forEach((item, i) => {
    const q = item.question;
    const label = q ? `_${q.typeLabel}_ — ` : "";
    out.push(
      ...itemLines(item, `${i + 1}. ${label}${escapeMarkdown(item.text)} ${cite(item.sourceIds)}`),
    );
    for (const [k, option] of (q?.options ?? []).entries()) {
      out.push(`   - ${OPTION_LETTERS[k] ?? k + 1}. ${escapeMarkdown(option)}`);
    }
    out.push("");
  });

  if (m.questions.length > 0) {
    out.push("## Answer key", "");
    m.questions.forEach((item, i) => {
      if (item.question) {
        out.push(
          `${i + 1}. ${escapeMarkdown(item.question.answer)} ${cite(item.question.answerSourceIds)}`,
        );
      }
    });
    out.push("");
  }

  out.push("## Run report", "", "```text", m.report, "```", "");

  if (m.notices.length > 0 || m.docWarnings.length > 0) {
    out.push("## Notes about this run", "");
    for (const n of [...m.docWarnings, ...m.notices]) out.push(`- ${escapeMarkdown(n)}`);
    out.push("");
  }

  out.push(
    "## Appendix A: Removed items",
    "",
    "Drafts that did not pass the checks, or were not needed. They are listed here so nothing disappears silently, and they are not part of the study aids above.",
    "",
  );
  if (m.removed.length === 0) out.push("_No items were removed._", "");
  for (const r of m.removed) {
    const term = r.term ? `${escapeMarkdown(r.term)}: ` : "";
    out.push(`- **${r.id}** (${r.label}): ${term}${escapeMarkdown(r.text)}`);
    for (const reason of r.reasons) out.push(`  - Why: ${escapeMarkdown(reason)}`);
    for (const c of r.failedChecks) out.push(`  - ${escapeMarkdown(c)}`);
    if (r.repairNote) out.push(`  - Repair was tried: ${escapeMarkdown(r.repairNote)}`);
    if (r.duplicateOf) out.push(`  - Kept instead: ${r.duplicateOf}`);
    if (r.citedIds.length > 0) out.push(`  - It cited: ${r.citedIds.join(", ")}`);
  }
  out.push("");

  out.push("## Appendix B: Source sentences", "", "Every sentence cited above, once.", "");
  for (const group of m.sources) {
    out.push(`### ${escapeMarkdown(group.heading)}`, "");
    for (const s of group.sentences) out.push(`- ${s.id} — ${escapeMarkdown(s.text)}`);
    out.push("");
  }

  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

export function renderMarkdown(result: RunResult, options: ExportOptions = {}): string {
  return renderMarkdownModel(buildModel(result, options));
}
