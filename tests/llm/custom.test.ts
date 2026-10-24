import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import Type from "typebox";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { StructuredRequest } from "@/core/ports/llm";
import { apiKeyVariables } from "@/llm/custom";
import { baseUrlFor, createPiLlmClient } from "@/llm/pi";

const Schema = Type.Object(
  { answer: Type.String(), n: Type.Number() },
  { additionalProperties: false },
);

interface Seen {
  apiKey: string | undefined;
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

let server: Server;
let baseUrl: string;
const seen: Seen[] = [];

/** Minimal OpenAI-compatible streaming reply: one tool call, then usage. */
function sse(res: ServerResponse, args: Record<string, unknown>, toolName: string): void {
  const chunk = (delta: unknown, finish: string | null = null) =>
    `data: ${JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      created: 0,
      model: "mock",
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(
    chunk({
      role: "assistant",
      tool_calls: [
        { index: 0, id: "call_1", type: "function", function: { name: toolName, arguments: "" } },
      ],
    }),
  );
  res.write(chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }));
  res.write(chunk({}, "tool_calls"));
  res.write(
    `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", created: 0, model: "mock", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`,
  );
  res.end("data: [DONE]\n\n");
}

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      seen.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        apiKey: req.headers["x-api-key"] as string | undefined,
        body,
      });
      // Only Chat Completions is mocked. Any other API shape gets a clean error, not a crash.
      if (req.url !== "/v1/chat/completions") {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: `mock does not implement ${req.url}` } }));
        return;
      }
      const tools = body.tools as { function: { name: string } }[] | undefined;
      sse(res, { answer: "ok", n: 1 }, tools?.[0]?.function.name ?? "submit");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => {
  server.close();
});

