import { describe, expect, it } from "vitest";
import { TOOL_NAMES } from "@/core/generate";
import type { LlmClient } from "@/core/ports/llm";
import { err } from "@/core/ports/result";
import { lecture7Fakes, lecture7Llm } from "@/demo";
import { fail } from "@/llm/fake";
import { FakeNli } from "@/nlp/fake";
import { invariantViolations, runWith } from "../../support/pipeline";

const shown = (r: Awaited<ReturnType<typeof runWith>>["result"]) => [
  ...r.summary,
  ...r.glossary,
  ...r.questions,
];

describe("degraded modes: behaviour, not just no crash", () => {
  it("entailment model unavailable: nothing is SUPPORTED, items cap at PARTIAL, the banner flag is set", async () => {
    const h = await runWith({
      nli: new FakeNli(new Error("model files missing")),
      llm: lecture7Llm(),
    });
    expect(h.result.status).toBe("complete");
    expect(h.result.degraded).toBe(true);
    expect(h.result.warnings.map((w) => w.code)).toContain("verifier_degraded");
    expect(shown(h.result).length).toBeGreaterThan(0);
    for (const s of shown(h.result)) {
      expect(s.envelope.verdict, s.envelope.itemId).not.toBe("SUPPORTED");
      expect(s.flagged).toBe(true);
      expect(s.envelope.scores.entailment).toBeNull();
    }
    expect(invariantViolations(h)).toEqual([]);
  });

  it("judge provider error: same, and the reason says the second review did not run", async () => {
    const llm = lecture7Llm({ submit_verdict: fail("provider", "503 judge down") });
    const h = await runWith({ llm, nli: lecture7Fakes().nli });
    expect(h.result.degraded).toBe(true);
    expect(shown(h.result).some((s) => s.envelope.verdict === "SUPPORTED")).toBe(false);
    expect(shown(h.result).every((s) => s.envelope.scores.judge === "not_run")).toBe(true);
    expect(shown(h.result)[0]?.envelope.flagReason).toMatch(/second review did not run/);
    expect(invariantViolations(h)).toEqual([]);
  });

  it("a generator error on one section: that section is reported as failed and the rest continue", async () => {
    // the stock script for everything except the summary call for section 2, which errors
    const stock = lecture7Llm();
    const wrapped: LlmClient = {
      generateStructured: (req) =>
        req.toolName === TOOL_NAMES.summary &&
        /Section 2,/.test(req.user) &&
        !req.user.includes("<item_to_repair>")
          ? Promise.resolve(
              err({
                code: "provider" as const,
                message: "503 for section 2",
                usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
              }),
            )
          : stock.generateStructured(req),
    };
    const h = await runWith({ llm: wrapped, nli: lecture7Fakes().nli });

    expect(h.result.status).toBe("complete");
    const failures = h.result.warnings.filter((w) => w.code === "generation_failed");
    expect(failures.some((w) => /section:2/.test(w.message))).toBe(true);
    // sections 1 and 3 still produced summary points, and the glossary and questions were unaffected
    const sections = new Set(
      h.result.summary.flatMap((s) => s.envelope.sourceIds.map((id) => id.split(".")[0])),
    );
    expect(sections.has("S1")).toBe(true);
    expect(sections.has("S3")).toBe(true);
    expect(h.result.glossary.length).toBeGreaterThan(0);
    expect(h.result.questions.length).toBeGreaterThan(0);
    expect(invariantViolations(h)).toEqual([]);
  });

  it("every model call fails: a clear error and a failed run, never an empty success", async () => {
    const down = {
      generateStructured: async () => ({
        ok: false as const,
        error: {
          code: "provider" as const,
          message: "503 everything is down",
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        },
      }),
    };
    const h = await runWith({ llm: down, nli: lecture7Fakes().nli });
    expect(h.result.status).toBe("failed");
    expect(h.events.find((e) => e.type === "error")).toMatchObject({ code: "generation_failed" });
    expect(shown(h.result)).toHaveLength(0);
    expect(h.result.warnings.some((w) => w.code === "generation_failed")).toBe(true);
  });

  it("nothing is ever SUPPORTED unless all four checks ran and passed, in any of these modes", async () => {
    const modes = [
      { nli: new FakeNli(new Error("down")), llm: lecture7Llm() },
      { nli: lecture7Fakes().nli, llm: lecture7Llm({ submit_verdict: fail("no_tool_call") }) },
      { nli: lecture7Fakes().nli, llm: lecture7Llm({ submit_verdict: fail("invalid_args") }) },
    ];
    for (const m of modes) {
      const h = await runWith(m);
      for (const s of shown(h.result)) {
        const e = s.envelope;
        if (e.verdict === "SUPPORTED") {
          expect(e.scores.quoteFound).toBe(true);
          expect(e.scores.entailment).not.toBeNull();
          expect(e.scores.judge).toBe("pass");
        }
      }
      expect(invariantViolations(h)).toEqual([]);
    }
  });
});
