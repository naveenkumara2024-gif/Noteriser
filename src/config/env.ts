import Type from "typebox";
import Value from "typebox/value";

const MODEL_REF = /^([^:\s]+):(\S+)$/;
// pi-ai provider ids: lowercase letters, digits and . _ - (for example "openai", "amazon-bedrock").
const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]*$/;

const MODEL_HELP =
  "format provider:model, or set the provider with LLM_PROVIDER / GEN_PROVIDER / JUDGE_PROVIDER";

const RawEnv = Type.Object({
  LLM_MODE: Type.Optional(Type.Union([Type.Literal("live"), Type.Literal("fake")])),
  LLM_PROVIDER: Type.Optional(Type.String({ pattern: PROVIDER_ID.source })),
  GEN_PROVIDER: Type.Optional(Type.String({ pattern: PROVIDER_ID.source })),
  JUDGE_PROVIDER: Type.Optional(Type.String({ pattern: PROVIDER_ID.source })),
  GEN_MODEL: Type.Optional(Type.String({ pattern: "^\\S+$" })),
  JUDGE_MODEL: Type.Optional(Type.String({ pattern: "^\\S+$" })),
  LLM_BASE_URL: Type.Optional(Type.String()),
  GEN_BASE_URL: Type.Optional(Type.String()),
  JUDGE_BASE_URL: Type.Optional(Type.String()),
  RUN_TTL_HOURS: Type.Optional(Type.Integer({ minimum: 1, maximum: 720 })),
});

