import { describe, expect, it } from "vitest";
import {
  EnvError,
  parseEnv,
  parseModelRef,
  profilePrefix,
  warnIfJudgeEqualsGenerator,
} from "@/config/env";

describe("parseEnv", () => {
  it("defaults to fake mode with a 24h TTL and no models", () => {
    expect(parseEnv({})).toEqual({
      llmMode: "fake",
      genModel: undefined,
      judgeModel: undefined,
      runTtlHours: 24,
    });
  });

  it("treats blank values as unset (as copied from .env.example)", () => {
    const env = parseEnv({ LLM_MODE: "fake", GEN_MODEL: "", JUDGE_MODEL: "  ", RUN_TTL_HOURS: "" });
    expect(env.genModel).toBeUndefined();
    expect(env.runTtlHours).toBe(24);
  });

  it("parses live mode with provider:model refs", () => {
    const env = parseEnv({
      LLM_MODE: "live",
      GEN_MODEL: "anthropic:claude-sonnet-5-5",
      JUDGE_MODEL: "openai:gpt-5-mini",
      RUN_TTL_HOURS: "48",
    });
    expect(env.llmMode).toBe("live");
    expect(env.genModel).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5" });
    expect(env.judgeModel).toEqual({ provider: "openai", model: "gpt-5-mini" });
    expect(env.runTtlHours).toBe(48);
  });

  it("requires both models in live mode and names each missing variable", () => {
    const err = catchEnvError(() => parseEnv({ LLM_MODE: "live" }));
    expect(err.issues).toHaveLength(2);
    expect(err.issues.join("\n")).toContain("GEN_MODEL");
    expect(err.issues.join("\n")).toContain("JUDGE_MODEL");
  });

  it("reports every bad variable at once", () => {
    const err = catchEnvError(() =>
      parseEnv({ LLM_MODE: "maybe", GEN_MODEL: "no-colon", RUN_TTL_HOURS: "0" }),
    );
    const text = err.issues.join("\n");
    expect(text).toContain("LLM_MODE");
    expect(text).toContain("GEN_MODEL");
    expect(text).toContain("RUN_TTL_HOURS");
    expect(err.message).toContain("Invalid environment");
  });

  it.each(["abc", "1.5", "721", "-3"])("rejects RUN_TTL_HOURS=%s", (value) => {
    expect(() => parseEnv({ RUN_TTL_HOURS: value })).toThrow(EnvError);
  });
});

describe("parseModelRef", () => {
  it("splits on the first colon only", () => {
    expect(parseModelRef("openrouter:meta/llama:free")).toEqual({
      provider: "openrouter",
      model: "meta/llama:free",
    });
  });

  it.each(["", "nocolon", ":model", "provider:", "has space:model"])("rejects %j", (value) => {
    expect(parseModelRef(value)).toBeUndefined();
  });
});

describe("warnIfJudgeEqualsGenerator", () => {
  const base = { llmMode: "live", runTtlHours: 24 } as const;

  it("warns when generator and judge are the same model", () => {
    const m = { provider: "anthropic", model: "x" };
    expect(warnIfJudgeEqualsGenerator({ ...base, genModel: m, judgeModel: { ...m } })).toMatch(
      /not independent/,
    );
  });

  it("is silent for different models or missing config", () => {
    const a = { provider: "anthropic", model: "x" };
    expect(
      warnIfJudgeEqualsGenerator({
        ...base,
        genModel: a,
        judgeModel: { provider: "openai", model: "y" },
      }),
    ).toBeUndefined();
    expect(
      warnIfJudgeEqualsGenerator({
        ...base,
        genModel: a,
        judgeModel: { provider: "anthropic", model: "z" },
      }),
    ).toBeUndefined();
    expect(
      warnIfJudgeEqualsGenerator({
        llmMode: "fake",
        runTtlHours: 24,
        genModel: undefined,
        judgeModel: undefined,
      }),
    ).toBeUndefined();
  });
});

