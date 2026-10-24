import {
  type AssistantMessage,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type Models,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import Type from "typebox";
import { describe, expect, it } from "vitest";
import type { StructuredRequest } from "@/core/ports/llm";
import { createPiLlmClient, isTransientError, PiLlmClient } from "@/llm/pi";

const Schema = Type.Object(
  { answer: Type.String(), n: Type.Number() },
  { additionalProperties: false },
);

const callTool = (args: Record<string, unknown>, name = "submit"): AssistantMessage =>
  fauxAssistantMessage([fauxToolCall(name, args as never)], { stopReason: "toolUse" });

function setup() {
  const faux = fauxProvider({ models: [{ id: "faux-gen" }, { id: "faux-judge" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const generator = faux.getModel("faux-gen");
  const judge = faux.getModel("faux-judge");
  if (!generator || !judge) throw new Error("faux models missing");
  const client = new PiLlmClient({ models, generator, judge, retryDelayMs: 0 });
  const request = (
    over: Partial<StructuredRequest<typeof Schema>> = {},
  ): StructuredRequest<typeof Schema> => ({
    role: "generator",
    system: "SYSTEM RULES",
    user: "USER TEXT",
    toolName: "submit",
    schema: Schema,
    ...over,
  });
  return { faux, models, client, request, generator, judge };
}

const textOf = (ctx: TranscriptContext): string => JSON.stringify(ctx.messages);

describe("PiLlmClient", () => {
  it("returns the validated tool arguments and the usage", async () => {
    const { faux, client, request } = setup();
    faux.setResponses([callTool({ answer: "yes", n: 3 })]);
    const r = await client.generateStructured(request());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.value).toEqual({ answer: "yes", n: 3 });
    expect(r.value.usage.inputTokens).toBeGreaterThan(0);
    expect(r.value.usage.outputTokens).toBeGreaterThan(0);
    expect(faux.state.callCount).toBe(1);
  });

  it("offers one strict tool built from the schema and tells the model to call it", async () => {
    const { faux, client, request } = setup();
    let seen: TranscriptContext | undefined;
    faux.setResponses([
      (ctx) => {
        seen = ctx;
        return callTool({ answer: "a", n: 1 });
      },
    ]);
    await client.generateStructured(request());
    const system = seen?.messages[0] as unknown as {
      role: string;
      content: string;
      toolsAdded: { name: string; parameters: unknown; constrainedSampling: unknown }[];
    };
    expect(system.role).toBe("system");
    expect(system.content).toContain("SYSTEM RULES");
    expect(system.content).toContain("calling the tool `submit` exactly once");
    expect(system.toolsAdded).toHaveLength(1);
    expect(system.toolsAdded[0]?.name).toBe("submit");
    expect(system.toolsAdded[0]?.constrainedSampling).toEqual({
      type: "json_schema",
      strict: "prefer",
    });
    expect(JSON.stringify(system.toolsAdded[0]?.parameters)).toContain('"answer"');
    expect(textOf(seen as TranscriptContext)).toContain("USER TEXT");
  });

  it("routes the judge role to the judge model and passes temperature and a token cap", async () => {
    const { faux, client, request } = setup();
    const seen: {
      model: string;
      temperature: number | undefined;
      maxTokens: number | undefined;
    }[] = [];
    const step = (
      _c: unknown,
      opts: { temperature?: number; maxTokens?: number } | undefined,
      _s: unknown,
      model: { id: string },
    ) => {
      seen.push({ model: model.id, temperature: opts?.temperature, maxTokens: opts?.maxTokens });
      return callTool({ answer: "a", n: 1 });
    };
    faux.setResponses([step, step]);
    await client.generateStructured(request({ role: "judge", temperature: 0.2 }));
    await client.generateStructured(request({ role: "generator" }));
    expect(seen).toEqual([
      { model: "faux-judge", temperature: 0.2, maxTokens: 8192 },
      { model: "faux-gen", temperature: undefined, maxTokens: 8192 },
    ]);
  });

  it("retries once with the validation message when the arguments are invalid", async () => {
    const { faux, client, request } = setup();
    let second: TranscriptContext | undefined;
    faux.setResponses([
      callTool({ answer: 5, n: "x" }),
      (ctx) => {
        second = ctx;
        return callTool({ answer: "fixed", n: 2 });
      },
    ]);
    const r = await client.generateStructured(request());
    expect(r.ok && r.value.value).toEqual({ answer: "fixed", n: 2 });
    expect(faux.state.callCount).toBe(2);

    const last = second?.messages.at(-1) as unknown as {
      role: string;
      isError: boolean;
      content: { text: string }[];
    };
    expect(last.role).toBe("toolResult");
    expect(last.isError).toBe(true);
    expect(last.content[0]?.text).toContain("Invalid arguments");
    // The failed attempt's cost is included in the total.
    if (r.ok) expect(r.value.usage.inputTokens).toBeGreaterThan(100);
  });

  it("gives up with invalid_args after the single retry", async () => {
    const { faux, client, request } = setup();
    faux.setResponses([callTool({ answer: 1 }), callTool({ answer: 2 })]);
    const r = await client.generateStructured(request());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("invalid_args");
    expect(faux.state.callCount).toBe(2);
    expect(r.error.usage.inputTokens).toBeGreaterThan(0);
  });

  it("asks again when the model answers in plain text, and succeeds", async () => {
    const { faux, client, request } = setup();
    let second: TranscriptContext | undefined;
    faux.setResponses([
      fauxAssistantMessage(fauxText("Here is my answer in prose.")),
      (ctx) => {
        second = ctx;
        return callTool({ answer: "ok", n: 1 });
      },
    ]);
    const r = await client.generateStructured(request());
    expect(r.ok).toBe(true);
    const last = second?.messages.at(-1) as unknown as { role: string; content: string };
    expect(last.role).toBe("user");
    expect(last.content).toContain("You did not call the tool `submit`");
  });

  it("returns no_tool_call after two plain-text answers", async () => {
    const { faux, client, request } = setup();
    faux.setResponses([fauxAssistantMessage("prose one"), fauxAssistantMessage("prose two")]);
    const r = await client.generateStructured(request());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("no_tool_call");
      expect(r.error.usage.inputTokens).toBeGreaterThan(0);
    }
    expect(faux.state.callCount).toBe(2);
  });

  it("ignores a call to a different tool", async () => {
    const { faux, client, request } = setup();
    faux.setResponses([callTool({ answer: "a", n: 1 }, "other"), callTool({ answer: "a", n: 1 })]);
    const r = await client.generateStructured(request());
    expect(r.ok).toBe(true);
    expect(faux.state.callCount).toBe(2);
  });

  it("maps an aborted reply to the aborted error without retrying", async () => {
    const { faux, client, request } = setup();
    faux.setResponses([
      fauxAssistantMessage([], { stopReason: "aborted", errorMessage: "cancelled" }),
    ]);
    const r = await client.generateStructured(request());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: "aborted", message: "cancelled" });
    expect(faux.state.callCount).toBe(1);
  });

  it("maps a permanent provider error without retrying", async () => {
    const { faux, client, request } = setup();
    faux.setResponses([
      fauxAssistantMessage([], { stopReason: "error", errorMessage: "401 invalid api key" }),
    ]);
    const r = await client.generateStructured(request());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: "provider", message: "401 invalid api key" });
    expect(faux.state.callCount).toBe(1);
  });

  describe("transient provider errors", () => {
    const transient = (message: string) =>
      fauxAssistantMessage([], { stopReason: "error", errorMessage: message });

    it("retries after 'temporarily unavailable' and succeeds", async () => {
      const { faux, client, request } = setup();
      faux.setResponses([
        transient("The model service is temporarily unavailable. Please try again."),
        callTool({ answer: "ok", n: 1 }),
      ]);
      const r = await client.generateStructured(request());
      expect(r.ok && r.value.value).toEqual({ answer: "ok", n: 1 });
      expect(faux.state.callCount).toBe(2);
    });

    it("retries up to twice, then reports the provider error", async () => {
      const { faux, client, request } = setup();
      faux.setResponses([
        transient("503 overloaded"),
        transient("503 overloaded"),
        transient("503 overloaded"),
      ]);
      const r = await client.generateStructured(request());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatchObject({ code: "provider", message: "503 overloaded" });
      expect(faux.state.callCount).toBe(3);
    });

    it("recovers on the second retry", async () => {
      const { faux, client, request } = setup();
      faux.setResponses([
        transient("429 rate limit exceeded"),
        transient("fetch failed"),
        callTool({ answer: "ok", n: 1 }),
      ]);
      const r = await client.generateStructured(request());
      expect(r.ok).toBe(true);
      expect(faux.state.callCount).toBe(3);
    });

    it("does not spend the validation retry on provider errors", async () => {
      const { faux, client, request } = setup();
      faux.setResponses([
        transient("502 bad gateway"),
        callTool({ answer: 1 }),
        callTool({ answer: "fixed", n: 2 }),
      ]);
      const r = await client.generateStructured(request());
      expect(r.ok && r.value.value).toEqual({ answer: "fixed", n: 2 });
    });

    it("stops waiting as soon as the request is aborted", async () => {
      const { faux, models, generator, judge, request } = setup();
      const slow = new PiLlmClient({ models, generator, judge, retryDelayMs: 60_000 });
      faux.setResponses([transient("503 overloaded"), callTool({ answer: "a", n: 1 })]);
      const controller = new AbortController();
      const started = Date.now();
      const pending = slow.generateStructured({ ...request(), signal: controller.signal });
      setTimeout(() => controller.abort(), 30);
      const r = await pending;
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("aborted");
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(faux.state.callCount).toBe(1);
    });
  });

  describe("isTransientError", () => {
    it.each([
      "The model service is temporarily unavailable. Please try again.",
      "503 Service Unavailable",
      "429 Too Many Requests",
      "Rate limit reached for requests",
      "Overloaded",
      "request timed out",
      "fetch failed",
      "read ECONNRESET",
    ])("retries: %s", (m) => {
      expect(isTransientError(m)).toBe(true);
    });

    it.each([
      "401 invalid api key",
      "404 model not found",
      "400 invalid request: messages must not be empty",
      "403 forbidden",
      "temperature is not supported by this model",
    ])("does not retry: %s", (m) => {
      expect(isTransientError(m)).toBe(false);
    });
  });

  it("reports an empty faux queue as a provider error instead of throwing", async () => {
    const { client, request } = setup();
    const r = await client.generateStructured(request());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("provider");
      expect(r.error.message).toContain("No more faux responses queued");
    }
  });

  it("learns that a model rejects temperature, retries without it, and remembers", async () => {
    const { faux, client, request } = setup();
    const temps: (number | undefined)[] = [];
    const step =
      (reject: boolean) =>
      (_c: unknown, opts: { temperature?: number } | undefined): AssistantMessage => {
        temps.push(opts?.temperature);
        return reject && opts?.temperature !== undefined
          ? fauxAssistantMessage([], {
              stopReason: "error",
              errorMessage: "temperature is not supported by this model",
            })
          : callTool({ answer: "ok", n: 1 });
      };
    faux.setResponses([step(true), step(true), step(true)]);

    const first = await client.generateStructured(request({ temperature: 0.1 }));
    expect(first.ok).toBe(true);
    const second = await client.generateStructured(request({ temperature: 0.1 }));
    expect(second.ok).toBe(true);
    // call 1 (rejected) -> call 2 (retry, none) -> call 3 (remembered, none)
    expect(temps).toEqual([0.1, undefined, undefined]);
    expect(faux.state.callCount).toBe(3);
  });

  it("does not loop on a persistent temperature error", async () => {
    const { faux, client, request } = setup();
    const err = fauxAssistantMessage([], { stopReason: "error", errorMessage: "bad temperature" });
    faux.setResponses([err, err, err]);
    const r = await client.generateStructured(request({ temperature: 0.1 }));
    expect(r.ok).toBe(false);
    expect(faux.state.callCount).toBe(2);
  });
});

