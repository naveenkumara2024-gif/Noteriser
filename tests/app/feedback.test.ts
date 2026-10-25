import { describe, expect, it } from "vitest";
import { MAX_NOTE_CHARS, postFeedback } from "@/app/server/feedback";
import { createRun, deleteRun } from "@/app/server/runs";
import type { Runtime } from "@/app/server/runtime";
import { candidatesFromFeedback } from "../../eval/lib/feedback";
import { jsonRequest, LECTURE7, readSse, testRuntime } from "../support/app";

async function runAndWait(rt: Runtime): Promise<void> {
  await readSse(await createRun(jsonRequest({ text: LECTURE7 }), rt));
}

const post = (rt: Runtime, id: string, body: unknown) =>
  postFeedback(
    id,
    new Request(`http://localhost/api/runs/${id}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    rt,
  );

const error = async (res: Response) =>
  ((await res.json()) as { error: { code: string; message: string } }).error;

describe("POST /api/runs/{id}/feedback", () => {
  it("stores feedback on a shown item with the run, and the audit trail includes it", async () => {
    const rt = testRuntime();
    await runAndWait(rt);
    const res = await post(rt, "run-0001", {
      itemId: "sum-1",
      kind: "wrong",
      note: "  The quantum is not 10 ms. ",
    });
    expect(res.status).toBe(204);

    const stored = await rt.store.getRun("run-0001");
    expect(stored?.feedback).toEqual([
      {
        itemId: "sum-1",
        kind: "wrong",
        note: "The quantum is not 10 ms.",
        at: "2026-10-24T12:00:00.000Z",
      },
    ]);
    const jsonl = await rt.store.exportJsonl("run-0001");
    expect(jsonl).toContain('"kind":"feedback"');
  });

  it("accepts all three kinds, and a missing note", async () => {
    const rt = testRuntime();
    await runAndWait(rt);
    for (const kind of ["wrong", "unclear", "missing_context"]) {
      expect((await post(rt, "run-0001", { itemId: "glo-1", kind })).status).toBe(204);
    }
    expect((await rt.store.listFeedback()).map((f) => f.kind)).toEqual([
      "wrong",
      "unclear",
      "missing_context",
    ]);
  });

  it("rejects bad input with a message that says what to send", async () => {
    const rt = testRuntime();
    await runAndWait(rt);
    const cases: [unknown, number][] = [
      [{ itemId: "sum-1", kind: "bad" }, 400],
      [{ kind: "wrong" }, 400],
      [{ itemId: "sum-1", kind: "wrong", note: "x".repeat(MAX_NOTE_CHARS + 1) }, 400],
      [{ itemId: "sum-1", kind: "wrong", extra: true }, 400],
      ["{not json", 400],
    ];
    for (const [body, status] of cases) {
      const res = await post(rt, "run-0001", body);
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(status);
    }
    expect((await error(await post(rt, "run-0001", { itemId: "sum-1" }))).message).toMatch(
      /wrong" \| "unclear" \| "missing_context/,
    );
    expect(await rt.store.listFeedback()).toHaveLength(0);
  });

  it("refuses an item the run did not show (including removed ones), and unknown runs", async () => {
    const rt = testRuntime();
    await runAndWait(rt);
    expect(
      (await error(await post(rt, "run-0001", { itemId: "sum-7", kind: "wrong" }))).message,
    ).toMatch(/not part of this run/);
    expect((await post(rt, "run-0001", { itemId: "nope-1", kind: "wrong" })).status).toBe(400);
    expect((await post(rt, "run-9999", { itemId: "sum-1", kind: "wrong" })).status).toBe(404);
    expect((await post(rt, "../x", { itemId: "sum-1", kind: "wrong" })).status).toBe(404);
  });

  it("rejects a non-JSON content type and an oversize body", async () => {
    const rt = testRuntime();
    await runAndWait(rt);
    const text = await postFeedback(
      "run-0001",
      new Request("http://x/", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "x",
      }),
      rt,
    );
    expect(text.status).toBe(415);
    expect(
      (
        await post(
          rt,
          "run-0001",
          JSON.stringify({ itemId: "sum-1", kind: "wrong", note: "x".repeat(20_000) }),
        )
      ).status,
    ).toBe(413);
  });

  it("disappears with the run", async () => {
    const rt = testRuntime();
    await runAndWait(rt);
    await post(rt, "run-0001", { itemId: "sum-1", kind: "unclear" });
    await deleteRun("run-0001", rt);
    expect(await rt.store.listFeedback()).toEqual([]);
  });
});

describe("feedback -> candidate regression cases (for human review)", () => {
  it("turns marked items into candidate files that are not loaded until a person moves them", async () => {
    const rt = testRuntime();
    await runAndWait(rt);
    await post(rt, "run-0001", { itemId: "sum-1", kind: "wrong", note: "first note" });
    await post(rt, "run-0001", { itemId: "sum-1", kind: "unclear", note: "second note" });
    await post(rt, "run-0001", { itemId: "glo-8", kind: "missing_context" });
    await post(rt, "run-0001", { itemId: "q-1", kind: "wrong" });

    const { candidates, skipped } = await candidatesFromFeedback(
      rt.store,
      await rt.store.listFeedback(),
    );
    expect(candidates.map((c) => c.file).sort()).toEqual([
      "fb-run-0001-glo-8.json",
      "fb-run-0001-sum-1.json",
    ]);

    const sum = candidates.find((c) => c.file.includes("sum-1"))?.case;
    expect(sum?.candidate).toMatchObject({
      kinds: ["wrong", "unclear"],
      notes: ["first note", "second note"],
      status: "needs review",
    });
    // a guess to start from, with no failure type: a person must decide
    expect(sum?.drafts[0]).toMatchObject({ label: "bad", failureType: null });
    expect(sum?.split).toBe("regression");
    expect(sum?.notes).toContain("# Lecture 7: CPU Scheduling Basics");

    // the glossary item was repaired, so the candidate is the wording that was shown
    const glo = candidates.find((c) => c.file.includes("glo-8"))?.case;
    expect(glo?.drafts[0]?.text).toBe(
      "A process being stopped after its time slice and placed at the end of the ready queue.",
    );

    // questions are not supported as cases yet, and that is said
    expect(skipped).toEqual([expect.objectContaining({ itemId: "q-1" })]);
    expect(skipped[0]?.why).toMatch(/Question drafts are not supported/);
  });

  it("says when the run is already gone", async () => {
    const rt = testRuntime();
    await runAndWait(rt);
    await post(rt, "run-0001", { itemId: "sum-1", kind: "wrong" });
    const marks = await rt.store.listFeedback();
    await deleteRun("run-0001", rt);
    const { candidates, skipped } = await candidatesFromFeedback(rt.store, marks);
    expect(candidates).toEqual([]);
    expect(skipped[0]?.why).toMatch(/gone/);
  });
});
