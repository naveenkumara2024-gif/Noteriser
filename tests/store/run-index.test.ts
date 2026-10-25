import { describe, expect, it } from "vitest";
import { type RunIndex, TITLE_MAX, titleFrom } from "@/core/ports/run-index";
import type { RunStore } from "@/core/ports/store";
import { MemoryRunStore, SqliteRunStore } from "@/store";
import { runWith } from "../support/pipeline";

const makers: [string, () => RunStore & RunIndex][] = [
  ["memory", () => new MemoryRunStore()],
  ["sqlite (:memory:)", () => SqliteRunStore.open(":memory:")],
];

describe.each(makers)("RunIndex contract: %s", (_name, make) => {
  it("summarises finished runs without any source or item text", async () => {
    const store = make();
    const { result } = await runWith({ store, newId: () => "run-0001" });
    const [summary, ...rest] = await store.summaries(["run-0001"]);
    expect(rest).toEqual([]);
    expect(summary).toMatchObject({
      runId: "run-0001",
      title: "Lecture 7: CPU Scheduling Basics",
      status: "complete",
      degraded: false,
      counts: {
        generated: result.report.generated,
        supported: result.report.supported,
        partial: result.report.partial,
        removed: result.report.removed,
      },
    });
    const text = JSON.stringify(summary);
    for (const s of result.doc?.sentences ?? []) expect(text).not.toContain(s.text);
    for (const s of result.summary) expect(text).not.toContain(s.envelope.text);
  });

  it("lists newest first, skips unknown and repeated ids", async () => {
    const store = make();
    await runWith({
      store,
      newId: () => "run-0001",
      clock: () => new Date("2026-10-24T10:00:00Z"),
    });
    await runWith({
      store,
      newId: () => "run-0002",
      clock: () => new Date("2026-10-24T11:00:00Z"),
    });
    const list = await store.summaries(["run-0001", "nope-0000", "run-0002", "run-0001"]);
    expect(list.map((s) => s.runId)).toEqual(["run-0002", "run-0001"]);
    expect(await store.summaries([])).toEqual([]);
  });

  it("a run with no result yet has null counts", async () => {
    const store = make();
    await store.createRun("run-0003", new Date("2026-10-24T10:00:00Z"));
    const [s] = await store.summaries(["run-0003"]);
    expect(s).toMatchObject({ status: "running", counts: null, title: "Untitled" });
  });
});

describe("titleFrom", () => {
  it("prefers the document title, then the first section, then a placeholder", () => {
    expect(titleFrom("Doc", "Section")).toBe("Doc");
    expect(titleFrom("  ", "Section")).toBe("Section");
    expect(titleFrom(undefined, null)).toBe("Untitled");
  });
  it("cuts long titles", () => {
    const long = "x".repeat(TITLE_MAX + 40);
    expect(titleFrom(long, null)).toHaveLength(TITLE_MAX);
  });
});
