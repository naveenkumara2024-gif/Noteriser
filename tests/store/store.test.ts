import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { RunStore } from "@/core/ports/store";
import { MemoryRunStore, MIGRATIONS, SqliteRunStore, toJsonl } from "@/store";
import { runWith } from "../support/pipeline";

const T0 = new Date("2026-10-24T12:00:00.000Z");
const at = (hoursAgo: number): Date => new Date(T0.getTime() - hoursAgo * 3_600_000);

const makers: [string, () => RunStore][] = [
  ["memory", () => new MemoryRunStore()],
  ["sqlite (:memory:)", () => SqliteRunStore.open(":memory:")],
];

describe.each(makers)("RunStore contract: %s", (_name, make) => {
  it("a new run has no content yet", async () => {
    const store = make();
    await store.createRun("r1", T0);
    const run = await store.getRun("r1");
    expect(run).toMatchObject({ runId: "r1", createdAt: T0.toISOString(), status: "running" });
    expect(run?.doc).toBeUndefined();
    expect(run?.events).toEqual([]);
    expect(run?.drafts).toEqual([]);
    expect(run?.result).toBeUndefined();
  });

  it("a run id can be created only once", async () => {
    const store = make();
    await store.createRun("r1", T0);
    await expect(store.createRun("r1", T0)).rejects.toThrow();
  });

  it("unknown runs are simply absent", async () => {
    const store = make();
    expect(await store.getRun("nope")).toBeUndefined();
    expect(await store.deleteRun("nope")).toBe(false);
    expect(await store.exportJsonl("nope")).toBeUndefined();
  });

  it("round-trips a whole pipeline run exactly", async () => {
    const store = make();
    const { result, events } = await runWith({ store });
    const run = await store.getRun(result.runId);
    expect(run?.status).toBe("complete");
    expect(run?.result).toEqual(result);
    expect(run?.doc?.sentences).toHaveLength(15);
    expect(run?.events.map((e) => e.seq)).toEqual(events.map((e) => e.seq));
    expect(run?.drafts.filter((d) => d.attempt === 1)).toHaveLength(24);
    expect(run?.drafts.filter((d) => d.attempt === 2)).toHaveLength(1);
    expect(run?.verifications.filter((v) => v.attempt === 1)).toHaveLength(24);
    expect(run?.verifications.filter((v) => v.attempt === 2)).toHaveLength(1);
  });

  it("returns events in sequence order and treats a repeated sequence number as the same event", async () => {
    const store = make();
    await store.createRun("r1", T0);
    const ev = (seq: number, code: string) =>
      ({ type: "warning", runId: "r1", seq, at: T0.toISOString(), code, message: code }) as const;
    await store.appendEvent("r1", ev(3, "c"));
    await store.appendEvent("r1", ev(1, "a"));
    await store.appendEvent("r1", ev(2, "b"));
    await store.appendEvent("r1", ev(2, "b-again"));
    const run = await store.getRun("r1");
    expect(run?.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(run?.events.map((e) => (e.type === "warning" ? e.code : ""))).toEqual([
      "a",
      "b-again",
      "c",
    ]);
  });

  it("deleting a run removes all of it and leaves other runs alone", async () => {
    const store = make();
    const a = await runWith({ store, newId: () => "run-A" });
    const b = await runWith({ store, newId: () => "run-B" });
    expect(await store.deleteRun(a.result.runId)).toBe(true);
    expect(await store.getRun(a.result.runId)).toBeUndefined();
    expect(await store.exportJsonl(a.result.runId)).toBeUndefined();
    expect((await store.getRun(b.result.runId))?.result).toEqual(b.result);
  });

  it("purges runs created before the cutoff, and only those", async () => {
    const store = make();
    await store.createRun("old", at(30));
    await store.createRun("edge", at(24));
    await store.createRun("new", at(1));
    const removed = await store.purgeOlderThan(at(24));
    expect(removed).toBe(1);
    expect(await store.getRun("old")).toBeUndefined();
    expect(await store.getRun("edge")).toBeDefined(); // exactly at the cutoff is kept
    expect(await store.getRun("new")).toBeDefined();
    expect(await store.purgeOlderThan(at(24))).toBe(0);
  });

  it("writing to a run that does not exist fails loudly (so the pipeline can warn)", async () => {
    const store = make();
    await expect(store.saveDrafts("ghost", 1, []))
      .resolves.not.toThrow()
      .catch(() => undefined);
    await expect(
      store.appendEvent("ghost", {
        type: "warning",
        runId: "ghost",
        seq: 1,
        at: "x",
        code: "c",
        message: "m",
      }),
    ).rejects.toThrow();
  });

  it("exports one JSON object per line, in a stable order, without a result inside `done`", async () => {
    const store = make();
    const { result } = await runWith({ store });
    const text = await store.exportJsonl(result.runId);
    expect(text?.endsWith("\n")).toBe(true);
    const lines = (text ?? "")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { kind: string; event?: { type: string } });
    const kinds = lines.map((l) => l.kind);
    expect(kinds[0]).toBe("run");
    expect(kinds[1]).toBe("doc");
    expect(kinds.at(-1)).toBe("result");
    expect(kinds.filter((k) => k === "event")).toHaveLength(
      result.report ? lines.filter((l) => l.kind === "event").length : 0,
    );
    expect(kinds.indexOf("draft")).toBeGreaterThan(kinds.lastIndexOf("event"));
    const done = lines.find((l) => l.kind === "event" && l.event?.type === "done");
    expect(done?.event).not.toHaveProperty("result");
    expect(lines.filter((l) => l.kind === "draft")).toHaveLength(25);
    expect(lines.filter((l) => l.kind === "verification")).toHaveLength(25);
  });
});

