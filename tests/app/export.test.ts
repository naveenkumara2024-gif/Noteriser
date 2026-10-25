import { describe, expect, it } from "vitest";
import { exportFilename, exportRun } from "@/app/server/export";
import { isOwner, ownerCookie } from "@/app/server/owner";
import { createRun, deleteRun } from "@/app/server/runs";
import type { Runtime } from "@/app/server/runtime";
import { jsonRequest, LECTURE7, readSse, testRuntime } from "../support/app";

/** Runs the fixture and returns the owner cookie the response set, as a browser would send it back. */
async function makeRun(rt: Runtime, plain = false): Promise<string> {
  const res = await createRun(jsonRequest({ text: LECTURE7, options: { plain } }), rt);
  const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
  await readSse(res);
  return cookie;
}

const get = (id: string, query: string, rt: Runtime, cookie?: string) =>
  exportRun(
    id,
    new Request(`http://localhost/api/runs/${id}/export?${query}`, {
      headers: cookie ? { cookie } : {},
    }),
    rt,
  );

describe("GET /api/runs/{id}/export", () => {
  it("serves each format with the right type, an attachment filename and no caching", async () => {
    const rt = testRuntime();
    const cookie = await makeRun(rt);
    const expected = {
      md: "text/markdown; charset=utf-8",
      txt: "text/plain; charset=utf-8",
      tsv: "text/tab-separated-values; charset=utf-8",
      json: "application/json; charset=utf-8",
    };
    for (const [format, type] of Object.entries(expected)) {
      const res = await get("run-0001", `format=${format}`, rt, cookie);
      expect(res.status, format).toBe(200);
      expect(res.headers.get("content-type")).toBe(type);
      expect(res.headers.get("content-disposition")).toBe(
        `attachment; filename="notebridge-2026-10-24-run0001.${format}"`,
      );
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  it("builds each format from the stored result without calling a model", async () => {
    const rt = testRuntime();
    const cookie = await makeRun(rt);
    let calls = 0;
    const real = rt.deps.llm.generateStructured.bind(rt.deps.llm);
    rt.deps = {
      ...rt.deps,
      llm: {
        generateStructured: (req) => {
          calls++;
          return real(req);
        },
      },
    };
    for (const f of ["md", "txt", "tsv", "json"]) {
      await (await get("run-0001", `format=${f}`, rt, cookie)).text();
    }
    expect(calls).toBe(0);
  });

  it("markdown: title, notice and a removed-items appendix", async () => {
    const rt = testRuntime();
    await makeRun(rt);
    const md = await (await get("run-0001", "format=md", rt)).text();
    expect(md.startsWith("# Lecture 7: CPU Scheduling Basics")).toBe(true);
    expect(md).toContain("Check flagged items against the source.");
    expect(md).toContain("## Appendix A: Removed items");
    expect(md).toContain("_Generated 2026-10-24._");
  });

  it("tsv: flagged items only when asked", async () => {
    const rt = testRuntime();
    await makeRun(rt);
    const without = await (await get("run-0001", "format=tsv", rt)).text();
    const withFlagged = await (await get("run-0001", "format=tsv&flagged=1", rt)).text();
    expect(without).not.toContain("Preemption");
    expect(withFlagged).toContain("Preemption");
    expect(withFlagged).toContain("check-against-source");
  });

  it("wording=plain exports the verified plain-language wording", async () => {
    const rt = testRuntime();
    await makeRun(rt, true);
    const original = await (await get("run-0001", "format=md", rt)).text();
    const plain = await (await get("run-0001", "format=md&wording=plain", rt)).text();
    expect(original).not.toContain("It keeps the CPU busy.");
    expect(plain).toContain("It keeps the CPU busy.");
  });

  it("rejects a missing or unknown format with 400, and unknown or malformed ids with 404", async () => {
    const rt = testRuntime();
    await makeRun(rt);
    expect((await get("run-0001", "", rt)).status).toBe(400);
    expect((await get("run-0001", "format=pdf", rt)).status).toBe(400);
    expect((await get("run-9999", "format=md", rt)).status).toBe(404);
    expect((await get("../etc", "format=md", rt)).status).toBe(404);
  });

  it("is 404 once the run is deleted (as it is after the retention period)", async () => {
    const rt = testRuntime();
    await makeRun(rt);
    expect((await get("run-0001", "format=md", rt)).status).toBe(200);
    await deleteRun("run-0001", rt);
    for (const f of ["md", "txt", "tsv", "json"]) {
      expect((await get("run-0001", `format=${f}`, rt)).status, f).toBe(404);
    }
  });

  it("is 409 for a run that has not finished", async () => {
    const rt = testRuntime();
    await rt.store.createRun("run-0042", new Date("2026-10-24T12:00:00Z"));
    expect((await get("run-0042", "format=md", rt)).status).toBe(409);
  });
});

describe("the audit file belongs to the browser that made the run", () => {
  it("is refused without the owner cookie, and for another run's cookie", async () => {
    const rt = testRuntime();
    const cookie = await makeRun(rt);
    await makeRun(rt);
    const noCookie = await get("run-0001", "format=json", rt);
    expect(noCookie.status).toBe(403);
    expect(((await noCookie.json()) as { error: { code: string } }).error.code).toBe("forbidden");
    // the cookie for run 1 does not open run 2
    expect((await get("run-0002", "format=json", rt, cookie)).status).toBe(403);
    expect((await get("run-0001", "format=json", rt, cookie)).status).toBe(200);
  });

  it("does not hold back the study-aid formats, which anyone with the link may download", async () => {
    const rt = testRuntime();
    await makeRun(rt);
    for (const f of ["md", "txt", "tsv"])
      expect((await get("run-0001", `format=${f}`, rt)).status).toBe(200);
  });

  it("sets the cookie HttpOnly, same-site strict, for the retention period", async () => {
    const rt = testRuntime();
    const res = await createRun(jsonRequest({ text: LECTURE7 }), rt);
    await readSse(res);
    const header = res.headers.get("set-cookie") ?? "";
    expect(header).toContain("nb_owner_run-0001=1");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain(`Max-Age=${24 * 3600}`);
    expect(header).not.toContain("Secure"); // plain-http test URL
  });

  it("owner cookies are per run and the secure flag follows https", () => {
    expect(ownerCookie("abc12345", 1, true)).toContain("Secure");
    const req = (cookie: string) => new Request("http://x/", { headers: { cookie } });
    expect(isOwner(req("a=1; nb_owner_abc12345=1; b=2"), "abc12345")).toBe(true);
    expect(isOwner(req("nb_owner_abc12345=0"), "abc12345")).toBe(false);
    expect(isOwner(req("nb_owner_other=1"), "abc12345")).toBe(false);
    expect(isOwner(new Request("http://x/"), "abc12345")).toBe(false);
  });
});

describe("exportFilename", () => {
  it("is notebridge-<date>-<first 8 characters of the id>.<ext>", () => {
    expect(
      exportFilename("2026-10-24T12:00:00.000Z", "fefcec0a-0611-4513-86c5-394727b487f0", "md"),
    ).toBe("notebridge-2026-10-24-fefcec0a.md");
  });

  it("keeps nothing from the id that could break a header or a path", () => {
    const name = exportFilename("2026-10-24", 'a/../b"\r\nSet-Cookie: x', "txt");
    expect(name).toMatch(/^notebridge-2026-10-24-[A-Za-z0-9]{1,8}\.txt$/);
    expect(name).not.toMatch(/[\r\n"/\\]/);
    expect(exportFilename("garbage", "!!!", "md")).toBe("notebridge-undated-run.md");
  });
});
