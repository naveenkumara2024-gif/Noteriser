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

/** All three artefacts, one after another (keeps provider rate limits simple). */
export async function generateDrafts(doc: SourceDoc, deps: GenerateDeps): Promise<Drafts> {
  const summary = await generateSummary(doc, deps);
  const glossary = await generateGlossary(doc, deps);
  const questions = await generateQuestions(doc, deps);
  return { summary, glossary, questions };
}
