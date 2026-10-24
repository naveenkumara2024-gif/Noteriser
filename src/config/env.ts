import Type from "typebox";
import Value from "typebox/value";

const MODEL_REF = /^([^:\s]+):(\S+)$/;

const RawEnv = Type.Object({
  LLM_MODE: Type.Optional(Type.Union([Type.Literal("live"), Type.Literal("fake")])),
  GEN_MODEL: Type.Optional(Type.String({ pattern: MODEL_REF.source })),
  JUDGE_MODEL: Type.Optional(Type.String({ pattern: MODEL_REF.source })),
  RUN_TTL_HOURS: Type.Optional(Type.Integer({ minimum: 1, maximum: 720 })),
});

export interface ModelRef {
  provider: string;
  model: string;
}

export interface Env {
  llmMode: "live" | "fake";
  genModel: ModelRef | undefined;
  judgeModel: ModelRef | undefined;
  runTtlHours: number;
}

export class EnvError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "EnvError";
  }
}

/** `provider:model`, split on the first colon only (model ids such as `x:free` contain more). */
export function parseModelRef(value: string): ModelRef | undefined {
  const m = MODEL_REF.exec(value);
  return m?.[1] && m[2] ? { provider: m[1], model: m[2] } : undefined;
}

/** Pure: validates every variable and reports all problems at once. Provider API keys are pi-ai's concern. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const issues: string[] = [];

  const raw: Record<string, unknown> = {};
  for (const key of ["LLM_MODE", "GEN_MODEL", "JUDGE_MODEL"] as const) {
    const v = source[key]?.trim();
    if (v) raw[key] = v;
  }
  const ttl = source.RUN_TTL_HOURS?.trim();
  if (ttl) raw.RUN_TTL_HOURS = /^-?\d+$/.test(ttl) ? Number(ttl) : ttl;

  if (!Value.Check(RawEnv, raw)) {
    for (const e of Value.Errors(RawEnv, raw)) {
      const name = e.instancePath.replace(/^\//, "") || "(root)";
      issues.push(`${name}: ${e.message}`);
    }
  }

  const llmMode = raw.LLM_MODE === "live" ? "live" : "fake";
  const genModel = typeof raw.GEN_MODEL === "string" ? parseModelRef(raw.GEN_MODEL) : undefined;
  const judgeModel =
    typeof raw.JUDGE_MODEL === "string" ? parseModelRef(raw.JUDGE_MODEL) : undefined;

  if (llmMode === "live") {
    if (!genModel) issues.push("GEN_MODEL: required when LLM_MODE=live (format provider:model)");
    if (!judgeModel)
      issues.push("JUDGE_MODEL: required when LLM_MODE=live (format provider:model)");
  }

  if (issues.length > 0) throw new EnvError(issues);

  return {
    llmMode,
    genModel,
    judgeModel,
    runTtlHours: typeof raw.RUN_TTL_HOURS === "number" ? raw.RUN_TTL_HOURS : 24,
  };
}

/** Invariant 2: the judge should be a different model, ideally a different provider. */
export function warnIfJudgeEqualsGenerator(env: Env): string | undefined {
  const { genModel: g, judgeModel: j } = env;
  if (!g || !j) return undefined;
  if (g.provider === j.provider && g.model === j.model) {
    return `GEN_MODEL and JUDGE_MODEL are both ${g.provider}:${g.model}; the judge is not independent of the generator.`;
  }
  return undefined;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