describe("createPiLlmClient", () => {
  const faux = () => {
    const f = fauxProvider({ models: [{ id: "faux-gen" }, { id: "faux-judge" }] });
    const models = createModels();
    models.setProvider(f.provider);
    return { f, models };
  };

  it("sends requests to the configured base URL, per role", async () => {
    const { f, models } = faux();
    const seen: Record<string, string> = {};
    const step = (
      _c: unknown,
      _o: unknown,
      _s: unknown,
      model: { id: string; baseUrl: string },
    ) => {
      seen[model.id] = model.baseUrl;
      return callTool({ answer: "a", n: 1 });
    };
    f.setResponses([step, step]);

    const r = await createPiLlmClient(
      {
        genModel: { provider: "faux", model: "faux-gen", baseUrl: "http://localhost:9999/v1" },
        judgeModel: { provider: "faux", model: "faux-judge" },
      },
      models,
    );
    if (!r.ok) throw new Error(r.error.message);
    const req = (role: "generator" | "judge") => ({
      role,
      system: "S",
      user: "U",
      toolName: "submit",
      schema: Schema,
    });
    await r.value.generateStructured(req("generator"));
    await r.value.generateStructured(req("judge"));

    expect(seen["faux-gen"]).toBe("http://localhost:9999/v1");
    expect(seen["faux-judge"]).toBeDefined();
    expect(seen["faux-judge"]).not.toBe("http://localhost:9999/v1");
  });

  it("builds a client when both models resolve and have credentials", async () => {
    const { models } = faux();
    const r = await createPiLlmClient(
      {
        genModel: { provider: "faux", model: "faux-gen" },
        judgeModel: { provider: "faux", model: "faux-judge" },
      },
      models,
    );
    expect(r.ok).toBe(true);
  });

  it.each([
    [
      "GEN_MODEL unset",
      undefined,
      { provider: "faux", model: "faux-judge" },
      "GEN_MODEL is not set",
    ],
    [
      "JUDGE_MODEL unset",
      { provider: "faux", model: "faux-gen" },
      undefined,
      "JUDGE_MODEL is not set",
    ],
    [
      "unknown model",
      { provider: "faux", model: "nope" },
      { provider: "faux", model: "faux-judge" },
      "GEN_MODEL=faux:nope is not in the installed pi-ai catalog",
    ],
  ])("fails clearly: %s", async (_name, genModel, judgeModel, message) => {
    const { models } = faux();
    const r = await createPiLlmClient({ genModel, judgeModel }, models);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe(message);
  });

  it("fails before any work when a provider has no credentials", async () => {
    const stub = {
      getProvider: (id: string) => ({ id }),
      getModel: (provider: string, id: string) => ({ provider, id }),
      getAuth: async () => undefined,
    } as unknown as Models;
    const r = await createPiLlmClient(
      {
        genModel: { provider: "anthropic", model: "x" },
        judgeModel: { provider: "openai", model: "y" },
      },
      stub,
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.error.message).toContain(
        'No credentials for provider "anthropic" (needed by GEN_MODEL)',
      );
  });

  it("names the API key variable for common providers", async () => {
    const stub = {
      getProvider: (id: string) => ({ id }),
      getModel: (provider: string, id: string) => ({ provider, id }),
      getAuth: async () => undefined,
    } as unknown as Models;
    const r = await createPiLlmClient(
      {
        genModel: { provider: "openrouter", model: "x" },
        judgeModel: { provider: "openai", model: "y" },
      },
      stub,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("Set OPENROUTER_API_KEY in .env.local");
  });

  it("lists the available providers when the provider is unknown", async () => {
    const { models } = faux();
    const r = await createPiLlmClient(
      {
        genModel: { provider: "anthropik", model: "x" },
        judgeModel: { provider: "faux", model: "faux-judge" },
      },
      models,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain('GEN_MODEL: unknown provider "anthropik"');
      expect(r.error.message).toContain("Available: faux");
    }
  });

  it("reports a credential lookup that throws", async () => {
    const stub = {
      getProvider: (id: string) => ({ id }),
      getModel: (provider: string, id: string) => ({ provider, id }),
      getAuth: async () => {
        throw new Error("token refresh failed");
      },
    } as unknown as Models;
    const r = await createPiLlmClient(
      { genModel: { provider: "a", model: "x" }, judgeModel: { provider: "b", model: "y" } },
      stub,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("token refresh failed");
  });
});