export interface ModelRef {
  provider: string;
  model: string;
  /** Overrides the provider's default API endpoint (proxy, regional host, local server). */
  baseUrl?: string;
  /** The `LLM_PROFILE` / `GEN_PROFILE` / `JUDGE_PROFILE` this came from, if any. */
  profile?: string;
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

/**
 * Resolve one role. With a provider (role-specific, else `LLM_PROVIDER`) the model id is taken
 * literally, so ids containing colons (`meta/llama:free`) need no special handling, and a redundant
 * `provider:` prefix is dropped. Without a provider the model must be written `provider:model`.
 */
function resolveRef(provider: string | undefined, model: string | undefined): ModelRef | undefined {
  if (!model) return undefined;
  if (!provider) return parseModelRef(model);
  const prefix = `${provider}:`;
  const bare = model.startsWith(prefix) ? model.slice(prefix.length) : model;
  return bare ? { provider, model: bare } : undefined;
}

/** http(s) only; trailing slashes are dropped so the URL joins cleanly with request paths. */
function cleanBaseUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return value.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

/** `nararouter` -> `NARAROUTER`, `my-proxy` -> `MY_PROXY`: the prefix of a profile's variables. */
export function profilePrefix(profile: string): string {
  return profile.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

type Role = "GEN" | "JUDGE";
type Source = Record<string, string | undefined>;

/**
 * Profiles are the one-line provider switch. `LLM_PROFILE=nararouter` selects the variables that
 * start with `NARAROUTER_`:
 *
 *   NARAROUTER_BASE_URL, NARAROUTER_GEN_MODEL, NARAROUTER_JUDGE_MODEL, NARAROUTER_API_KEY
 *
 * and expands them into the generic role settings (`GEN_PROVIDER=nararouter`, `GEN_MODEL=…`,
 * `GEN_BASE_URL=…`, and the same for the judge). A generic variable that is set explicitly wins.
 * `GEN_PROFILE` / `JUDGE_PROFILE` override the profile for one role, so the judge can sit on a
 * different provider than the generator. The profile name is also the provider id: a built-in one
 * such as `openrouter` uses pi-ai's catalog; any other name is a custom OpenAI-compatible endpoint.
 */
function expandProfiles(input: Source): {
  source: Source;
  profiles: Partial<Record<Role, string>>;
  issues: string[];
} {
  const issues: string[] = [];
  const source: Source = { ...input };
  const profiles: Partial<Record<Role, string>> = {};
  const live = input.LLM_MODE?.trim() === "live";
  const read = (key: string): string | undefined => input[key]?.trim() || undefined;
  const shared = read("LLM_PROFILE")?.toLowerCase();

  for (const key of ["LLM_PROFILE", "GEN_PROFILE", "JUDGE_PROFILE"]) {
    const v = read(key)?.toLowerCase();
    if (v && !PROVIDER_ID.test(v)) {
      issues.push(`${key}: use lowercase letters, digits and - _ . (for example "openrouter")`);
    }
  }

  const reported = new Set<string>();
  for (const role of ["GEN", "JUDGE"] as const) {
    const profile = read(`${role}_PROFILE`)?.toLowerCase() ?? shared;
    if (!profile || !PROVIDER_ID.test(profile)) continue;
    profiles[role] = profile;

    const p = profilePrefix(profile);
    const model = read(`${p}_${role}_MODEL`);
    const known = ["BASE_URL", "GEN_MODEL", "JUDGE_MODEL", "API_KEY"].some((k) =>
      read(`${p}_${k}`),
    );
    if (live && !known && !reported.has(profile)) {
      reported.add(profile);
      issues.push(
        `${role === "GEN" && !read("GEN_PROFILE") ? "LLM_PROFILE" : `${role}_PROFILE`}=${profile}: no ${p}_* settings found. Define ${p}_GEN_MODEL and ${p}_JUDGE_MODEL (plus ${p}_BASE_URL and ${p}_API_KEY as needed)`,
      );
    } else if (live && known && !model && !read(`${role}_MODEL`)) {
      issues.push(`${p}_${role}_MODEL: required for profile "${profile}"`);
    }

    if (!read(`${role}_PROVIDER`)) source[`${role}_PROVIDER`] = profile;
    if (!read(`${role}_MODEL`)) source[`${role}_MODEL`] = model;
    if (!read(`${role}_BASE_URL`)) source[`${role}_BASE_URL`] = read(`${p}_BASE_URL`);
  }
  return { source, profiles, issues };
}

/**
 * Pure: validates every variable and reports all problems at once. Provider API keys are pi-ai's
 * concern; this only decides which provider, model and endpoint each role uses.
 *
 *   LLM_PROFILE=nararouter                                    (profile: see expandProfiles)
 *   LLM_PROVIDER=anthropic  GEN_MODEL=claude-sonnet-5-5  JUDGE_PROVIDER=openai  JUDGE_MODEL=gpt-5-mini
 *   GEN_MODEL=anthropic:claude-sonnet-5-5               (combined form, no provider variables)
 *
 * Endpoints: `GEN_BASE_URL` / `JUDGE_BASE_URL` apply to one role. `LLM_BASE_URL` is the default for
 * roles that use the default provider only: a role with its own `*_PROVIDER` must set its own URL,
 * so a judge on another vendor is never sent to the generator's endpoint.
 */
export function parseEnv(input: Source): Env {
  const { source, profiles, issues } = expandProfiles(input);

  const raw: Record<string, unknown> = {};
  for (const key of ["LLM_MODE", "GEN_MODEL", "JUDGE_MODEL"] as const) {
    const v = source[key]?.trim();
    if (v) raw[key] = v;
  }
  for (const key of ["LLM_PROVIDER", "GEN_PROVIDER", "JUDGE_PROVIDER"] as const) {
    const v = source[key]?.trim().toLowerCase();
    if (v) raw[key] = v;
  }
  for (const key of ["LLM_BASE_URL", "GEN_BASE_URL", "JUDGE_BASE_URL"] as const) {
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

  const str = (key: string): string | undefined => {
    const v = raw[key];
    return typeof v === "string" ? v : undefined;
  };

  const llmMode = raw.LLM_MODE === "live" ? "live" : "fake";
  const defaultProvider = str("LLM_PROVIDER");
  const genRef = resolveRef(str("GEN_PROVIDER") ?? defaultProvider, str("GEN_MODEL"));
  const judgeRef = resolveRef(str("JUDGE_PROVIDER") ?? defaultProvider, str("JUDGE_MODEL"));

  const cleaned = new Map<string, string>();
  for (const name of ["LLM_BASE_URL", "GEN_BASE_URL", "JUDGE_BASE_URL"]) {
    const value = str(name);
    if (value === undefined) continue;
    const url = cleanBaseUrl(value);
    if (url) cleaned.set(name, url);
    else issues.push(`${name}: must be an http(s) URL, for example https://openrouter.ai/api/v1`);
  }
  // Own URL wins; the shared LLM_BASE_URL applies only if the role has no provider of its own.
  const withUrl = (
    ref: ModelRef | undefined,
    ownUrl: string,
    ownProvider: string,
  ): ModelRef | undefined => {
    if (!ref) return ref;
    const url =
      cleaned.get(ownUrl) ??
      (str(ownProvider) === undefined ? cleaned.get("LLM_BASE_URL") : undefined);
    return url ? { ...ref, baseUrl: url } : ref;
  };
  const tag = (ref: ModelRef | undefined, profile: string | undefined): ModelRef | undefined =>
    ref && profile ? { ...ref, profile } : ref;
  const genModel = tag(withUrl(genRef, "GEN_BASE_URL", "GEN_PROVIDER"), profiles.GEN);
  const judgeModel = tag(withUrl(judgeRef, "JUDGE_BASE_URL", "JUDGE_PROVIDER"), profiles.JUDGE);

  // A model was given but cannot be resolved: no provider anywhere and no "provider:" prefix.
  for (const [name, model, ref] of [
    ["GEN_MODEL", str("GEN_MODEL"), genModel],
    ["JUDGE_MODEL", str("JUDGE_MODEL"), judgeModel],
  ] as const) {
    if (model && !ref && !issues.some((i) => i.startsWith(`${name}:`))) {
      issues.push(`${name}: ${MODEL_HELP}`);
    }
  }

  // A role that uses a profile already got a specific message that names the profile's variable.
  if (llmMode === "live") {
    if (!str("GEN_MODEL") && !profiles.GEN) {
      issues.push(`GEN_MODEL: required when LLM_MODE=live (${MODEL_HELP})`);
    }
    if (!str("JUDGE_MODEL") && !profiles.JUDGE) {
      issues.push(`JUDGE_MODEL: required when LLM_MODE=live (${MODEL_HELP})`);
    }
  }

  if (issues.length > 0) throw new EnvError(issues);

  return {
    llmMode,
    genModel,
    judgeModel,
    runTtlHours: typeof raw.RUN_TTL_HOURS === "number" ? raw.RUN_TTL_HOURS : 24,
  };
}

/** Which provider and model each role will use, for startup messages and scripts. */
export function describeSelection(env: Env): string {
  const one = (r: ModelRef | undefined): string =>
    r
      ? `${r.provider}:${r.model}${r.baseUrl ? ` @ ${r.baseUrl}` : ""}${r.profile ? `  [profile ${r.profile}]` : ""}`
      : "(not set)";
  return `generator ${one(env.genModel)}\n  judge     ${one(env.judgeModel)}`;
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