describe("provider options", () => {
  it("LLM_PROVIDER supplies the provider for bare model ids in both roles", () => {
    const env = parseEnv({
      LLM_MODE: "live",
      LLM_PROVIDER: "anthropic",
      GEN_MODEL: "claude-sonnet-5-5",
      JUDGE_MODEL: "claude-haiku-5-5",
    });
    expect(env.genModel).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5" });
    expect(env.judgeModel).toEqual({ provider: "anthropic", model: "claude-haiku-5-5" });
  });

  it("a role-specific provider overrides the default, so the judge can be another vendor", () => {
    const env = parseEnv({
      LLM_MODE: "live",
      LLM_PROVIDER: "anthropic",
      GEN_MODEL: "claude-sonnet-5-5",
      JUDGE_PROVIDER: "openai",
      JUDGE_MODEL: "gpt-5-mini",
    });
    expect(env.genModel?.provider).toBe("anthropic");
    expect(env.judgeModel).toEqual({ provider: "openai", model: "gpt-5-mini" });
    expect(warnIfJudgeEqualsGenerator(env)).toBeUndefined();
  });

  it("GEN_PROVIDER and JUDGE_PROVIDER work without LLM_PROVIDER", () => {
    const env = parseEnv({
      GEN_PROVIDER: "google",
      GEN_MODEL: "gemini-x",
      JUDGE_PROVIDER: "groq",
      JUDGE_MODEL: "llama-y",
    });
    expect(env.genModel).toEqual({ provider: "google", model: "gemini-x" });
    expect(env.judgeModel).toEqual({ provider: "groq", model: "llama-y" });
  });

  it("takes the model id literally once a provider is set (ids may contain colons)", () => {
    const env = parseEnv({
      LLM_PROVIDER: "openrouter",
      GEN_MODEL: "meta-llama/llama-3.3-70b-instruct:free",
    });
    expect(env.genModel).toEqual({
      provider: "openrouter",
      model: "meta-llama/llama-3.3-70b-instruct:free",
    });
  });

  it("drops a redundant provider prefix and keeps the combined form working", () => {
    expect(parseEnv({ LLM_PROVIDER: "openai", GEN_MODEL: "openai:gpt-5-mini" }).genModel).toEqual({
      provider: "openai",
      model: "gpt-5-mini",
    });
    expect(parseEnv({ GEN_MODEL: "openai:gpt-5-mini" }).genModel).toEqual({
      provider: "openai",
      model: "gpt-5-mini",
    });
  });

  it("normalises provider case and whitespace", () => {
    const env = parseEnv({ LLM_PROVIDER: "  Anthropic ", GEN_MODEL: "m" });
    expect(env.genModel?.provider).toBe("anthropic");
  });

  it("a bare model with no provider anywhere points at the provider variables", () => {
    const err = catchEnvError(() => parseEnv({ GEN_MODEL: "claude-sonnet-5-5" }));
    expect(err.issues).toHaveLength(1);
    expect(err.issues[0]).toContain("GEN_MODEL");
    expect(err.issues[0]).toContain("LLM_PROVIDER");
  });

  it("rejects malformed provider ids", () => {
    const err = catchEnvError(() => parseEnv({ LLM_PROVIDER: "not a provider!", GEN_MODEL: "x" }));
    expect(err.issues.join("\n")).toContain("LLM_PROVIDER");
  });

  it("live mode still requires both models even when providers are set", () => {
    const err = catchEnvError(() => parseEnv({ LLM_MODE: "live", LLM_PROVIDER: "anthropic" }));
    expect(err.issues.map((i) => i.split(":")[0]).sort()).toEqual(["GEN_MODEL", "JUDGE_MODEL"]);
  });

  it("a provider without a model is harmless in fake mode", () => {
    const env = parseEnv({ LLM_PROVIDER: "anthropic" });
    expect(env.genModel).toBeUndefined();
    expect(env.llmMode).toBe("fake");
  });

  it("detects a non-independent judge expressed through provider variables", () => {
    const env = parseEnv({ LLM_PROVIDER: "anthropic", GEN_MODEL: "m", JUDGE_MODEL: "anthropic:m" });
    expect(warnIfJudgeEqualsGenerator(env)).toMatch(/not independent/);
  });
});

