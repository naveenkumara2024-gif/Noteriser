import { describe, expect, it } from "vitest";
import { EnvError, parseEnv, parseModelRef, warnIfJudgeEqualsGenerator } from "@/config/env";

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

function catchEnvError(fn: () => unknown): EnvError {
  try {
    fn();
  } catch (e) {
    if (e instanceof EnvError) return e;
    throw e;
  }
  throw new Error("expected EnvError");
}
