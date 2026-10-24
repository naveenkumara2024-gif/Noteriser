import { createProvider, envApiKeyAuth, type Model, type Provider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { ModelRef } from "../config/env";

/** A model reference that carries the endpoint it must be sent to. */
export type CustomRef = ModelRef & { baseUrl: string };

/**
 * API-key variables for a custom provider, most specific first: `NARAROUTER_API_KEY` for provider
 * `nararouter`, `MY_PROXY_API_KEY` for `my-proxy`, then the shared `LLM_API_KEY`.
 */
export function apiKeyVariables(providerId: string): string[] {
  const own = `${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
  return own === "LLM_API_KEY" ? [own] : [own, "LLM_API_KEY"];
}

/**
 * Chat model for an OpenAI-compatible endpoint that pi-ai has no catalog entry for. The compat flags
 * are conservative, for gateways and local servers that implement only the classic Chat Completions
 * surface: no `store`, no `developer` role, no reasoning parameters, `max_tokens` not
 * `max_completion_tokens`.
 */
export function customModel(ref: CustomRef): Model<"openai-completions"> {
  return {
    id: ref.model,
    name: ref.model,
    api: "openai-completions",
    provider: ref.provider,
    baseUrl: ref.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
    },
  };
}

/** One provider for every model that shares an id, authenticated from the environment. */
export function customProvider(
  providerId: string,
  refs: readonly CustomRef[],
): Provider<"openai-completions"> {
  const seen = new Set<string>();
  const models = refs.filter((r) => !seen.has(r.model) && seen.add(r.model)).map(customModel);
  return createProvider({
    id: providerId,
    name: providerId,
    baseUrl: refs[0]?.baseUrl,
    auth: { apiKey: envApiKeyAuth(`${providerId} API key`, apiKeyVariables(providerId)) },
    models,
    api: openAICompletionsApi(),
  });
}
