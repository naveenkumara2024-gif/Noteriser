import { describe, expect, it } from "vitest";
import { failedChecks } from "@/ui/checks";
import {
  ACTIVITY_LIMIT,
  initialProgress,
  reduceProgress,
  STAGES,
  stageStatus,
  stagesFor,
} from "@/ui/progress";
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

describe("activity log", () => {
  it("has a line for each kind of event, in order, and never contains item or source text", async () => {
    const h = await runWith();
    const state = h.events.reduce(reduceProgress, initialProgress);
    const log = state.activity;
    expect(log.length).toBeGreaterThan(20);
    expect(log.map((l) => l.seq)).toEqual([...log.map((l) => l.seq)].sort((a, b) => a - b));
    const text = log.map((l) => l.text).join("\n");
    expect(text).toMatch(/Reading your notes: started/);
    expect(text).toMatch(/Drafted glossary entry glo-1/);
    expect(text).toMatch(
      /Checked question q-\d: (Supported|Not supported|Contradicted by the notes)/,
    );
    expect(text).toMatch(/Removed .*: /);

    // The log may name ids, kinds and verdict words. Item text, the notes' sentences and the
    // verifier's reasons (which quote both) must never reach it.
    for (const s of h.result.doc?.sentences ?? []) expect(text).not.toContain(s.text);
    for (const e of h.events) {
      if (e.type === "draft") expect(text).not.toContain(e.item.text);
      if (e.type === "verdict") for (const r of e.reasons) expect(text).not.toContain(r);
      if (e.type === "repaired") expect(text).not.toContain(e.before);
    }
  });

  it("keeps only the newest 200 lines", () => {
    let state = initialProgress;
    for (let i = 1; i <= 260; i++) {
      state = reduceProgress(state, {
        type: "warning",
        code: "some_code",
        message: `SECRET-${i}`,
        runId: "r",
        seq: i,
        at: "2026-10-24T00:00:00.000Z",
      });
    }
    expect(state.activity).toHaveLength(ACTIVITY_LIMIT);
    expect(state.activity[0]?.seq).toBe(61);
    expect(state.activity.at(-1)?.seq).toBe(260);
    // a warning's own message is never copied into the log, only its code
    expect(state.activity.map((l) => l.text).join()).not.toContain("SECRET");
    expect(state.activity.at(-1)?.text).toBe("Notice: some code");
  });

  it("names the type of an item that a later event only knows by id", () => {
    const at = "2026-10-24T00:00:00.000Z";
    let s = reduceProgress(initialProgress, {
      type: "draft",
      runId: "r",
      seq: 1,
      at,
      item: { type: "glossary", itemId: "glo-9", term: "T", text: "X" } as never,
    });
    s = reduceProgress(s, {
      type: "removed",
      runId: "r",
      seq: 2,
      at,
      itemId: "glo-9",
      kind: "unsupported",
      reasons: ["quotes the notes"],
    });
    expect(s.activity.map((l) => l.text)).toEqual([
      "Drafted glossary entry glo-9",
      expect.stringMatching(/^Removed glossary entry glo-9: /),
    ]);
  });
});
