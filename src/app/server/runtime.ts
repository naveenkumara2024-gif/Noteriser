import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { EnvError, parseEnv, warnIfJudgeEqualsGenerator } from "@/config/env";
import { createLogger } from "@/config/logger";
import type { PipelineDeps, RunLimits } from "@/core/pipeline";
import type { LlmClient } from "@/core/ports/llm";
import type { RunStore } from "@/core/ports/store";
import { lecture7Fakes } from "@/demo";
import { MemoryRunStore } from "@/store/memory";
import { startPurgeSchedule } from "@/store/purge";
import { ApiError, errorResponse } from "./errors";
import { createRateLimiter, type RateLimiter } from "./rate-limit";

/** What the pipeline needs besides the per-run pieces (store, clock, ids, signal, event sink). */
export type BaseDeps = Omit<PipelineDeps, "clock" | "newId" | "onEvent" | "signal" | "store">;

/** Everything a request handler needs. Built once per server process; tests build their own. */
export interface Runtime {
  mode: "live" | "fake";
  /** How long runs are kept; also how long the browser that made a run stays its owner. */
  ttlHours: number;
  /** Caps applied to every run (length, model calls, cost, time). */
  limits: RunLimits;
  deps: BaseDeps;
  store: RunStore;
  limiter: RateLimiter;
  clock: () => Date;
  newId: () => string;
  log: Logger;
}

/** Server-only settings that are not about models. Bad values fall back to the default. */
function intFromEnv(name: string, fallback: number, min: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min ? n : fallback;
}

function numberFromEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Test and demo aid: slows the scripted fakes so progress and cancelling are visible. */
function delayed(llm: LlmClient, ms: number): LlmClient {
  if (ms <= 0) return llm;
  return {
    async generateStructured(req) {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return llm.generateStructured(req);
    },
  };
}

async function createRuntime(): Promise<Runtime> {
  const log = createLogger();
  const env = parseEnv({ ...process.env });
  const limiter = createRateLimiter({
    max: intFromEnv("RATE_LIMIT_RUNS", 6, 1),
    windowMs: intFromEnv("RATE_LIMIT_WINDOW_MINUTES", 10, 1) * 60_000,
  });
  const common = {
    limiter,
    ttlHours: env.runTtlHours,
    limits: {
      maxSentences: intFromEnv("MAX_SENTENCES", 600, 1),
      maxLlmCalls: intFromEnv("MAX_LLM_CALLS", 800, 1),
      maxCostUsd: numberFromEnv("MAX_COST_USD", 2),
      timeoutMs: intFromEnv("RUN_TIMEOUT_MINUTES", 30, 1) * 60_000,
    },
    clock: () => new Date(),
    newId: () => randomUUID(),
    log,
  };

  let runtime: Runtime;
  if (env.llmMode === "fake") {
    const fakes = lecture7Fakes();
    const llm = delayed(fakes.llm, intFromEnv("FAKE_DELAY_MS", 0, 0));
    runtime = { ...common, mode: "fake", deps: { ...fakes, llm }, store: new MemoryRunStore() };
  } else {
    const warning = warnIfJudgeEqualsGenerator(env);
    if (warning) log.warn(warning);
    const { createPiLlmClient } = await import("@/llm/pi");
    const client = await createPiLlmClient(env);
    if (!client.ok) throw new EnvError([client.error.message]);
    const { HfNli } = await import("@/nlp/nli");
    const { HfEmbedder } = await import("@/nlp/embed");
    const { SqliteRunStore } = await import("@/store/sqlite");
    const [nli, embedder] = await Promise.all([HfNli.load(), HfEmbedder.load()]);
    const store = SqliteRunStore.open(process.env.NOTERISER_DB ?? "data/noteriser.db");
    runtime = { ...common, mode: "live", deps: { llm: client.value, nli, embedder }, store };
  }

  startPurgeSchedule(runtime.store, {
    ttlHours: env.runTtlHours,
    onPurged: (removed) => removed > 0 && log.info({ removed }, "expired runs purged"),
    onError: () => log.error("purging expired runs failed"),
  });
  return runtime;
}

const globalForRuntime = globalThis as { __noteriserRuntime?: Promise<Runtime> };

/**
 * One runtime per process (it holds the loaded models and the store). Kept on `globalThis` so
 * dev-server module reloads reuse it. A failed start is not remembered, so fixing `.env.local`
 * and retrying works without restarting.
 */
export function getRuntime(): Promise<Runtime> {
  if (!globalForRuntime.__noteriserRuntime) {
    const starting = createRuntime();
    globalForRuntime.__noteriserRuntime = starting;
    starting.catch(() => {
      if (globalForRuntime.__noteriserRuntime === starting) {
        globalForRuntime.__noteriserRuntime = undefined;
      }
    });
  }
  return globalForRuntime.__noteriserRuntime;
}

/**
 * For route handlers: the runtime, or the 503 to return. The reason is logged here and kept out of
 * the response, which only says the server is not set up (it could otherwise reveal configuration).
 */
export async function runtimeOrError(): Promise<Runtime | Response> {
  try {
    return await getRuntime();
  } catch (e) {
    createLogger().error(
      { reason: e instanceof EnvError ? e.issues : "startup failed" },
      "runtime",
    );
    return errorResponse(
      new ApiError(
        503,
        "not_configured",
        "The server's model setup is incomplete. Ask whoever runs this server to check the configuration.",
      ),
    );
  }
}
