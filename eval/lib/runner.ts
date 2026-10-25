import { performance } from "node:perf_hooks";
import { type LlmClient, ZERO_USAGE } from "../../src/core/ports/llm";
import type { Nli } from "../../src/core/ports/nli";
import { err } from "../../src/core/ports/result";
import { mapPool } from "../../src/core/util/pool";
import { createVerifier, type Thresholds } from "../../src/core/verify";
import { FakeLlmClient } from "../../src/llm/fake";
import { type EvalCase, parseCase, toDraftItems } from "./cases";
import type { DraftResult } from "./metrics";

export type JudgeKind = "live" | "fake" | "off";

/**
 * The stand-in judges for offline runs.
 * - `fake` always answers "pass": it neither helps nor hurts, so the result measures the quote
 *   check, the entailment model, the novel-fact scan and the wording check on their own.
 * - `off` fails every call, which is what a down provider looks like: by invariant 1 nothing can
 *   then be SUPPORTED, so the numbers show the degraded mode, not the verifier's quality.
 */
export function offlineJudge(kind: "fake" | "off"): LlmClient {
  if (kind === "fake") {
    return new FakeLlmClient({
      submit_verdict: { unsupported_parts: [], verdict: "pass" },
      submit_distractor_review: { options: [] },
    });
  }
  return {
    async generateStructured() {
      return err({
        code: "provider" as const,
        message: "the second reviewer is switched off (--judge=off)",
        usage: ZERO_USAGE,
      });
    },
  };
}

export interface VerifyCasesOptions {
  cases: readonly EvalCase[];
  nli: Nli;
  llm: LlmClient;
  thresholds?: Thresholds;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Verification only: the static drafts of each case go through the real verifier. Nothing is
 * generated. The judge runs on every draft that has a citation (`exhaustive`) so a later threshold
 * sweep has its answer for every draft; the verdict is the same as with gating, because a draft the
 * other checks have already settled cannot be changed by the judge.
 */
export async function verifyCases(opts: VerifyCasesOptions): Promise<DraftResult[]> {
  const tasks: { c: EvalCase; index: number; run: () => Promise<DraftResult> }[] = [];

  for (const c of opts.cases) {
    const doc = await parseCase(c);
    const verifier = createVerifier(doc, {
      nli: opts.nli,
      llm: opts.llm,
      thresholds: opts.thresholds,
      exhaustive: true,
    });
    const items = toDraftItems(c, doc);
    c.drafts.forEach((d, index) => {
      const item = items[index];
      if (!item) return;
      tasks.push({
        c,
        index,
        run: async () => {
          const started = performance.now();
          const v = await verifier.verify(item);
          return {
            id: item.itemId,
            caseId: c.id,
            split: c.split,
            type: d.type,
            label: d.label,
            failureType: d.failureType,
            text: d.text,
            verdict: v.verdict,
            reasons: v.reasons,
            degraded: v.degraded,
            scores: v.scores,
            checks: v.checks,
            latencyMs: Math.round(performance.now() - started),
            usage: v.usage,
          };
        },
      });
    });
  }

  let done = 0;
  return mapPool(tasks, opts.concurrency ?? 2, async (t) => {
    const r = await t.run();
    opts.onProgress?.(++done, tasks.length);
    return r;
  });
}