const touched: string[] = [];
function setEnv(name: string, value: string | undefined): void {
  touched.push(name);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
afterEach(() => {
  for (const name of touched.splice(0)) delete process.env[name];
  seen.length = 0;
});

const req = (role: "generator" | "judge" = "generator"): StructuredRequest<typeof Schema> => ({
  role,
  system: "SYSTEM RULES",
  user: "USER TEXT",
  toolName: "submit",
  schema: Schema,
  temperature: 0.1,
});

describe("custom OpenAI-compatible provider (unknown provider id + base URL)", () => {
  it("registers the provider and talks to the configured endpoint end to end", async () => {
    setEnv("NARAROUTER_API_KEY", "key-from-env");
    const ref = { provider: "nararouter", model: "nemotron-3.5-lightning-free", baseUrl };
    const client = await createPiLlmClient({ genModel: ref, judgeModel: ref }, builtinModels());
    if (!client.ok) throw new Error(client.error.message);

    const r = await client.value.generateStructured(req());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.value).toEqual({ answer: "ok", n: 1 });
    expect(r.value.usage).toMatchObject({ inputTokens: 10, outputTokens: 5 });

    const call = seen.at(-1);
    expect(call?.method).toBe("POST");
    expect(call?.url).toBe("/v1/chat/completions");
    expect(call?.authorization).toBe("Bearer key-from-env");
    expect(call?.body.model).toBe("nemotron-3.5-lightning-free");
  });

  it("sends classic Chat Completions fields a generic gateway understands", async () => {
    setEnv("NARAROUTER_API_KEY", "k");
    const ref = { provider: "nararouter", model: "m", baseUrl };
    const client = await createPiLlmClient({ genModel: ref, judgeModel: ref }, builtinModels());
    if (!client.ok) throw new Error(client.error.message);
    await client.value.generateStructured(req());

    const body = seen.at(-1)?.body ?? {};
    expect(body.max_tokens).toBe(8192);
    expect(body).not.toHaveProperty("max_completion_tokens");
    expect(body).not.toHaveProperty("store");
    expect(body).not.toHaveProperty("reasoning_effort");

    const messages = body.messages as { role: string; content: string }[];
    expect(messages[0]?.role).toBe("system"); // not "developer"
    expect(messages[0]?.content).toContain("SYSTEM RULES");
    expect(messages.at(-1)?.role).toBe("user");

    const tools = body.tools as { type: string; function: { name: string; parameters: unknown } }[];
    expect(tools).toHaveLength(1);
    expect(tools[0]?.function.name).toBe("submit");
    expect(JSON.stringify(tools[0]?.function.parameters)).toContain('"answer"');
    expect(body.temperature).toBe(0.1);
  });

  it("falls back to LLM_API_KEY when the provider-specific variable is absent", async () => {
    setEnv("NARAROUTER_API_KEY", undefined);
    setEnv("LLM_API_KEY", "shared-key");
    const ref = { provider: "nararouter", model: "m", baseUrl };
    const client = await createPiLlmClient({ genModel: ref, judgeModel: ref }, builtinModels());
    if (!client.ok) throw new Error(client.error.message);
    await client.value.generateStructured(req());
    expect(seen.at(-1)?.authorization).toBe("Bearer shared-key");
  });

  it("prefers the provider-specific key over LLM_API_KEY", async () => {
    setEnv("NARAROUTER_API_KEY", "specific");
    setEnv("LLM_API_KEY", "shared");
    const ref = { provider: "nararouter", model: "m", baseUrl };
    const client = await createPiLlmClient({ genModel: ref, judgeModel: ref }, builtinModels());
    if (!client.ok) throw new Error(client.error.message);
    await client.value.generateStructured(req());
    expect(seen.at(-1)?.authorization).toBe("Bearer specific");
  });

  it("serves two different models of one custom provider (generator and judge)", async () => {
    setEnv("NARAROUTER_API_KEY", "k");
    const client = await createPiLlmClient(
      {
        genModel: { provider: "nararouter", model: "gen-model", baseUrl },
        judgeModel: { provider: "nararouter", model: "judge-model", baseUrl },
      },
      builtinModels(),
    );
    if (!client.ok) throw new Error(client.error.message);
    await client.value.generateStructured(req("generator"));
    await client.value.generateStructured(req("judge"));
    expect(seen.map((s) => s.body.model)).toEqual(["gen-model", "judge-model"]);
  });

  it("names the key variables when no key is set", async () => {
    setEnv("NARAROUTER_API_KEY", undefined);
    setEnv("LLM_API_KEY", undefined);
    const ref = { provider: "nararouter", model: "m", baseUrl };
    const client = await createPiLlmClient({ genModel: ref, judgeModel: ref }, builtinModels());
    expect(client.ok).toBe(false);
    if (!client.ok) {
      expect(client.error.message).toContain('No credentials for provider "nararouter"');
      expect(client.error.message).toContain("NARAROUTER_API_KEY or LLM_API_KEY");
    }
  });

  it("an unknown provider without a base URL points at LLM_BASE_URL instead of guessing", async () => {
    const client = await createPiLlmClient(
      {
        genModel: { provider: "nararouter", model: "m" },
        judgeModel: { provider: "nararouter", model: "m" },
      },
      builtinModels(),
    );
    expect(client.ok).toBe(false);
    if (!client.ok) {
      expect(client.error.message).toContain('unknown provider "nararouter"');
      expect(client.error.message).toContain("LLM_BASE_URL");
    }
  });

  it("a catalog provider keeps its own auth and API: OpenRouter + OpenAI-style model", async () => {
    setEnv("OPENROUTER_API_KEY", "or-key");
    const ref = { provider: "openrouter", model: "google/gemini-3.6-flash", baseUrl };
    const client = await createPiLlmClient({ genModel: ref, judgeModel: ref }, builtinModels());
    if (!client.ok) throw new Error(client.error.message);

    const r = await client.value.generateStructured(req());
    expect(r.ok).toBe(true);
    expect(seen.at(-1)?.url).toBe("/v1/chat/completions");
    expect(seen.at(-1)?.authorization).toBe("Bearer or-key");
    expect(seen.at(-1)?.body.model).toBe("google/gemini-3.6-flash");
  });

  it("a Claude model on OpenRouter (Anthropic Messages) does not get a doubled /v1", async () => {
    setEnv("OPENROUTER_API_KEY", "or-key");
    const ref = { provider: "openrouter", model: "anthropic/claude-sonnet-5.5", baseUrl };
    const client = await createPiLlmClient({ genModel: ref, judgeModel: ref }, builtinModels());
    if (!client.ok) throw new Error(client.error.message);

    // The mock only implements Chat Completions, so this call fails; the request is what matters.
    await client.value.generateStructured(req());
    const call = seen.at(-1);
    expect(call?.url).toMatch(/^\/v1\/messages(\?|$)/);
    expect(call?.url).not.toContain("/v1/v1");
    expect(call?.apiKey).toBe("or-key");
    expect(call?.body.model).toBe("anthropic/claude-sonnet-5.5");
  }, 20_000);
});

describe("baseUrlFor", () => {
  it.each([
    ["anthropic-messages", "https://openrouter.ai/api/v1", "https://openrouter.ai/api"],
    ["anthropic-messages", "https://openrouter.ai/api", "https://openrouter.ai/api"],
    ["openai-completions", "https://openrouter.ai/api/v1", "https://openrouter.ai/api/v1"],
    ["openai-responses", "https://example.com/v1", "https://example.com/v1"],
  ])("%s %s", (api, url, expected) => {
    expect(baseUrlFor(api, url)).toBe(expected);
  });
});

describe("apiKeyVariables", () => {
  it.each([
    ["nararouter", ["NARAROUTER_API_KEY", "LLM_API_KEY"]],
    ["my-proxy", ["MY_PROXY_API_KEY", "LLM_API_KEY"]],
    ["Acme.AI v2", ["ACME_AI_V2_API_KEY", "LLM_API_KEY"]],
    ["llm", ["LLM_API_KEY"]],
  ])("%s", (id, expected) => {
    expect(apiKeyVariables(id)).toEqual(expected);
  });
});
