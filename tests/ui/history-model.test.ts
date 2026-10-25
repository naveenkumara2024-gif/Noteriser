import { describe, expect, it } from "vitest";
import type { RunSummary } from "@/core/ports/run-index";
import { filterRuns, groupByTitle, normalise, rowStatus } from "@/ui/shell/history-model";
import { relativeLong, relativeShort } from "@/ui/shell/relative-time";

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const ago = (ms: number): number => NOW - ms;
const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

describe("relativeShort", () => {
  it.each([
    [0, "now"],
    [59 * S, "now"],
    [60 * S, "1m"],
    [59 * M, "59m"],
    [60 * M, "1h"],
    [23 * H + 59 * M, "23h"],
    [24 * H, "1d"],
    [6 * D, "6d"],
    [7 * D, "1w"],
    [27 * D, "3w"],
    [-5 * M, "now"],
  ])("%d ms ago reads %s", (age, expected) => {
    expect(relativeShort(NOW, ago(age))).toBe(expected);
  });

  it("falls back to a short date after four weeks", () => {
    expect(relativeShort(NOW, ago(40 * D))).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });
});

describe("relativeLong", () => {
  it("spells the same moments out for screen readers", () => {
    expect(relativeLong(NOW, ago(10 * S))).toBe("just now");
    expect(relativeLong(NOW, ago(60 * M))).toBe("1 hour ago");
    expect(relativeLong(NOW, ago(3 * H))).toBe("3 hours ago");
    expect(relativeLong(NOW, ago(6 * D))).toBe("6 days ago");
    expect(relativeLong(NOW, ago(14 * D))).toBe("2 weeks ago");
    expect(relativeLong(NOW, ago(60 * D))).toMatch(/^on [A-Z]/);
  });
});

const run = (over: Partial<RunSummary>): RunSummary => ({
  runId: "r-0000001",
  title: "Lecture",
  createdAt: "2026-10-25T10:00:00.000Z",
  status: "complete",
  counts: { generated: 5, supported: 5, partial: 0, removed: 0 },
  degraded: false,
  ...over,
});

describe("search", () => {
  it("ignores case and accents", () => {
    expect(normalise("  Électricité ")).toBe("electricite");
    const runs = [run({ title: "Électricité" }), run({ title: "CPU scheduling" })];
    expect(filterRuns(runs, "electric").map((r) => r.title)).toEqual(["Électricité"]);
    expect(filterRuns(runs, "SCHED")).toHaveLength(1);
    expect(filterRuns(runs, "  ")).toHaveLength(2);
    expect(filterRuns(runs, "zzz")).toEqual([]);
  });
});

describe("groupByTitle", () => {
  it("groups runs that share a title, newest group and newest run first", () => {
    const runs = [
      run({ runId: "a-0000001", title: "Lecture 7", createdAt: "2026-10-24T10:00:00Z" }),
      run({ runId: "b-0000001", title: "Networks", createdAt: "2026-10-25T09:00:00Z" }),
      run({ runId: "c-0000001", title: "lecture 7", createdAt: "2026-10-25T10:00:00Z" }),
    ];
    const groups = groupByTitle(runs);
    expect(groups.map((g) => g.runs.map((r) => r.runId))).toEqual([
      ["c-0000001", "a-0000001"],
      ["b-0000001"],
    ]);
    expect(groups[0]?.title).toBe("lecture 7");
  });
});

describe("rowStatus", () => {
  it("says nothing for an ordinary run and names anything else", () => {
    expect(rowStatus(run({}))).toBeNull();
    expect(rowStatus(run({ status: "running", counts: null }))).toBe("running");
    expect(rowStatus(run({ status: "failed" }))).toBe("failed");
    expect(rowStatus(run({ status: "incomplete" }))).toBe("incomplete");
    expect(rowStatus(run({ degraded: true }))).toBe("degraded");
    expect(rowStatus(run({ counts: { generated: 5, supported: 4, partial: 1, removed: 0 } }))).toBe(
      "flagged",
    );
  });
});
