import { describe, expect, it } from "vitest";
import { generateDrafts, TOOL_NAMES } from "@/core/generate";
import type { LlmClient, StructuredRequest } from "@/core/ports/llm";
import { ok } from "@/core/ports/result";
import { limitInFlight } from "@/core/util/limit";
import { FakeLlmClient } from "@/llm/fake";
import { longDoc } from "../../support/docs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const USAGE = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

/** A client that records how many calls are in flight and the order calls actually started. */
function probe(latency = 10) {
  const state = { inFlight: 0, peak: 0, started: [] as string[] };
  const client: LlmClient = {
    async generateStructured(req) {
      state.started.push(req.user);
      state.inFlight++;
      state.peak = Math.max(state.peak, state.inFlight);
      await sleep(latency);
      state.inFlight--;
      return ok({ value: {} as never, usage: USAGE });
    },
  };
  return { client, state };
}

const request = (user: string, signal?: AbortSignal): StructuredRequest<never> =>
  ({ role: "generator", system: "", user, toolName: "t", schema: {}, signal }) as never;

describe("limitInFlight", () => {
  it("never lets more than `max` calls run at once, however many ask", async () => {
    const { client, state } = probe();
    const limited = limitInFlight(client, 3);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => limited.generateStructured(request(String(i)))),
    );
    expect(state.peak).toBe(3);
    expect(state.started).toHaveLength(20);
  });

  it("serves waiting calls first come, first served", async () => {
    const { client, state } = probe();
    const limited = limitInFlight(client, 1);
    await Promise.all(["a", "b", "c", "d"].map((u) => limited.generateStructured(request(u))));
    expect(state.started).toEqual(["a", "b", "c", "d"]);
  });

  it("runs everything at once when the cap is higher than the demand", async () => {
    const { client, state } = probe();
    await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        limitInFlight(client, 10).generateStructured(request(String(i))),
      ),
    );
    expect(state.peak).toBe(4);
  });

  it("frees the slot when a call throws, so later calls still run", async () => {
    let n = 0;
    const flaky: LlmClient = {
      async generateStructured() {
        if (n++ === 0) throw new Error("boom");
        return ok({ value: {} as never, usage: USAGE });
      },
    };
    const limited = limitInFlight(flaky, 1);
    await expect(limited.generateStructured(request("x"))).rejects.toThrow("boom");
    const second = await limited.generateStructured(request("y"));
    expect(second.ok).toBe(true);
  });

  it("does not send a call that was cancelled while it waited", async () => {
    const { client, state } = probe(30);
    const limited = limitInFlight(client, 1);
    const stop = new AbortController();
    const first = limited.generateStructured(request("first"));
    const waiting = limited.generateStructured(request("waiting", stop.signal));
    const later = limited.generateStructured(request("later"));
    stop.abort();
    const refused = await waiting;
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("aborted");
    await Promise.all([first, later]);
    expect(state.started).toEqual(["first", "later"]);
    // the queue still moves after the refusal
    expect((await limited.generateStructured(request("after"))).ok).toBe(true);
  });

  it("refuses at once when the signal is already aborted and the client is busy", async () => {
    const { client, state } = probe(30);
    const limited = limitInFlight(client, 1);
    const stop = new AbortController();
    stop.abort();
    const busy = limited.generateStructured(request("busy"));
    const r = await limited.generateStructured(request("late", stop.signal));
    expect(r.ok).toBe(false);
    await busy;
    expect(state.started).toEqual(["busy"]);
  });
});

describe("generation overlaps the three artefacts", () => {
  it("has summary, glossary and questions calls in flight together, and the cap still holds", async () => {
    const doc = await longDoc(3, 4);
    const active = new Set<string>();
    let together = 0;
    let inFlight = 0;
    let peak = 0;
    const step = (tool: string) => async () => {
      active.add(tool);
      inFlight++;
      peak = Math.max(peak, inFlight);
      together = Math.max(together, active.size);
      await sleep(15);
      inFlight--;
      active.delete(tool);
      return { items: [], insufficient_reason: "" };
    };
    const fake = new FakeLlmClient({
      [TOOL_NAMES.summary]: step("summary"),
      [TOOL_NAMES.glossary]: step("glossary"),
      [TOOL_NAMES.questions]: step("questions"),
    });

    await generateDrafts(doc, { llm: fake });
    expect(together).toBe(3);
    expect(peak).toBeGreaterThan(3);

    peak = 0;
    await generateDrafts(doc, { llm: limitInFlight(fake, 2) });
    expect(peak).toBe(2);
  });

  it("is faster than doing them one after another (the point of the change)", async () => {
    const doc = await longDoc(3, 4);
    const step = async () => {
      await sleep(40);
      return { items: [], insufficient_reason: "" };
    };
    const llm = new FakeLlmClient({
      [TOOL_NAMES.summary]: step,
      [TOOL_NAMES.glossary]: step,
      [TOOL_NAMES.questions]: step,
    });
    const t0 = Date.now();
    await generateDrafts(doc, { llm });
    // 3 sections x 2 artefacts + 1 questions call: one after another would take at least 3 x 40 ms.
    expect(Date.now() - t0).toBeLessThan(110);
  });
});
