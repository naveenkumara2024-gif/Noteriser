import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { exportRun } from "@/app/server/export";
import { postFeedback } from "@/app/server/feedback";
import { createRun, deleteRun, getRun } from "@/app/server/runs";
import { createLogger, REDACT_FIELDS } from "@/config/logger";
import { startPurgeSchedule } from "@/store/purge";
import { SqliteRunStore } from "@/store/sqlite";
import { jsonRequest, LECTURE7, readSse, testRuntime } from "../support/app";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Everything a SQLite database leaves on disk: the file, its write-ahead log and shared memory. */
function bytesOnDisk(dir: string): string {
  return readdirSync(dir)
    .map((f) => readFileSync(join(dir, f)).toString("latin1"))
    .join("");
}

describe("retention, end to end", () => {
  it("a run that expires is gone everywhere: page data, exports, feedback, and the file on disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nb-privacy-"));
    dirs.push(dir);
    const store = SqliteRunStore.open(join(dir, "runs.db"));
    let now = new Date("2026-10-24T12:00:00Z");
    const rt = testRuntime({ store, clock: () => now });

    await readSse(await createRun(jsonRequest({ text: LECTURE7 }), rt));
    await postFeedback(
      "run-0001",
      new Request("http://x/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: "sum-1", kind: "wrong", note: "a-very-recognisable-note" }),
      }),
      rt,
    );
    expect((await getRun("run-0001", rt)).status).toBe(200);
    // while it exists, the source text is on disk (that is what retention is for)
    expect(bytesOnDisk(dir)).toContain("CPU scheduling is the method an operating system uses");

    // 25 hours later, with a 24-hour retention period
    now = new Date("2026-10-25T13:00:00Z");
    const purge = startPurgeSchedule(store, { ttlHours: 24, clock: () => now });
    // starting the schedule already sweeps once; a second sweep finds nothing left to remove
    await purge.runNow();
    purge.stop();

    expect((await getRun("run-0001", rt)).status).toBe(404);
    for (const format of ["md", "txt", "tsv", "json"]) {
      const res = await exportRun(
        "run-0001",
        new Request(`http://x/?format=${format}`, { headers: { cookie: "nb_owner_run-0001=1" } }),
        rt,
      );
      expect(res.status, format).toBe(404);
    }
    expect(await store.listFeedback()).toEqual([]);

    store.close();
    const left = bytesOnDisk(dir);
    expect(left).not.toContain("CPU scheduling is the method");
    expect(left).not.toContain("a-very-recognisable-note");
  });

  it("Delete this run removes the rows and every export of it", async () => {
    const rt = testRuntime();
    await readSse(await createRun(jsonRequest({ text: LECTURE7 }), rt));
    expect(await rt.store.exportJsonl("run-0001")).toBeDefined();
    expect((await deleteRun("run-0001", rt)).status).toBe(204);
    expect(await rt.store.getRun("run-0001")).toBeUndefined();
    expect(await rt.store.exportJsonl("run-0001")).toBeUndefined();
    for (const format of ["md", "txt", "tsv"]) {
      expect(
        (await exportRun("run-0001", new Request(`http://x/?format=${format}`), rt)).status,
      ).toBe(404);
    }
  });
});

describe("logs never carry source text, claims or notes", () => {
  const SECRET = "SECRET-SOURCE-SENTENCE-9f3a";

  it("every field that can hold source, a claim, a quote or a note is redacted, at top level and one level down", () => {
    for (const field of [
      "doc",
      "sentences",
      "source",
      "text",
      "claim",
      "evidenceQuote",
      "answer",
      "question",
      "term",
      "prompt",
      "note",
      "apiKey",
      "authorization",
    ]) {
      expect(REDACT_FIELDS, field).toContain(field);
    }
    const lines: string[] = [];
    const log = pino(
      { redact: { paths: createLoggerPaths(), censor: "[redacted]" } },
      { write: (s: string) => void lines.push(s) },
    );
    log.info({ text: SECRET, note: SECRET, claim: SECRET, runId: "r1" }, "top");
    log.info({ result: { text: SECRET, evidenceQuote: SECRET, note: SECRET } }, "nested");
    const out = lines.join("");
    expect(out).not.toContain(SECRET);
    expect(out).toContain('"runId":"r1"');
  });

  it("the real logger factory redacts the same way", () => {
    const lines: string[] = [];
    const log = createLogger({
      stream: { write: (s: string) => void lines.push(s) },
      level: "info",
    });
    log.info({ source: SECRET, note: SECRET }, "x");
    expect(lines.join("")).not.toContain(SECRET);
  });

  it("a whole run through the server handlers logs only ids and sizes", async () => {
    const lines: string[] = [];
    const log = createLogger({
      stream: { write: (s: string) => void lines.push(s) },
      level: "info",
    });
    const rt = testRuntime({ log });
    await readSse(await createRun(jsonRequest({ text: LECTURE7 }), rt));
    await postFeedback(
      "run-0001",
      new Request("http://x/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: "sum-1", kind: "wrong", note: SECRET }),
      }),
      rt,
    );
    const out = lines.join("");
    expect(out).toContain("run started");
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain("CPU scheduling");
  });
});

function createLoggerPaths(): string[] {
  return REDACT_FIELDS.flatMap((f) => [f, `*.${f}`]);
}
