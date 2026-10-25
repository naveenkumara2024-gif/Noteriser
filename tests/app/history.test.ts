import { describe, expect, it } from "vitest";
import { listRuns } from "@/app/server/history";
import { ownedRunIds } from "@/app/server/owner";
import { testRuntime } from "../support/app";
import { runWith } from "../support/pipeline";

const withCookies = (cookie: string): Request =>
  new Request("http://localhost/api/runs", { headers: { cookie } });

describe("ownedRunIds", () => {
  it("reads only well-formed owner cookies", () => {
    const req = withCookies(
      [
        "nb_owner_run-0001=1",
        "other=1",
        "nb_owner_short=1", // too short to be a run id
        "nb_owner_run-0002=0", // not an owner marker
        "nb_owner_../../etc=1", // not an id
        "nb_owner_run-0003=1",
      ].join("; "),
    );
    expect(ownedRunIds(req)).toEqual(["run-0001", "run-0003"]);
  });

  it("is empty with no cookie header", () => {
    expect(ownedRunIds(new Request("http://localhost/api/runs"))).toEqual([]);
  });
});

describe("GET /api/runs", () => {
  it("lists only the runs this browser owns, newest first, as titles and counts", async () => {
    const rt = testRuntime();
    await runWith({
      store: rt.store,
      newId: () => "run-0001",
      clock: () => new Date("2026-10-24T10:00:00Z"),
    });
    await runWith({
      store: rt.store,
      newId: () => "run-0002",
      clock: () => new Date("2026-10-24T11:00:00Z"),
    });
    await runWith({
      store: rt.store,
      newId: () => "run-0003",
      clock: () => new Date("2026-10-24T12:00:00Z"),
    });

    const res = await listRuns(withCookies("nb_owner_run-0001=1; nb_owner_run-0002=1"), rt);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as {
      runs: { runId: string; title: string }[];
      ttlHours: number;
    };
    expect(body.runs.map((r) => r.runId)).toEqual(["run-0002", "run-0001"]);
    expect(body.runs[0]?.title).toBe("Lecture 7: CPU Scheduling Basics");
    expect(body.ttlHours).toBe(24);
  });

  it("skips deleted runs, answers an empty list with no cookies, and leaks no source sentence", async () => {
    const rt = testRuntime();
    const { result } = await runWith({ store: rt.store, newId: () => "run-0001" });
    await runWith({ store: rt.store, newId: () => "run-0002" });
    await rt.store.deleteRun("run-0002");

    const none = await listRuns(new Request("http://localhost/api/runs"), rt);
    expect(((await none.json()) as { runs: unknown[] }).runs).toEqual([]);

    const res = await listRuns(withCookies("nb_owner_run-0001=1; nb_owner_run-0002=1"), rt);
    const text = await res.text();
    expect(JSON.parse(text).runs).toHaveLength(1);
    for (const s of result.doc?.sentences ?? []) expect(text).not.toContain(s.text);
  });
});
