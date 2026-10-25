import {
  type Api,
  type AssistantMessage,
  type Message,
  type Model,
  type Models,
  type MutableModels,
  type Tool,
  validateToolCall,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { Static, TSchema } from "typebox";
import { type Env, type ModelRef, profilePrefix } from "../config/env";
import {
  addUsage,
  type LlmClient,
  type LlmError,
  type StructuredRequest,
  type StructuredResponse,
  type Usage,
  ZERO_USAGE,
} from "../core/ports/llm";
import { err, ok, type Result } from "../core/ports/result";
import { apiKeyVariables, type CustomRef, customProvider } from "./custom";

/** One corrective retry (invalid arguments or no tool call), then give up. */
const MAX_RETRIES = 1;
/** Provider hiccups (overload, rate limit, network): up to 2 more tries, waiting 2 s then 4 s. */
const MAX_TRANSIENT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 2_000;

const TRANSIENT =
  /\b(?:429|500|502|503|504|529)\b|temporar|unavailab|overload|rate.?limit|too many requests|timed? ?out|try again|econnreset|econnrefused|socket hang up|fetch failed|network/i;

/** Per-minute quotas need a much longer wait than an overload blip. */
const RATE_LIMITED = /\b429\b|rate.?limit|too many requests/i;
const RATE_LIMIT_BACKOFF = 8;

/**
 * A quota that resets tomorrow, or needs credits: waiting seconds cannot help, so retrying only
 * burns minutes (a daily free-tier limit looks like "429 ... free-models-per-day").
 */
const QUOTA_EXHAUSTED =
  /per[- ]?day|daily|insufficient (?:credits|funds|quota)|(?:quota|credits?) (?:exceeded|exhausted|used up)|out of credits|payment required|\b402\b|add \d+ credits/i;
/** After a quota error, calls to that model are refused at once for this long instead of being sent. */
const QUOTA_COOLDOWN_MS = 5 * 60_000;

export function isQuotaExhausted(message: string): boolean {
  return QUOTA_EXHAUSTED.test(message);
}

/** Heuristic on the provider's message: worth retrying, as opposed to a bad key, unknown model or used-up quota. */
export function isTransientError(message: string): boolean {
  return TRANSIENT.test(message) && !isQuotaExhausted(message);
}

const quotaMessage = (message: string): string =>
  `The model provider's quota is used up, so the call was not retried (change LLM_PROFILE, add credits, or wait for the reset): ${message.slice(0, 240)}`;

/** Resolves true after `ms`, or false right away if the signal aborts first. */
function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = (value: boolean): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = (): void => done(false);
    const timer = setTimeout(() => done(true), ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
const MAX_OUTPUT_TOKENS = 8192;
const DEFAULT_TOOL_DESCRIPTION = "Submit the complete answer in the required structure.";

export interface PiLlmOptions {
  /** Only `complete` is used, so tests can pass a real `Models` backed by the Faux provider or a stub. */
  models: Pick<Models, "complete">;
  generator: Model<Api>;
  judge: Model<Api>;
  maxTokens?: number;
  /** Base wait before retrying a transient provider error; multiplied per attempt. Tests use 0. */
  retryDelayMs?: number;
}

const usageOf = (m: AssistantMessage): Usage => ({
  inputTokens: m.usage.input,
  outputTokens: m.usage.output,
  costUsd: m.usage.cost.total,
});

const modelKey = (m: Model<Api>): string => `${m.provider}:${m.id}`;

/**
 * `LlmClient` over pi-ai. pi-ai has no JSON mode and cannot force a tool, so the contract is:
 * offer exactly one tool whose parameters are the output schema (with provider-side strict
 * enforcement where supported), instruct the model to call it, validate the arguments, and send one
 * corrective message if it did not. Failures come back as `LlmError`, never as exceptions.
 */
export class PiLlmClient implements LlmClient {
  /** Models that rejected `temperature`; it is omitted for them from then on. */
  private readonly rejectsTemperature = new Set<string>();
  /** Models whose quota is used up: when to try them again, and what the provider said. */
  private readonly quotaUntil = new Map<string, { until: number; message: string }>();

  constructor(private readonly opts: PiLlmOptions) {}

  async generateStructured<S extends TSchema>(
    req: StructuredRequest<S>,
  ): Promise<Result<StructuredResponse<S>, LlmError>> {
    const model = req.role === "judge" ? this.opts.judge : this.opts.generator;
    const key = modelKey(model);
    const tool: Tool = {
      name: req.toolName,
      description: req.toolDescription ?? DEFAULT_TOOL_DESCRIPTION,
      parameters: req.schema,
      constrainedSampling: { type: "json_schema", strict: "prefer" },
    };
    const systemPrompt = `${req.system}\n\nRespond by calling the tool \`${req.toolName}\` exactly once with your complete answer. Do not reply in plain text.`;
    const messages: Message[] = [{ role: "user", content: req.user, timestamp: Date.now() }];

    // A model whose quota ran out a moment ago would only answer the same error: say so at once.
    const exhausted = this.quotaUntil.get(key);
    if (exhausted && Date.now() < exhausted.until) {
      return err({ code: "provider", message: exhausted.message, usage: ZERO_USAGE });
    }

    let usage = ZERO_USAGE;
    let last: Omit<LlmError, "usage"> = { code: "no_tool_call", message: "no attempt was made" };
    let retries = 0;
    let temperatureDropped = false;
    let transientRetries = 0;

    for (;;) {
      const temperature =
        req.temperature !== undefined && !this.rejectsTemperature.has(key)
          ? req.temperature
          : undefined;

      const reply = await this.opts.models.complete(
        model,
        { systemPrompt, messages, tools: [tool] },
        { temperature, signal: req.signal, maxTokens: this.opts.maxTokens ?? MAX_OUTPUT_TOKENS },
      );
      usage = addUsage(usage, usageOf(reply));

      if (reply.stopReason === "aborted") {
        return err({ code: "aborted", message: reply.errorMessage ?? "request aborted", usage });
      }
      if (reply.stopReason === "error") {
        const message = reply.errorMessage ?? "provider error";
        // Some models refuse a temperature setting. Learn that once and retry without it.
        if (temperature !== undefined && !temperatureDropped && /temperature/i.test(message)) {
          this.rejectsTemperature.add(key);
          temperatureDropped = true;
          continue;
        }
        if (isQuotaExhausted(message)) {
          const friendly = quotaMessage(message);
          this.quotaUntil.set(key, { until: Date.now() + QUOTA_COOLDOWN_MS, message: friendly });
          return err({ code: "provider", message: friendly, usage });
        }
        // Gateways and free tiers fail transiently ("temporarily unavailable", 429, 503). Back off
        // and try again a couple of times before giving up; permanent errors (401, bad model) do not.
        if (isTransientError(message) && transientRetries < MAX_TRANSIENT_RETRIES) {
          transientRetries++;
          const waited = await sleep(
            (this.opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS) *
              transientRetries *
              (RATE_LIMITED.test(message) ? RATE_LIMIT_BACKOFF : 1),
            req.signal,
          );
          if (!waited) return err({ code: "aborted", message: "request aborted", usage });
          continue;
        }
        return err({ code: "provider", message, usage });
      }

      const call = reply.content.find((b) => b.type === "toolCall" && b.name === req.toolName);
      if (call?.type !== "toolCall") {
        last = {
          code: "no_tool_call",
          message: `the model did not call \`${req.toolName}\` (stop reason: ${reply.stopReason})`,
        };
        if (retries++ >= MAX_RETRIES) break;
        messages.push(reply, {
          role: "user",
          content: `You did not call the tool \`${req.toolName}\`. Call it now with your complete answer.`,
          timestamp: Date.now(),
        });
        continue;
      }

      try {
        const value = validateToolCall([tool], call) as Static<S>;
        return ok({ value, usage });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        last = { code: "invalid_args", message };
        if (retries++ >= MAX_RETRIES) break;
        messages.push(reply, {
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: [
            {
              type: "text",
              text: `Invalid arguments: ${message}\nCall the tool again with corrected arguments.`,
            },
          ],
          isError: true,
          timestamp: Date.now(),
        });
      }
    }
    return err({ ...last, usage });
  }
}

export type PiClientResult = Result<PiLlmClient, { message: string }>;

/**
 * The catalog stores an `anthropic-messages` model's base URL without `/v1` (its SDK appends
 * `/v1/messages`), while OpenAI-style models include it: OpenRouter serves Claude at
 * `https://openrouter.ai/api` but Gemini at `https://openrouter.ai/api/v1`. So one familiar
 * OpenAI-style URL works for both, drop the `/v1` for the Anthropic API.
 */
export function baseUrlFor(api: string, url: string): string {
  return api === "anthropic-messages" ? url.replace(/\/v1$/, "") : url;
}

/** Key variables for common providers, from the pi-ai README ("Environment Variables"). Hints only. */
const KEY_VARIABLES: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  xai: "XAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

/**
 * Build a client from env (`GEN_MODEL` / `JUDGE_MODEL`). Resolves both models in the installed pi-ai
 * catalog and checks credentials up front, so a bad setup fails before any work is attempted.
 */
export async function createPiLlmClient(
  env: Pick<Env, "genModel" | "judgeModel">,
  models: Models = builtinModels(),
): Promise<PiClientResult> {
  // A provider id pi-ai has never heard of plus a base URL means "my own OpenAI-compatible
  // endpoint" (a gateway, a proxy, a local server). Register it so it resolves like any other.
  const custom = new Map<string, CustomRef[]>();
  for (const ref of [env.genModel, env.judgeModel]) {
    if (ref?.baseUrl && !models.getProvider(ref.provider)) {
      custom.set(ref.provider, [
        ...(custom.get(ref.provider) ?? []),
        { ...ref, baseUrl: ref.baseUrl },
      ]);
    }
  }
  if (custom.size > 0) {
    if (!("setProvider" in models)) {
      return err({ message: "This model collection does not accept custom providers" });
    }
    for (const [id, refs] of custom)
      (models as MutableModels).setProvider(customProvider(id, refs));
  }

  const resolve = async (
    label: string,
    ref: ModelRef | undefined,
  ): Promise<Result<Model<Api>, { message: string }>> => {
    if (!ref) return err({ message: `${label} is not set` });
    if (!models.getProvider(ref.provider)) {
      const available = models
        .getProviders()
        .map((p) => p.id)
        .sort()
        .join(", ");
      const urlVariable = ref.profile
        ? `${profilePrefix(ref.profile)}_BASE_URL`
        : `LLM_BASE_URL (or ${label.replace("_MODEL", "_BASE_URL")})`;
      return err({
        message: `${label}: unknown provider "${ref.provider}". Available: ${available}. For your own OpenAI-compatible endpoint also set ${urlVariable}.`,
      });
    }
    const model = models.getModel(ref.provider, ref.model);
    if (!model) {
      return err({
        message: `${label}=${ref.provider}:${ref.model} is not in the installed pi-ai catalog`,
      });
    }
    try {
      if (!(await models.getAuth(model))) {
        const hint = custom.has(ref.provider)
          ? apiKeyVariables(ref.provider).join(" or ")
          : KEY_VARIABLES[ref.provider];
        return err({
          message: `No credentials for provider "${ref.provider}" (needed by ${label})${hint ? `. Set ${hint} in .env.local` : ""}`,
        });
      }
    } catch (e) {
      return err({
        message: `Credential lookup failed for ${label}: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    // pi-ai routes by the model's own `baseUrl`; overriding it is the documented way to use a
    // proxy, a regional host or a local server.
    return ok(ref.baseUrl ? { ...model, baseUrl: baseUrlFor(model.api, ref.baseUrl) } : model);
  };

  const generator = await resolve("GEN_MODEL", env.genModel);
  if (!generator.ok) return generator;
  const judge = await resolve("JUDGE_MODEL", env.judgeModel);
  if (!judge.ok) return judge;
  return ok(new PiLlmClient({ models, generator: generator.value, judge: judge.value }));
}