describe("base URL options", () => {
  const OR = "https://openrouter.ai/api/v1";

  it("LLM_BASE_URL applies to both roles and loses its trailing slash", () => {
    const env = parseEnv({
      LLM_PROVIDER: "openrouter",
      LLM_BASE_URL: `${OR}///`,
      GEN_MODEL: "anthropic/claude-sonnet-5.5",
      JUDGE_MODEL: "google/gemini-3.6-flash",
    });
    expect(env.genModel).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-5.5",
      baseUrl: OR,
    });
    expect(env.judgeModel?.baseUrl).toBe(OR);
  });

  it("GEN_BASE_URL and JUDGE_BASE_URL are per role", () => {
    const env = parseEnv({
      LLM_PROVIDER: "openrouter",
      GEN_MODEL: "a/b",
      JUDGE_MODEL: "c/d",
      GEN_BASE_URL: "http://localhost:8080/v1",
    });
    expect(env.genModel?.baseUrl).toBe("http://localhost:8080/v1");
    expect(env.judgeModel).not.toHaveProperty("baseUrl");
  });

  it("a role's own URL beats the shared one", () => {
    const env = parseEnv({
      LLM_PROVIDER: "openrouter",
      LLM_BASE_URL: OR,
      GEN_MODEL: "a/b",
      JUDGE_MODEL: "c/d",
      JUDGE_BASE_URL: "https://us.openrouter.ai/api/v1",
    });
    expect(env.genModel?.baseUrl).toBe(OR);
    expect(env.judgeModel?.baseUrl).toBe("https://us.openrouter.ai/api/v1");
  });

  it("does not send a judge on its own provider to the shared endpoint", () => {
    const env = parseEnv({
      LLM_PROVIDER: "openrouter",
      LLM_BASE_URL: OR,
      GEN_MODEL: "a/b",
      JUDGE_PROVIDER: "openai",
      JUDGE_MODEL: "gpt-5-mini",
    });
    expect(env.genModel?.baseUrl).toBe(OR);
    expect(env.judgeModel).toEqual({ provider: "openai", model: "gpt-5-mini" });
  });

  it("is absent from refs when no URL is configured", () => {
    const env = parseEnv({ GEN_MODEL: "openai:gpt-5-mini" });
    expect(env.genModel).toEqual({ provider: "openai", model: "gpt-5-mini" });
    expect(env.genModel).not.toHaveProperty("baseUrl");
  });

  it.each([
    ["not a url", "LLM_BASE_URL"],
    ["ftp://example.com/v1", "GEN_BASE_URL"],
    ["openrouter.ai/api/v1", "JUDGE_BASE_URL"],
  ])("rejects %j in %s", (value, name) => {
    const err = catchEnvError(() => parseEnv({ [name]: value }));
    expect(err.issues).toHaveLength(1);
    expect(err.issues[0]).toContain(name);
    expect(err.issues[0]).toContain("http(s) URL");
  });

  it("ignores a URL for a role that has no model", () => {
    const env = parseEnv({ LLM_PROVIDER: "openrouter", GEN_BASE_URL: OR });
    expect(env.genModel).toBeUndefined();
  });
});

