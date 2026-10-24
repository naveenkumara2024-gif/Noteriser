import type { TSchema } from "typebox";
import Value from "typebox/value";
import type {
  LlmClient,
  LlmError,
  LlmRole,
  StructuredRequest,
  StructuredResponse,
  Usage,
} from "../core/ports/llm";
import { err, ok, type Result } from "../core/ports/result";

/** A scripted failure. */
export class FakeFailure {
  constructor(
    readonly code: LlmError["code"],
    readonly message: string,
  ) {}
}

export const fail = (code: LlmError["code"], message = `scripted ${code}`): FakeFailure =>
  new FakeFailure(code, message);

export interface RecordedRequest {
  role: LlmRole;
  toolName: string;
  system: string;
  user: string;
  temperature: number | undefined;
  signal: AbortSignal | undefined;
}

/** Computes a reply from the request; may be async to simulate latency or out-of-order arrival. */
export type FakeStepFn = (req: RecordedRequest, call: number) => unknown;

/**
 * A scripted reply: a plain object (the tool arguments), a `fail(...)`, or a function returning
 * either. Plain data is typed as an object, not `unknown`, so that function steps keep their
 * contextually typed parameters.
 */
export type FakeStep = Record<string, unknown> | FakeFailure | FakeStepFn;

export interface FakeLlmOptions {
  /** Reported for every successful call. */
  usage?: Usage;
}

const DEFAULT_USAGE: Usage = { inputTokens: 100, outputTokens: 50, costUsd: 0.001 };

/**
 * Scripted `LlmClient`. Responses are keyed by tool name: a single value or function answers every
 * call, an array is a queue consumed in order. Like the real adapter it validates each value
 * against the request schema, so a test script that drifts from the schema fails loudly.
 */
export class FakeLlmClient implements LlmClient {
  readonly requests: RecordedRequest[] = [];
  private readonly counts = new Map<string, number>();
  private readonly usage: Usage;

  constructor(
    private readonly script: Record<string, FakeStep | FakeStep[]>,
    options: FakeLlmOptions = {},
  ) {
    this.usage = options.usage ?? DEFAULT_USAGE;
  }

  callsTo(toolName: string): RecordedRequest[] {
    return this.requests.filter((r) => r.toolName === toolName);
  }

  async generateStructured<S extends TSchema>(
    req: StructuredRequest<S>,
  ): Promise<Result<StructuredResponse<S>, LlmError>> {
    const recorded: RecordedRequest = {
      role: req.role,
      toolName: req.toolName,
      system: req.system,
      user: req.user,
      temperature: req.temperature,
      signal: req.signal,
    };
    this.requests.push(recorded);

    const failure = (code: LlmError["code"], message: string): LlmError => ({
      code,
      message,
      usage: this.usage,
    });

    if (req.signal?.aborted) return err(failure("aborted", "aborted before the call"));

    const n = this.counts.get(req.toolName) ?? 0;
    this.counts.set(req.toolName, n + 1);

    const entry = this.script[req.toolName];
    if (entry === undefined) {
      return err(failure("provider", `FakeLlmClient: nothing scripted for tool "${req.toolName}"`));
    }
    const step: FakeStep | undefined = Array.isArray(entry) ? entry[n] : entry;
    if (step === undefined) {
      return err(failure("provider", `FakeLlmClient: script for "${req.toolName}" is exhausted`));
    }

    const resolved: unknown = await (typeof step === "function" ? step(recorded, n) : step);
    if (resolved instanceof FakeFailure) return err(failure(resolved.code, resolved.message));

    if (!Value.Check(req.schema, resolved)) {
      const first = Value.Errors(req.schema, resolved)[0];
      const where = first
        ? `${first.instancePath || "(root)"}: ${first.message}`
        : "does not match";
      return err(
        failure(
          "invalid_args",
          `scripted value for "${req.toolName}" violates its schema (${where})`,
        ),
      );
    }
    return ok({ value: resolved, usage: this.usage });
  }
}
