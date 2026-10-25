import type { RunResult } from "../pipeline/types";
import { OPTION_LETTERS } from "./labels";
import { buildModel, type ExportModel, type ExportOptions } from "./model";

const sources = (ids: readonly string[]): string => `(Source: ${ids.join(", ")})`;

/**
 * The same content as the Markdown, with no markup at all: headings in capitals, flags as
 * `WARNING:` lines. Written to read well in a screen reader or text-to-speech.
 */
function renderTextModel(m: ExportModel): string {
  const out: string[] = [m.title.toUpperCase(), "", m.notice, ""];
  for (const banner of m.banners) out.push(`WARNING: ${banner}`, "");
  if (m.generatedAt) out.push(`Generated ${m.generatedAt.slice(0, 10)}.`, "");

  const section = (name: string): void => void out.push(name.toUpperCase(), "");
  const empty = (list: readonly unknown[]): void => {
    if (list.length === 0) out.push("Nothing in this section passed the checks.", "");
  };
  const notes = (flag?: string, kept?: string): void => {
    if (flag) out.push(`   WARNING: Check against source - ${flag}`);
    if (kept) out.push(`   Kept original wording: ${kept}.`);
  };

  section("Summary");
  empty(m.summary);
  m.summary.forEach((item, i) => {
    out.push(`${i + 1}. ${item.text} ${sources(item.sourceIds)}`);
    notes(item.flag, item.keptOriginal);
    out.push("");
  });

  section("Glossary");
  empty(m.glossary);
  for (const item of m.glossary) {
    out.push(`${item.term ? `${item.term}: ` : ""}${item.text} ${sources(item.sourceIds)}`);
    notes(item.flag, item.keptOriginal);
    out.push("");
  }

  section("Practice questions");
  empty(m.questions);
  m.questions.forEach((item, i) => {
    const type = item.question ? `${item.question.typeLabel}. ` : "";
    out.push(`${i + 1}. ${type}${item.text} ${sources(item.sourceIds)}`);
    for (const [k, option] of (item.question?.options ?? []).entries()) {
      out.push(`   ${OPTION_LETTERS[k] ?? k + 1}. ${option}`);
    }
    notes(item.flag, item.keptOriginal);
    out.push("");
  });

  if (m.questions.length > 0) {
    section("Answer key");
    m.questions.forEach((item, i) => {
      if (item.question) {
        out.push(`${i + 1}. ${item.question.answer} ${sources(item.question.answerSourceIds)}`);
      }
    });
    out.push("");
  }

  section("Run report");
  out.push(m.report, "");

  if (m.notices.length > 0 || m.docWarnings.length > 0) {
    section("Notes about this run");
    for (const n of [...m.docWarnings, ...m.notices]) out.push(`- ${n}`);
    out.push("");
  }

  section("Appendix A: Removed items");
  out.push(
    "Drafts that did not pass the checks, or were not needed. They are not part of the study aids above.",
    "",
  );
  if (m.removed.length === 0) out.push("No items were removed.", "");
  for (const r of m.removed) {
    out.push(`${r.id} (${r.label}): ${r.term ? `${r.term}: ` : ""}${r.text}`);
    for (const reason of r.reasons) out.push(`   Why: ${reason}`);
    for (const c of r.failedChecks) out.push(`   ${c}`);
    if (r.repairNote) out.push(`   Repair was tried: ${r.repairNote}`);
    if (r.duplicateOf) out.push(`   Kept instead: ${r.duplicateOf}`);
    if (r.citedIds.length > 0) out.push(`   It cited: ${r.citedIds.join(", ")}`);
    out.push("");
  }

  section("Appendix B: Source sentences");
  for (const group of m.sources) {
    out.push(group.heading);
    for (const s of group.sentences) out.push(`   ${s.id} - ${s.text}`);
    out.push("");
  }

  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

export function renderText(result: RunResult, options: ExportOptions = {}): string {
  return renderTextModel(buildModel(result, options));
}
