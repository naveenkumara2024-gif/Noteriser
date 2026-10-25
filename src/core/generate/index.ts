import type { SourceDoc } from "../schema/source";
import { generateGlossary } from "./glossary";
import { generateQuestions } from "./questions";
import { generateSummary } from "./summary";
import type { GenerateDeps, GenerationOutcome } from "./types";

export { generateGlossary } from "./glossary";
export { glossaryPrompt, questionsPrompt, rollupPrompt, summaryPrompt } from "./prompts";
export { generateQuestions } from "./questions";
export { renderSource, sectionsOf } from "./render";
export { GlossaryOutput, QuestionsOutput, SummaryOutput, TOOL_NAMES } from "./schemas";
export { generateSummary } from "./summary";
export * from "./types";

export interface Drafts {
  summary: GenerationOutcome;
  glossary: GenerationOutcome;
  questions: GenerationOutcome;
}

/**
 * All three artefacts at the same time. They share nothing (each numbers its own items), so the
 * wait is the slowest of the three rather than their sum. How many model calls are actually in
 * flight is capped by the client the caller passes (see `limitInFlight`), not here.
 */
export async function generateDrafts(doc: SourceDoc, deps: GenerateDeps): Promise<Drafts> {
  const [summary, glossary, questions] = await Promise.all([
    generateSummary(doc, deps),
    generateGlossary(doc, deps),
    generateQuestions(doc, deps),
  ]);
  return { summary, glossary, questions };
}
