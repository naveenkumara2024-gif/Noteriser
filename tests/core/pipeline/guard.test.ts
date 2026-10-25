import { describe, expect, it } from "vitest";
import { TOOL_NAMES } from "@/core/generate";
import { lecture7Fakes, lecture7Llm } from "@/demo";
import { invariantViolations, runWith } from "../../support/pipeline";

const lastError = (events: { type: string }[]) =>
  events.filter((e) => e.type === "error").at(-1) as { code: string; message: string } | undefined;

describe("per-run limits", () => {
  it("refuses notes with too many sentences before any model call", async () => {
    const llm = lecture7Llm();
    const h = await runWith({ llm, nli: lecture7Fakes().nli, limits: { maxSentences: 10 } });
    expect(h.result.status).toBe("failed");
    expect(lastError(h.events)).toMatchObject({ code: "limit_exceeded" });
    expect(lastError(h.events)?.message).toMatch(/15 sentences; the limit is 10/);
    expect(llm.requests).toHaveLength(0);
  });

  it("stops at the model-call cap, says so, and keeps what finished", async () => {
    const llm = lecture7Llm();
    const h = await runWith({ llm, nli: lecture7Fakes().nli, limits: { maxLlmCalls: 3 } });
    expect(h.result.status).toBe("incomplete");
    expect(lastError(h.events)).toMatchObject({ code: "limit_exceeded" });
    expect(lastError(h.events)?.message).toMatch(/limit of 3 model calls/);
    expect(llm.requests.length).toBeLessThanOrEqual(3);
    expect(invariantViolations(h)).toEqual([]);
  });

  it("stops when the reported cost passes the cap", async () => {
    // each scripted call reports $0.001
    const h = await runWith({ limits: { maxCostUsd: 0.0025 } });
    expect(h.result.status).toBe("incomplete");
    expect(lastError(h.events)?.message).toMatch(/cost limit of \$0\.00/);
    expect(h.result.report.usage.costUsd).toBeLessThan(0.02);
    expect(invariantViolations(h)).toEqual([]);
  });

  it("stops at the time limit", async () => {
    // a generator that never answers by itself: only the limit can end the run
    const llm = lecture7Llm({
      [TOOL_NAMES.summary]: (req) =>
        new Promise((resolve) =>
          req.signal?.addEventListener(
            "abort",
            () => resolve({ items: [], insufficient_reason: "" }),
            { once: true },
          ),
        ),
    });
    const h = await runWith({ llm, nli: lecture7Fakes().nli, limits: { timeoutMs: 50 } });
    expect(h.result.status).toBe("incomplete");
    expect(lastError(h.events)).toMatchObject({ code: "limit_exceeded" });
    expect(lastError(h.events)?.message).toMatch(/longer than its limit of 50 ms/);
  });

  it("a generous limit changes nothing", async () => {
    const free = await runWith();
    const capped = await runWith({
      limits: { maxSentences: 1000, maxLlmCalls: 10_000, maxCostUsd: 100, timeoutMs: 600_000 },
    });
    expect(capped.result.status).toBe("complete");
    expect(capped.result.report).toEqual(free.result.report);
  });

  it("a cancelled request is still reported as cancelled, not as a limit", async () => {
    const controller = new AbortController();
    const h = await runWith({
      signal: controller.signal,
      limits: { maxLlmCalls: 10_000 },
      onEvent: (e) => {
        if (e.type === "stage" && e.stage === "verify" && e.status === "start") controller.abort();
      },
    });
    expect(lastError(h.events)?.code).toBe("aborted");
  });
});

describe("abort on client disconnect reaches the model call", () => {
  it("the fake model sees signal.aborted === true when the caller aborts", async () => {
    const controller = new AbortController();
    const seen: boolean[] = [];
    const llm = lecture7Llm({
      [TOOL_NAMES.summary]: (req) =>
        new Promise((resolve) => {
          req.signal?.addEventListener(
            "abort",
            () => {
              seen.push(req.signal?.aborted === true);
              resolve({ items: [], insufficient_reason: "" });
            },
            { once: true },
          );
          setTimeout(() => controller.abort(), 10);
        }),
    });
    const h = await runWith({ llm, nli: lecture7Fakes().nli, signal: controller.signal });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
    expect(h.result.status).toBe("incomplete");
  });
});
