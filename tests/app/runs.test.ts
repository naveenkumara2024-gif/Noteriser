import { describe, expect, it } from "vitest";
import { LIMITS } from "@/app/limits";
import { createRateLimiter } from "@/app/server/rate-limit";
import { createRun, deleteRun, getRun } from "@/app/server/runs";
import { TOOL_NAMES } from "@/core/generate";
import type { RunEvent, RunResult } from "@/core/pipeline";
import { lecture7Llm } from "@/demo";
import { fileRequest, jsonRequest, LECTURE7, readSse, testRuntime } from "../support/app";

const events = async (res: Response): Promise<RunEvent[]> =>
  (await readSse(res)).map((m) => JSON.parse(m.data) as RunEvent);

async function errorOf(res: Response): Promise<{ status: number; code: string; message: string }> {
  const body = (await res.json()) as { error: { code: string; message: string } };
  return { status: res.status, ...body.error };
}

describe("POST /api/runs: input validation", () => {
  it("rejects a body that is not JSON", async () => {
    const res = await createRun(jsonRequest("{not json"), testRuntime());
    expect(await errorOf(res)).toMatchObject({ status: 400, code: "invalid_request" });
  });

  it("rejects the wrong shape and unknown properties", async () => {
    for (const body of [
      {},
      { text: 5 },
      { text: "x", extra: true },
      { text: "x", options: { format: "html" } },
    ]) {
      const res = await createRun(jsonRequest(body), testRuntime());
      expect(await errorOf(res)).toMatchObject({ status: 400, code: "invalid_request" });
    }
  });

  it("rejects empty and whitespace-only text with a message that says what to do", async () => {
    const res = await createRun(jsonRequest({ text: "  \n " }), testRuntime());
    const e = await errorOf(res);
    expect(e).toMatchObject({ status: 400, code: "empty" });
    expect(e.message).toMatch(/paste your notes/i);
  });

  it("rejects text over the limit (counted in bytes, not characters) with 413", async () => {
    const fits = "é".repeat(LIMITS.textBytes / 2);
    const tooBig = `${fits}é`;
    expect(
      await errorOf(await createRun(jsonRequest({ text: tooBig }), testRuntime())),
    ).toMatchObject({
      status: 413,
      code: "too_large",
    });
    // exactly at the limit is accepted
    const ok = await createRun(jsonRequest({ text: fits }), testRuntime());
    expect(ok.status).toBe(200);
    await ok.body?.cancel();
  });

  it("rejects an unsupported content type with 415", async () => {
    const req = new Request("http://localhost/api/runs", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "hello",
    });
    expect(await errorOf(await createRun(req, testRuntime()))).toMatchObject({
      status: 415,
      code: "unsupported_type",
    });
  });

  it("accepts a .md upload and refuses other file types, naming the allowed ones", async () => {
    const good = await createRun(fileRequest("notes.md", LECTURE7), testRuntime());
    expect(good.status).toBe(200);
    await good.body?.cancel();

    const bad = await errorOf(await createRun(fileRequest("notes.exe", "x"), testRuntime()));
    expect(bad).toMatchObject({ status: 415, code: "unsupported_type" });
    expect(bad.message).toContain(".docx");
    expect((await errorOf(await createRun(fileRequest("README", "x"), testRuntime()))).status).toBe(
      415,
    );
  });

  it("rejects an empty file, a missing file field, and a file over the limit", async () => {
    expect(await errorOf(await createRun(fileRequest("a.txt", ""), testRuntime()))).toMatchObject({
      status: 400,
      code: "empty",
    });

    const form = new FormData();
    form.set("note", "nope");
    const missing = new Request("http://localhost/api/runs", { method: "POST", body: form });
    expect(await errorOf(await createRun(missing, testRuntime()))).toMatchObject({
      status: 400,
      code: "invalid_request",
    });

    const big = new Uint8Array(LIMITS.fileBytes + 1);
    expect(
      await errorOf(await createRun(fileRequest("big.txt", big), testRuntime())),
    ).toMatchObject({
      status: 413,
      code: "too_large",
    });
  });
});

