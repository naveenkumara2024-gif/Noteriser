import type { RemovalKind } from "../pipeline/types";
import type { QuestionType } from "../schema/items";

/** Lore §10: the persistent label against over-trust. Every export and the UI carry it. */
export const TRUST_NOTICE =
  "Generated from instructor-approved notes. Check flagged items against the source.";

export const DEGRADED_NOTICE =
  "Verifier degraded: some checks could not run for this run, so affected items are capped at partial. Do not treat them as verified.";

export const INCOMPLETE_NOTICE =
  "This run was stopped before it finished. What is shown is what had been checked.";

export const FAILED_NOTICE = "This run could not produce study aids.";

export const REMOVAL_LABEL: Record<RemovalKind, string> = {
  unsupported: "Not supported",
  contradicted: "Contradicted by the notes",
  duplicate: "Duplicate",
  surplus: "Not needed",
};

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  mcq: "Multiple choice",
  short: "Short answer",
  true_false: "True or false",
};

export const OPTION_LETTERS = "ABCDEFGH";