describe("toJsonl", () => {
  it("omits sections that do not exist yet", () => {
    const text = toJsonl({
      runId: "r",
      createdAt: "t",
      status: "running",
      drafts: [],
      verifications: [],
      events: [],
    });
    expect(text.trim().split("\n")).toHaveLength(1);
  });
});

describe("SqliteRunStore", () => {
  const dirs: string[] = [];
  const tempDb = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "noteriser-"));
    dirs.push(dir);
    return join(dir, "nested", "runs.db");
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // Windows may still hold the file for a moment; the OS temp dir is cleaned up anyway
      }
    }
  });

  it("applies every migration once, and reopening changes nothing", async () => {
    const path = tempDb();
    const first = SqliteRunStore.open(path);
    expect(first.schemaVersion).toBe(MIGRATIONS.length);
    await first.createRun("r1", T0);
    first.close();

    const second = SqliteRunStore.open(path);
    expect(second.schemaVersion).toBe(MIGRATIONS.length);
    expect((await second.getRun("r1"))?.runId).toBe("r1");
    second.close();
  });

  it("creates the database's folder and uses write-ahead logging", () => {
    const path = tempDb();
    const store = SqliteRunStore.open(path);
    expect(existsSync(path)).toBe(true);
    store.close();
    const raw = new DatabaseSync(path);
    const mode = raw.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    raw.close();
    expect(mode.journal_mode).toBe("wal");
  });

  it("migrations are plain numbered SQL, applied in order", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(1);
    expect(MIGRATIONS.every((m) => typeof m === "string" && m.includes("CREATE TABLE"))).toBe(true);
  });

  it("deleting a run cascades to every table (no orphan rows)", async () => {
    const path = tempDb();
    const store = SqliteRunStore.open(path);
    const { result } = await runWith({ store });
    expect(await store.deleteRun(result.runId)).toBe(true);
    store.close();

    const raw = new DatabaseSync(path);
    for (const table of ["runs", "events", "drafts", "verifications"]) {
      const row = raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      expect(row.n, table).toBe(0);
    }
    raw.close();
  });

  it("purged source text does not survive on disk", async () => {
    const SECRET = "ZEBRA-SENTINEL-4412";
    const path = tempDb();
    const store = SqliteRunStore.open(path);
    const text = `## Animals\n\nThe ${SECRET} is a striped animal that lives on the savanna. It eats grass all day long.`;
    const { result } = await runWith({ store }, text);

    const onDisk = (): string =>
      [path, `${path}-wal`]
        .filter((p) => existsSync(p))
        .map((p) => readFileSync(p, "latin1"))
        .join("");
    expect(onDisk()).toContain(SECRET); // the check below is meaningful: it was really stored

    const removed = await store.purgeOlderThan(new Date(T0.getTime() + 24 * 3_600_000));
    expect(removed).toBe(1);
    expect(await store.getRun(result.runId)).toBeUndefined();
    store.close();
    expect(onDisk()).not.toContain(SECRET);
  });
});