describe("POST /api/runs: the event stream", () => {
  it("streams events in order with increasing sequence numbers, ending with done", async () => {
    const rt = testRuntime();
    const res = await createRun(jsonRequest({ text: LECTURE7 }), rt);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-run-id")).toBe("run-0001");

    const wire = await readSse(res);
    const all = wire.map((m) => JSON.parse(m.data) as RunEvent);
    expect(wire.map((m) => m.event)).toEqual(all.map((e) => e.type));
    expect(all.map((e) => e.seq)).toEqual(all.map((_, i) => i + 1));
    expect(new Set(all.map((e) => e.runId))).toEqual(new Set(["run-0001"]));

    const stages = all
      .filter((e) => e.type === "stage" && e.status === "start")
      .map((e) => e.type === "stage" && e.stage);
    expect(stages).toEqual(["parse", "generate", "verify", "repair", "assemble"]);
    expect(all.at(-1)?.type).toBe("done");
    expect(all.filter((e) => e.type === "done")).toHaveLength(1);
  });

  it("has stored the run by the time the stream ends", async () => {
    const rt = testRuntime();
    const res = await createRun(jsonRequest({ text: LECTURE7 }), rt);
    await readSse(res);

    const got = await getRun("run-0001", rt);
    expect(got.status).toBe(200);
    const body = (await got.json()) as { status: string; result: RunResult };
    expect(body.status).toBe("complete");
    expect(body.result.report.reconciles).toBe(true);
    expect(body.result.questions).toHaveLength(5);
  });

  it("reports an unreadable document as an error event, not a 4xx", async () => {
    // Parsing happens inside the run, so the response is a stream that ends with an error.
    const res = await createRun(fileRequest("broken.pdf", "this is not a pdf"), testRuntime());
    expect(res.status).toBe(200);
    const error = (await events(res)).find((e) => e.type === "error");
    expect(error).toMatchObject({ code: "parse_failed" });
  });

  it("does not put the source text in logs", async () => {
    const lines: string[] = [];
    const { default: pino } = await import("pino");
    const rt = testRuntime({
      log: pino({ level: "info" }, { write: (s: string) => void lines.push(s) }),
    });
    await readSse(await createRun(jsonRequest({ text: LECTURE7 }), rt));
    const logged = lines.join("");
    expect(logged).toContain("run started");
    expect(logged).not.toContain("CPU scheduling");
  });
});

describe("POST /api/runs: plain-language option", () => {
  const stageOf = (e: RunEvent) => (e.type === "stage" ? `${e.stage}:${e.status}` : null);

  it("is off by default: no plain stage, no plain summary", async () => {
    const all = await events(await createRun(jsonRequest({ text: LECTURE7 }), testRuntime()));
    expect(all.map(stageOf)).not.toContain("plain:start");
    const done = all.find((e) => e.type === "done");
    expect(done?.type === "done" && done.result.plain).toBeUndefined();
  });

  it("is switched on by options.plain in JSON, and the stream carries the plain stage and result", async () => {
    const all = await events(
      await createRun(jsonRequest({ text: LECTURE7, options: { plain: true } }), testRuntime()),
    );
    expect(all.map(stageOf)).toContain("plain:start");
    expect(all.filter((e) => e.type === "plain").length).toBe(19);
    const done = all.find((e) => e.type === "done");
    expect(done?.type === "done" && done.result.plain?.attempted).toBe(19);
  });

  it("is switched on by a plain=true field in an upload", async () => {
    const form = new FormData();
    form.set("file", new File([LECTURE7], "notes.md", { type: "text/markdown" }));
    form.set("plain", "true");
    const req = new Request("http://localhost/api/runs", { method: "POST", body: form });
    const all = await events(await createRun(req, testRuntime()));
    expect(all.map(stageOf)).toContain("plain:start");
  });

  it("is stored with the run, so a reload still shows plain-language versions", async () => {
    const rt = testRuntime();
    await readSse(await createRun(jsonRequest({ text: LECTURE7, options: { plain: true } }), rt));
    const body = (await (await getRun("run-0001", rt)).json()) as { result: RunResult };
    expect(body.result.plain?.simplified).toBe(11);
    expect(body.result.summary.some((s) => s.plain?.status === "simplified")).toBe(true);
  });

  it("rejects a non-boolean value", async () => {
    const res = await createRun(
      jsonRequest({ text: LECTURE7, options: { plain: "yes" } }),
      testRuntime(),
    );
    expect(await errorOf(res)).toMatchObject({ status: 400, code: "invalid_request" });
  });
});

