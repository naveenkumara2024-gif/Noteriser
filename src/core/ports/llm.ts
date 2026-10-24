import type { Static, TSchema } from "typebox";
import type { Result } from "./result";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

export const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  costUsd: a.costUsd + b.costUsd,
});

/** Invariant 2: generator and judge are separate roles, normally separate models. */
export type LlmRole = "generator" | "judge";

export interface LlmError {
  code: "no_tool_call" | "invalid_args" | "provider" | "aborted";
  message: string;
  /** Tokens and cost spent before the failure; failed calls still cost money. */
  usage: Usage;
}

export interface StructuredRequest<S extends TSchema> {
  role: LlmRole;
  system: string;
  user: string;
  /** Name of the single tool whose parameters are `schema`. */
  toolName: string;
  toolDescription?: string;
  schema: S;
  temperature?: number;
  signal?: AbortSignal;
}

export interface StructuredResponse<S extends TSchema> {
  value: Static<S>;
  usage: Usage;
}

/**
 * Port for schema-constrained generation. Implementations never throw for provider or validation
 * failures: they return an `LlmError`, so one bad call becomes a visible verdict, not a crashed run.
 */
export interface LlmClient {
  generateStructured<S extends TSchema>(
    req: StructuredRequest<S>,
  ): Promise<Result<StructuredResponse<S>, LlmError>>;
}
