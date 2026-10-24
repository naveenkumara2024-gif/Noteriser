import type { SourceDoc } from "../schema/source";
import { knownIds, mapGlossary, numberItems } from "./draft";
import { glossaryPrompt } from "./prompts";
import { sectionsOf } from "./render";
import { concurrencyOf, generateCall, mapPool, mergeCalls } from "./run";
import { GlossaryOutput, TOOL_NAMES } from "./schemas";
import type { GenerateDeps, GenerationOutcome, GlossaryDraft } from "./types";

/** Terms the source itself defines, per section. Terms it only uses are deliberately skipped. */
export async function generateGlossary(
  doc: SourceDoc,
  deps: GenerateDeps,
): Promise<GenerationOutcome> {
  const known = knownIds(doc);

  const calls = await mapPool(sectionsOf(doc), concurrencyOf(deps), (sec) => {
    const scope = `section:${sec.number}`;
    return generateCall(
      deps,
      scope,
      TOOL_NAMES.glossary,
      GlossaryOutput,
      glossaryPrompt(sec),
      (v) => ({ ...mapGlossary(v, scope, known), insufficientReason: v.insufficient_reason }),
    );
  });

  const merged = mergeCalls(calls);
  return { ...merged, items: numberItems<GlossaryDraft>("glo", merged.items) };
}