describe("POST /api/runs: rate limit", () => {
  it("returns 429 with Retry-After once the window is used up, per client", async () => {
    let now = 0;
    const rt = testRuntime({
      limiter: createRateLimiter({ max: 2, windowMs: 600_000, now: () => now }),
    });
    const send = (ip: string) =>
      createRun(jsonRequest({ text: LECTURE7 }, { headers: { "x-forwarded-for": ip } }), rt);

    for (const ip of ["1.1.1.1", "1.1.1.1"]) await readSse(await send(ip));
    const blocked = await send("1.1.1.1");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBe(600);
    expect((await errorOf(blocked)).code).toBe("rate_limited");

    await readSse(await send("2.2.2.2")); // another client is unaffected

    now = 601_000;
    await readSse(await send("1.1.1.1")); // the window has passed
  });

  it("does not count requests that were refused for bad input", async () => {
    const rt = testRuntime({ limiter: createRateLimiter({ max: 1, windowMs: 600_000 }) });
    for (let i = 0; i < 3; i++)
      expect((await createRun(jsonRequest({ text: "" }), rt)).status).toBe(400);
    const ok = await createRun(jsonRequest({ text: LECTURE7 }), rt);
    expect(ok.status).toBe(200);
    await readSse(ok);
  });
});

describe("POST /api/runs: client disconnect", () => {
  /** A summary call that never answers on its own: it only returns when the run is aborted. */
  function hangingLlm() {
    let started!: () => void;
    const reached = new Promise<void>((resolve) => {
      started = resolve;
    });
    const llm = lecture7Llm({
      [TOOL_NAMES.summary]: async (req) => {
        started();
        await new Promise<void>((resolve) =>
          req.signal?.addEventListener("abort", () => resolve(), { once: true }),
        );
        return { points: [], insufficient_reason: "aborted" };
      },
    });
    return { llm, reached };
  }

  it("aborts the pipeline when the request is aborted, and stores what finished as incomplete", async () => {
    const rt = testRuntime();
    const { llm, reached } = hangingLlm();
    rt.deps = { ...rt.deps, llm };
    const controller = new AbortController();
    const res = await createRun(jsonRequest({ text: LECTURE7 }, { signal: controller.signal }), rt);

    const pending = readSse(res);
    await reached;
    controller.abort();
    const wire = await pending;
    const all = wire.map((m) => JSON.parse(m.data) as RunEvent);

    expect(all.find((e) => e.type === "error")).toMatchObject({ code: "aborted" });
    const stored = await rt.store.getRun("run-0001");
    expect(stored?.status).toBe("incomplete");
  });

  it("aborts the pipeline when the reader cancels the stream", async () => {
    const rt = testRuntime();
    const { llm, reached } = hangingLlm();
    rt.deps = { ...rt.deps, llm };
    const res = await createRun(jsonRequest({ text: LECTURE7 }), rt);

    const reader = res.body?.getReader();
    await reached;
    await reader?.cancel();
    // the run notices the abort and records itself as incomplete
    for (let i = 0; i < 200; i++) {
      if ((await rt.store.getRun("run-0001"))?.status === "incomplete") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect((await rt.store.getRun("run-0001"))?.status).toBe("incomplete");
  });
});

describe("GET and DELETE /api/runs/{id}", () => {
  it("returns 404 for unknown and malformed ids", async () => {
    const rt = testRuntime();
    for (const id of ["run-9999", "x", "../../etc/passwd", "a b"]) {
      expect((await getRun(id, rt)).status).toBe(404);
      expect((await deleteRun(id, rt)).status).toBe(404);
    }
  });

  it("deletes everything for a run, after which GET is 404", async () => {
    const rt = testRuntime();
    await readSse(await createRun(jsonRequest({ text: LECTURE7 }), rt));
    expect((await getRun("run-0001", rt)).status).toBe(200);

    const del = await deleteRun("run-0001", rt);
    expect(del.status).toBe(204);
    expect((await getRun("run-0001", rt)).status).toBe(404);
    expect(await rt.store.exportJsonl("run-0001")).toBeUndefined();
    expect((await deleteRun("run-0001", rt)).status).toBe(404);
  });
});