describe("profiles: one flag switches provider", () => {
  /** Both providers fully configured side by side, exactly like .env.local. */
  const BOTH = {
    LLM_MODE: "live",
    NARAROUTER_BASE_URL: "https://router.bynara.id/v1",
    NARAROUTER_GEN_MODEL: "agnes-2.5-flash",
    NARAROUTER_JUDGE_MODEL: "nemotron-3.5-lightning-free",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_GEN_MODEL: "anthropic/claude-sonnet-5.5",
    OPENROUTER_JUDGE_MODEL: "google/gemini-3.6-flash",
  };

  it("LLM_PROFILE=nararouter selects the Nara settings", () => {
    const env = parseEnv({ ...BOTH, LLM_PROFILE: "nararouter" });
    expect(env.genModel).toEqual({
      provider: "nararouter",
      model: "agnes-2.5-flash",
      baseUrl: "https://router.bynara.id/v1",
      profile: "nararouter",
    });
    expect(env.judgeModel).toEqual({
      provider: "nararouter",
      model: "nemotron-3.5-lightning-free",
      baseUrl: "https://router.bynara.id/v1",
      profile: "nararouter",
    });
  });

  it("changing only the flag switches to OpenRouter, with its own models and endpoint", () => {
    const env = parseEnv({ ...BOTH, LLM_PROFILE: "openrouter" });
    expect(env.genModel).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-5.5",
      baseUrl: "https://openrouter.ai/api/v1",
      profile: "openrouter",
    });
    expect(env.judgeModel?.model).toBe("google/gemini-3.6-flash");
    expect(env.judgeModel?.provider).toBe("openrouter");
  });

  it("nothing from the other profile leaks through", () => {
    for (const profile of ["nararouter", "openrouter"]) {
      const env = parseEnv({ ...BOTH, LLM_PROFILE: profile });
      for (const ref of [env.genModel, env.judgeModel]) {
        expect(ref?.provider).toBe(profile);
        expect(ref?.baseUrl).toContain(profile === "nararouter" ? "bynara" : "openrouter.ai");
      }
    }
  });

  it("normalises case and whitespace in the flag", () => {
    expect(parseEnv({ ...BOTH, LLM_PROFILE: "  NaraRouter " }).genModel?.provider).toBe(
      "nararouter",
    );
  });

  it("a profile without a base URL uses the provider's default endpoint", () => {
    const env = parseEnv({
      LLM_MODE: "live",
      LLM_PROFILE: "openrouter",
      OPENROUTER_GEN_MODEL: "a/b",
      OPENROUTER_JUDGE_MODEL: "c/d",
    });
    expect(env.genModel).toEqual({ provider: "openrouter", model: "a/b", profile: "openrouter" });
  });

  it("works for any profile name; hyphens become underscores in the variable prefix", () => {
    const env = parseEnv({
      LLM_MODE: "live",
      LLM_PROFILE: "my-proxy",
      MY_PROXY_BASE_URL: "http://localhost:8080/v1",
      MY_PROXY_GEN_MODEL: "m1",
      MY_PROXY_JUDGE_MODEL: "m2",
    });
    expect(env.genModel).toMatchObject({
      provider: "my-proxy",
      model: "m1",
      baseUrl: "http://localhost:8080/v1",
    });
    expect(profilePrefix("my-proxy")).toBe("MY_PROXY");
    expect(profilePrefix("nararouter")).toBe("NARAROUTER");
    expect(profilePrefix("Acme.AI v2")).toBe("ACME_AI_V2");
  });

  describe("per-role profiles (judge on a different provider)", () => {
    it("GEN_PROFILE and JUDGE_PROFILE pick each role's settings independently", () => {
      const env = parseEnv({ ...BOTH, GEN_PROFILE: "nararouter", JUDGE_PROFILE: "openrouter" });
      expect(env.genModel).toMatchObject({ provider: "nararouter", model: "agnes-2.5-flash" });
      expect(env.judgeModel).toMatchObject({
        provider: "openrouter",
        model: "google/gemini-3.6-flash",
        baseUrl: "https://openrouter.ai/api/v1",
      });
      expect(warnIfJudgeEqualsGenerator(env)).toBeUndefined();
    });

    it("a role profile overrides LLM_PROFILE for that role only", () => {
      const env = parseEnv({ ...BOTH, LLM_PROFILE: "nararouter", JUDGE_PROFILE: "openrouter" });
      expect(env.genModel?.provider).toBe("nararouter");
      expect(env.judgeModel?.provider).toBe("openrouter");
    });
  });

  describe("explicit generic variables still win", () => {
    it("GEN_MODEL overrides the profile's generator model", () => {
      const env = parseEnv({ ...BOTH, LLM_PROFILE: "nararouter", GEN_MODEL: "something-else" });
      expect(env.genModel?.model).toBe("something-else");
      expect(env.judgeModel?.model).toBe("nemotron-3.5-lightning-free");
    });

    it("GEN_BASE_URL overrides the profile's endpoint", () => {
      const env = parseEnv({
        ...BOTH,
        LLM_PROFILE: "nararouter",
        GEN_BASE_URL: "http://localhost:1/v1",
      });
      expect(env.genModel?.baseUrl).toBe("http://localhost:1/v1");
      expect(env.judgeModel?.baseUrl).toBe("https://router.bynara.id/v1");
    });

    it("the shared LLM_BASE_URL does not apply to profile roles", () => {
      const env = parseEnv({
        ...BOTH,
        LLM_PROFILE: "openrouter",
        LLM_BASE_URL: "https://wrong.example/v1",
      });
      expect(env.genModel?.baseUrl).toBe("https://openrouter.ai/api/v1");
    });
  });

  describe("mistakes are reported precisely", () => {
    it("a missing model in live mode names the profile's own variable, once", () => {
      const err = catchEnvError(() =>
        parseEnv({
          LLM_MODE: "live",
          LLM_PROFILE: "nararouter",
          NARAROUTER_BASE_URL: "https://router.bynara.id/v1",
          NARAROUTER_GEN_MODEL: "agnes-2.5-flash",
        }),
      );
      expect(err.issues).toEqual(['NARAROUTER_JUDGE_MODEL: required for profile "nararouter"']);
    });

    it("a profile with no settings at all (typo) is one clear message", () => {
      const err = catchEnvError(() => parseEnv({ ...BOTH, LLM_PROFILE: "nararuter" }));
      expect(err.issues).toHaveLength(1);
      expect(err.issues[0]).toContain("LLM_PROFILE=nararuter: no NARARUTER_* settings found");
      expect(err.issues[0]).toContain("NARARUTER_GEN_MODEL");
    });

    it("an invalid profile name is rejected", () => {
      const err = catchEnvError(() => parseEnv({ LLM_PROFILE: "not a profile!" }));
      expect(err.issues[0]).toContain("LLM_PROFILE");
    });

    it("an invalid URL in the profile is reported", () => {
      const err = catchEnvError(() =>
        parseEnv({ ...BOTH, LLM_PROFILE: "nararouter", NARAROUTER_BASE_URL: "not a url" }),
      );
      expect(err.issues.join("\n")).toContain("http(s) URL");
    });
  });

  describe("fake mode is forgiving", () => {
    it("an incomplete profile is fine when no real model is needed", () => {
      const env = parseEnv({ LLM_PROFILE: "nararouter" });
      expect(env.llmMode).toBe("fake");
      expect(env.genModel).toBeUndefined();
    });

    it("a complete profile still resolves", () => {
      const env = parseEnv({ ...BOTH, LLM_MODE: "fake", LLM_PROFILE: "openrouter" });
      expect(env.genModel?.provider).toBe("openrouter");
    });
  });

  it("no profile keeps the older variables working exactly as before", () => {
    const env = parseEnv({
      ...BOTH,
      LLM_PROVIDER: "openrouter",
      GEN_MODEL: "a/b",
      JUDGE_MODEL: "c/d",
    });
    expect(env.genModel).toEqual({ provider: "openrouter", model: "a/b" });
    expect(env.genModel).not.toHaveProperty("profile");
  });
});

function catchEnvError(fn: () => unknown): EnvError {
  try {
    fn();
  } catch (e) {
    if (e instanceof EnvError) return e;
    throw e;
  }
  throw new Error("expected EnvError");
}
