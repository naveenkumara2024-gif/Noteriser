import type { Static, TSchema } from "typebox";
import { addUsage, ZERO_USAGE } from "../ports/llm";
import { mapPool } from "../util/pool";
import { insufficiencyOf, type Mapped } from "./draft";
import type { Prompt } from "./prompts";
import { TOOL_NAMES } from "./schemas";
import {
  DEFAULT_CONCURRENCY,
  GENERATOR_TEMPERATURE,
  type GenerateDeps,
  type GenerationFailure,
  type GenerationOutcome,
} from "./types";

export interface CallResult<TItem> {
  scope: string;
  items: TItem[];
  failure?: GenerationFailure;
  insufficient?: { scope: string; reason: string };
  problems: string[];
  usage: GenerationOutcome["usage"];
}

const TASK_OF_TOOL: Record<string, string> = {
  [TOOL_NAMES.summary]: "summary",
  [TOOL_NAMES.rollup]: "rollup",
  [TOOL_NAMES.glossary]: "glossary",
  [TOOL_NAMES.questions]: "questions",
};

/** One schema-constrained generator call, folded into the common result shape. Never throws. */
export async function generateCall<S extends TSchema, TItem>(
  deps: GenerateDeps,
  scope: string,
  toolName: string,
  schema: S,
  prompt: Prompt,
  map: (value: Static<S>) => Mapped<TItem> & { insufficientReason: string },
): Promise<CallResult<TItem>> {
  const task = TASK_OF_TOOL[toolName] ?? toolName;
  deps.onProgress?.({ task, scope, phase: "start" });
  const res = await deps.llm.generateStructured({
    role: "generator",
    system: prompt.system,
    user: prompt.user,
    toolName,
    schema,
    temperature: GENERATOR_TEMPERATURE,
    signal: deps.signal,
  });

  if (!res.ok) {
    deps.onProgress?.({ task, scope, phase: "failed", detail: res.error.message });
    return {
      scope,
      items: [],
      failure: { scope, error: res.error },
      problems: [],
      usage: res.error.usage,
    };
  }

  const mapped = map(res.value.value);
  const reason = insufficiencyOf(mapped.insufficientReason);
  deps.onProgress?.({
    task,
    scope,
    phase: "done",
    detail: reason ? `no items (${reason})` : `${mapped.items.length} item(s)`,
  });
  return {
    scope,
    items: mapped.items,
    ...(reason ? { insufficient: { scope, reason } } : {}),
    problems: mapped.problems,
    usage: res.value.usage,
  };
}

export { mapPool };

export const concurrencyOf = (deps: GenerateDeps): number =>
  deps.concurrency ?? DEFAULT_CONCURRENCY;

/** Merge per-call results (already in a stable order) into one outcome; ids are assigned by the caller. */
export function mergeCalls<TItem>(calls: CallResult<TItem>[]): {
  items: TItem[];
  failures: GenerationFailure[];
  insufficient: { scope: string; reason: string }[];
  problems: string[];
  usage: GenerationOutcome["usage"];
} {
  return {
    items: calls.flatMap((c) => c.items),
    failures: calls.flatMap((c) => (c.failure ? [c.failure] : [])),
    insufficient: calls.flatMap((c) => (c.insufficient ? [c.insufficient] : [])),
    problems: calls.flatMap((c) => c.problems),
    usage: calls.reduce((u, c) => addUsage(u, c.usage), ZERO_USAGE),
  };
}
