import { describe, expect, it } from "vitest";
import { failedChecks } from "@/ui/checks";
import { initialProgress, reduceProgress, STAGES, stageStatus, stagesFor } from "@/ui/progress";
import { runWith } from "../support/pipeline";

describe("progress reducer over a real (scripted) run", () => {
  it("ends with every stage done, the counts the report states, and the run id", async () => {
    const h = await runWith();
    const state = h.events.reduce(reduceProgress, initialProgress);

    expect(STAGES.every((s) => stageStatus(state, s) === "done")).toBe(true);
    expect(state.current).toBeNull();
    expect(state.runId).toBe(h.result.runId);
    expect(state.drafted).toBe(h.result.report.generated);
    expect(state.removed).toBe(h.result.report.removed);
    expect(state.error).toBeNull();
  });

  it("shows the current stage as active and later ones as waiting mid-run", async () => {
    const h = await runWith();
    const upToVerify = h.events.slice(
      0,
      h.events.findIndex(
        (e) => e.type === "stage" && e.stage === "verify" && e.status === "start",
      ) + 1,
    );
    const state = upToVerify.reduce(reduceProgress, initialProgress);
    expect(stageStatus(state, "generate")).toBe("done");
    expect(stageStatus(state, "verify")).toBe("active");
    expect(stageStatus(state, "repair")).toBe("waiting");
    expect(state.runId).toBeNull();
  });

  it("records an error event", () => {
    const state = reduceProgress(initialProgress, {
      type: "error",
      code: "aborted",
      message: "stopped",
      runId: "r",
      seq: 1,
      at: "2026-10-24T00:00:00.000Z",
    });
    expect(state.error).toEqual({ code: "aborted", message: "stopped" });
  });
});

describe("failedChecks", () => {
  it("names each failing check in words, and nothing for a clean item", async () => {
    const h = await runWith();
    const clean = h.result.summary[0]?.envelope;
    expect(clean && failedChecks(clean)).toEqual([]);

    const contradicted = h.result.removed.find((r) => r.kind === "contradicted")?.envelope;
    expect(contradicted).toBeDefined();
    if (contradicted) {
      const text = failedChecks(contradicted).join(" ");
      expect(text).toMatch(/Entailment check|Second reviewer/);
    }
  });
});

describe("plain-language stage", () => {
  it("is part of the stage list only when asked for, and is last", () => {
    expect(stagesFor(false)).toEqual(["parse", "generate", "verify", "repair", "assemble"]);
    expect(stagesFor(true).at(-1)).toBe("plain");
    expect(stagesFor(true)).toHaveLength(6);
  });

  it("completes in the reducer when a plain run finishes", async () => {
    const h = await runWith(undefined, undefined, { plain: true });
    const state = h.events.reduce(reduceProgress, initialProgress);
    expect(stagesFor(true).every((s) => stageStatus(state, s) === "done")).toBe(true);
  });
});
