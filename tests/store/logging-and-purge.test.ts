import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, REDACT_FIELDS } from "@/config/logger";
import type { RunStore } from "@/core/ports/store";
import { SqliteRunStore, startPurgeSchedule } from "@/store";
import { runWith } from "../support/pipeline";

function capture(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      chunks.push(String(chunk));
      done();
    },
  });
  return { stream, text: () => chunks.join("") };
}

const SECRET = "NARWHAL-SENTINEL-7781";

describe("logger redaction (invariant 7: source text never reaches logs)", () => {
  it.each(REDACT_FIELDS)("redacts '%s' at the top level and one level down", (field) => {
    const { stream, text } = capture();
    const log = createLogger({ stream, level: "info" });
    log.info({ [field]: SECRET }, "top");
    log.info({ wrapper: { [field]: SECRET } }, "nested");
    expect(text()).not.toContain(SECRET);
    expect(text()).toContain("[redacted]");
  });

  it("redacts a whole source document", () => {
    const { stream, text } = capture();
    createLogger({ stream }).info(
      { doc: { sentences: [{ id: "S1.1", text: SECRET }] }, runId: "r1" },
      "oops",
    );
    expect(text()).not.toContain(SECRET);
    expect(text()).toContain("r1"); // identifiers stay useful
  });

  it("leaves ordinary fields alone", () => {
    const { stream, text } = capture();
    createLogger({ stream }).info({ runId: "r1", generated: 24 }, "hello");
    const line = JSON.parse(text().trim());
    expect(line).toMatchObject({ runId: "r1", generated: 24, msg: "hello" });
  });
});

describe("the SQLite store logs identifiers and counts, never source text", () => {
  it("a full run with a sentinel in the notes leaves it out of the log", async () => {
    const { stream, text } = capture();
    const log = createLogger({ stream, level: "info" });
    const store = SqliteRunStore.open(":memory:", { log });
    const notes = `## Animals\n\nThe ${SECRET} is a striped animal that lives on the savanna. It eats grass all day long.`;
    const { result } = await runWith({ store }, notes);
    await store.deleteRun(result.runId);

    const output = text();
    expect(output).not.toContain(SECRET);
    expect(output).toContain(result.runId);
    expect(output).toContain("run created");
    expect(output).toContain("run saved");
    expect(output).toContain("run deleted");
  });
});

describe("retention schedule", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const fakeStore = (impl: (cutoff: Date) => Promise<number>) => {
    const calls: Date[] = [];
    const store = {
      purgeOlderThan: async (cutoff: Date) => {
        calls.push(cutoff);
        return impl(cutoff);
      },
    } as unknown as RunStore;
    return { store, calls };
  };

  it("sweeps immediately with a cutoff of now minus the TTL", async () => {
    const now = new Date("2026-10-24T12:00:00.000Z");
    const { store, calls } = fakeStore(async () => 3);
    const purged: number[] = [];
    const schedule = startPurgeSchedule(store, {
      ttlHours: 24,
      clock: () => now,
      onPurged: (n) => purged.push(n),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.toISOString()).toBe("2026-10-23T12:00:00.000Z");
    expect(purged).toEqual([3]);
    schedule.stop();
  });

  it("sweeps again every hour, and stops when told to", async () => {
    const { store, calls } = fakeStore(async () => 0);
    const schedule = startPurgeSchedule(store, { ttlHours: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2 * 3_600_000);
    expect(calls).toHaveLength(4);
    schedule.stop();
    await vi.advanceTimersByTimeAsync(5 * 3_600_000);
    expect(calls).toHaveLength(4);
  });

  it("uses the clock at each sweep, so the cutoff moves forward", async () => {
    let now = new Date("2026-10-24T00:00:00.000Z");
    const { store, calls } = fakeStore(async () => 0);
    const schedule = startPurgeSchedule(store, { ttlHours: 24, clock: () => now });
    await vi.advanceTimersByTimeAsync(0);
    now = new Date("2026-10-25T00:00:00.000Z");
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(calls.map((c) => c.toISOString())).toEqual([
      "2026-10-23T00:00:00.000Z",
      "2026-10-24T00:00:00.000Z",
    ]);
    schedule.stop();
  });

  it("a failing sweep is reported and does not stop the schedule", async () => {
    let n = 0;
    const { store, calls } = fakeStore(async () => {
      if (++n === 1) throw new Error("disk busy");
      return 2;
    });
    const errors: unknown[] = [];
    const purged: number[] = [];
    const schedule = startPurgeSchedule(store, {
      ttlHours: 1,
      onError: (e) => errors.push(e),
      onPurged: (c) => purged.push(c),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect((errors[0] as Error).message).toBe("disk busy");
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(calls).toHaveLength(2);
    expect(purged).toEqual([2]);
    schedule.stop();
  });

  it("runNow returns how many runs were removed", async () => {
    const { store } = fakeStore(async () => 5);
    const schedule = startPurgeSchedule(store, { ttlHours: 1 });
    expect(await schedule.runNow()).toBe(5);
    schedule.stop();
  });
});
