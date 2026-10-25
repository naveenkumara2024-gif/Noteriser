import type { LlmClient } from "../ports/llm";
import { err } from "../ports/result";

/** Caps that stop a run before it costs too much or runs too long. Any field left out is unlimited. */
export interface RunLimits {
  /** Longest source accepted, in sentences. Checked right after parsing. */
  maxSentences?: number;
  /** Most model calls (generation, judging, repair, rewriting) in one run. */
  maxLlmCalls?: number;
  /** Most the model calls may cost, in US dollars, from the usage each call reports. */
  maxCostUsd?: number;
  /** Longest a run may take, in milliseconds. */
  timeoutMs?: number;
}

export interface Tripped {
  kind: "llm_calls" | "cost" | "timeout";
  message: string;
}

/**
 * Enforces `RunLimits` for one run. When a cap is hit it records why, aborts `signal`, and refuses
 * further model calls, so every stage winds down the same way a cancelled run does: what finished
 * is kept and reported, and the run says which limit stopped it.
 */
export class LimitGuard {
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private calls = 0;
  private spent = 0;
  tripped: Tripped | undefined;

  constructor(private readonly limits: RunLimits) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  start(): void {
    const ms = this.limits.timeoutMs;
    if (ms === undefined) return;
    this.timer = setTimeout(
      () =>
        this.trip({
          kind: "timeout",
          message: `The run took longer than its limit of ${ms >= 1000 ? `${Math.round(ms / 1000)} seconds` : `${ms} ms`} and was stopped.`,
        }),
      ms,
    );
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  private trip(t: Tripped): void {
    if (this.tripped) return;
    this.tripped = t;
    this.controller.abort();
  }

  /** The model client the run must use: counts calls and cost, and stops at the caps. */
  wrap(llm: LlmClient): LlmClient {
    return {
      generateStructured: async (req) => {
        const refuse = (message: string) =>
          err({
            code: "aborted" as const,
            message,
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          });
        if (this.tripped) return refuse(this.tripped.message);
        const { maxLlmCalls, maxCostUsd } = this.limits;
        if (maxLlmCalls !== undefined && this.calls >= maxLlmCalls) {
          const t: Tripped = {
            kind: "llm_calls",
            message: `The run reached its limit of ${maxLlmCalls} model calls and was stopped.`,
          };
          this.trip(t);
          return refuse(t.message);
        }
        this.calls++;
        const result = await llm.generateStructured(req);
        // Failed calls cost money too; their usage is on the error.
        this.spent += result.ok ? result.value.usage.costUsd : result.error.usage.costUsd;
        if (maxCostUsd !== undefined && this.spent > maxCostUsd) {
          this.trip({
            kind: "cost",
            message: `The run passed its cost limit of $${maxCostUsd.toFixed(2)} and was stopped.`,
          });
        }
        return result;
      },
    };
  }
}
