import type { SourceDoc } from "../schema/source";
import { knownIds, mapSummary, numberItems } from "./draft";
import { rollupPrompt, summaryPrompt } from "./prompts";
import { sectionsOf } from "./render";
import { concurrencyOf, generateCall, mapPool, mergeCalls } from "./run";
import { SummaryOutput, TOOL_NAMES } from "./schemas";
import {
  type GenerateDeps,
  type GenerationOutcome,
  LONG_DOC_SENTENCES,
  type SummaryDraft,
} from "./types";

export interface SummaryOptions {
  /** Only these section numbers (a targeted retry for sections the first pass left uncovered). */
  sections?: readonly number[];
  /** First item number, so ids continue after the drafts that already exist. Default 1. */
  startAt?: number;
  /** Skip the roll-up pass even for a long document. */
  rollup?: boolean;
}

/**
 * Per-section summary points; long documents get one extra roll-up pass whose points must cite
 * the original sentences, not the section summaries.
 */
export async function generateSummary(
  doc: SourceDoc,
  deps: GenerateDeps,
  options: SummaryOptions = {},
): Promise<GenerationOutcome> {
  const known = knownIds(doc);
  const wanted = options.sections ? new Set(options.sections) : undefined;
  const sections = sectionsOf(doc).filter((s) => !wanted || wanted.has(s.number));
  const startAt = options.startAt ?? 1;

  const calls = await mapPool(sections, concurrencyOf(deps), (sec) => {
    const scope = `section:${sec.number}`;
    return generateCall(
      deps,
      scope,
      TOOL_NAMES.summary,
      SummaryOutput,
      summaryPrompt(sec),
      (v) => ({
        ...mapSummary(v, scope, known),
        insufficientReason: v.insufficient_reason,
      }),
    );
  });
  const sectionItems = numberItems<SummaryDraft>("sum", mergeCalls(calls).items, startAt);

  const wantRollup = options.rollup ?? true;
  const rollup =
    wantRollup && doc.sentences.length > LONG_DOC_SENTENCES && sectionItems.length > 0
      ? await generateCall(
          deps,
          "rollup",
          TOOL_NAMES.rollup,
          SummaryOutput,
          rollupPrompt(sectionItems, doc),
          (v) => ({
            ...mapSummary(v, "rollup", known),
            insufficientReason: v.insufficient_reason,
          }),
        )
      : undefined;

  const merged = mergeCalls(rollup ? [...calls, rollup] : calls);
  const rollupItems = rollup
    ? numberItems<SummaryDraft>("sum", rollup.items, startAt + sectionItems.length)
    : [];
  return { ...merged, items: [...sectionItems, ...rollupItems] };
}
