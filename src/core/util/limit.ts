import type { LlmClient } from "../ports/llm";
import { err } from "../ports/result";

/**
 * Caps how many model calls are in flight at once across the WHOLE run, however many stages ask
 * at the same time. Stages can then overlap (summary, glossary and questions are generated
 * together) without ever sending more than `max` requests to the provider, which keeps a free
 * tier's rate limit and a slow model's queue in check. First come, first served.
 *
 * A call that is still waiting when the run is cancelled is refused with an `aborted` error
 * instead of being sent.
 */
export function limitInFlight(llm: LlmClient, max: number): LlmClient {
  const limit = Math.max(1, Math.floor(max));
  let active = 0;
  const waiting: (() => void)[] = [];

  /** Hands the slot straight to the next waiter, or frees it. */
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  return {
    generateStructured: async (req) => {
      if (active >= limit) {
        const proceed = await new Promise<boolean>((resolve) => {
          const onAbort = (): void => {
            const at = waiting.indexOf(go);
            if (at >= 0) waiting.splice(at, 1);
            resolve(false);
          };
          const go = (): void => {
            req.signal?.removeEventListener("abort", onAbort);
            resolve(true);
          };
          if (req.signal?.aborted) return resolve(false);
          req.signal?.addEventListener("abort", onAbort, { once: true });
          waiting.push(go);
        });
        if (!proceed) {
          return err({
            code: "aborted" as const,
            message: "The run was stopped before this call was sent.",
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          });
        }
        // The slot was handed over by `release`; `active` already counts it.
      } else {
        active++;
      }
      try {
        return await llm.generateStructured(req);
      } finally {
        release();
      }
    },
  };
}
