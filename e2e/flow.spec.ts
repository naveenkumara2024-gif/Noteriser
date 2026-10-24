import { expect, test } from "@playwright/test";
import { runSample, SAMPLE_TITLE } from "./helpers";

const TRUST = "Generated from instructor-approved notes. Check flagged items against the source.";

test.describe("home", () => {
  test("shows the persistent trust notice and the demo-mode notice", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("note").filter({ hasText: TRUST })).toBeVisible();
    await expect(page.getByText(/Demo mode/)).toBeVisible();
  });

  test("asks for input instead of starting an empty run", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Make study aids" }).click();
    await expect(page.getByRole("alert")).toContainText("Paste your notes");
    await expect(page).toHaveURL("/");
  });

  test("refuses an unsupported file type before uploading", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Or upload a file").setInputFiles({
      name: "notes.exe",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("x"),
    });
    await expect(page.getByRole("alert")).toContainText("not supported");
  });

  test("runs an uploaded file", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Or upload a file").setInputFiles("fixtures/lecture7.md");
    await page.getByRole("button", { name: "Make study aids" }).click();
    await page.waitForURL(/\/runs\//);
    await expect(page.getByRole("heading", { level: 1, name: SAMPLE_TITLE })).toBeVisible();
  });

  test("shows the message when the run cannot read the document", async ({ page }) => {
    await page.goto("/");
    // A broken PDF passes the browser's checks and fails inside the run.
    await page.getByLabel("Or upload a file").setInputFiles({
      name: "broken.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("not a pdf"),
    });
    await page.getByRole("button", { name: "Make study aids" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL("/");
  });
});

test.describe("progress", () => {
  test("shows the step, the stage list and a cancel button, and cancelling stops the run", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Use sample lecture" }).click();
    await page.getByRole("button", { name: "Make study aids" }).click();

    await expect(page.getByRole("heading", { name: "Working on your notes" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /^Step \d of 5:/ })).toBeVisible();
    await expect(page.getByRole("list").filter({ hasText: "Reading your notes" })).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("The run was cancelled")).toBeVisible();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("button", { name: "Make study aids" })).toBeEnabled();
  });
});

test.describe("results", () => {
  test("shows summary, glossary and exactly five questions with statuses in words", async ({
    page,
  }) => {
    await runSample(page);
    for (const name of ["Summary", "Glossary", "Practice questions"]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    const questions = page
      .getByRole("region", { name: "Practice questions" })
      .getByRole("listitem");
    await expect(questions.filter({ hasText: "Reveal answer" })).toHaveCount(5);
    await expect(page.getByText("Supported", { exact: true }).first()).toBeVisible();
  });

  test("flags the partial item with words, the reason and an icon, not colour alone", async ({
    page,
  }) => {
    await runSample(page);
    const flagged = page.getByText("Check against source (partial)");
    await expect(flagged).toHaveCount(1);
    await expect(page.getByText("Check against source:")).toBeVisible();
    // the glyph is present but hidden from assistive technology
    await expect(flagged.locator("xpath=..").locator('[aria-hidden="true"]').first()).toHaveText(
      "⚠",
    );
  });

  test("lists every removed draft in a collapsed panel with the failing check", async ({
    page,
  }) => {
    await runSample(page);
    const summary = page.getByText("Removed items (5)");
    await expect(summary).toBeVisible();
    const ids = ["sum-7", "sum-8", "q-4", "q-6", "q-8"];
    for (const id of ids) await expect(page.getByText(id, { exact: true })).toBeHidden();

    await summary.click();
    for (const id of ids) await expect(page.getByText(id, { exact: true })).toBeVisible();
    await expect(page.getByText("Contradicted by the notes").first()).toBeVisible();
    await expect(page.getByText("Checks that failed").first()).toBeVisible();
  });

  test("the run report reconciles", async ({ page }) => {
    await runSample(page);
    const report = page.getByRole("region", { name: "Run report" });
    await expect(report).toContainText("Counts reconcile");
    await expect(report).toContainText("Summary coverage");
  });

  test("choosing a citation highlights that sentence in the Source column", async ({ page }) => {
    await runSample(page);
    const chip = page
      .getByRole("region", { name: "Summary" })
      .getByRole("button", { name: /^Source sentence S/ })
      .first();
    const id = (await chip.textContent())?.trim() ?? "";
    expect(id).toMatch(/^S\d+\.\d+$/);

    await chip.click();
    const line = page.locator(`#src-${id}`);
    await expect(line).toHaveAttribute("aria-current", "true");
    await expect(line).toContainText("(Cited)");
    await expect(line).toBeInViewport();
    await expect(page.locator('[aria-current="true"]')).toHaveCount(1);

    await chip.click(); // pressing again clears it
    await expect(page.locator('[aria-current="true"]')).toHaveCount(0);
  });

  test("Show source highlights all of an item's sentences", async ({ page }) => {
    await runSample(page);
    const item = page.getByRole("region", { name: "Summary" }).getByRole("listitem").first();
    const ids = await item.getByRole("button", { name: /^Source sentence S/ }).allTextContents();
    await item.getByRole("button", { name: "Show source" }).click();
    await expect(page.locator('[aria-current="true"]')).toHaveCount(ids.length);
  });

  test("reveals a question's answer and its citations only on request", async ({ page }) => {
    await runSample(page);
    const q = page
      .getByRole("region", { name: "Practice questions" })
      .getByRole("listitem")
      .first();
    await expect(q.getByText("Answer:")).toHaveCount(0);
    await q.getByRole("button", { name: "Reveal answer" }).click();
    await expect(q.getByText("Answer:")).toBeVisible();
    await expect(q.getByRole("button", { name: "Hide answer" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  test("deleting the run removes it: reload is a 404 and the API agrees", async ({
    page,
    request,
  }) => {
    const path = await runSample(page);
    const id = path.split("/").pop();

    await page.getByRole("button", { name: "Delete this run" }).click();
    await expect(page.getByText("Delete this run and its source text permanently?")).toBeVisible();
    await page.getByRole("button", { name: "Yes, delete" }).click();
    await page.waitForURL(/\/\?deleted=1$/);
    await expect(page.getByText("The run was deleted")).toBeVisible();

    const reload = await page.goto(path);
    expect(reload?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "That page does not exist" })).toBeVisible();
    expect((await request.get(`/api/runs/${id}`)).status()).toBe(404);
  });

  test("keeping the run after the delete prompt leaves it in place", async ({ page }) => {
    await runSample(page);
    await page.getByRole("button", { name: "Delete this run" }).click();
    await page.getByRole("button", { name: "Keep it" }).click();
    await expect(page.getByRole("button", { name: "Delete this run" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: SAMPLE_TITLE })).toBeVisible();
  });
});

test.describe("narrow screens", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("have no Source column; each item opens its sentences underneath", async ({ page }) => {
    await runSample(page);
    await expect(page.getByRole("heading", { name: "Source", exact: true })).toBeHidden();

    const item = page.getByRole("region", { name: "Summary" }).getByRole("listitem").first();
    await item.getByText("Show source").click();
    await expect(item.locator('[aria-current="true"]').first()).toBeVisible();
    await expect(item.getByText("(Cited)").first()).toBeVisible();
  });
});

test.describe("api", () => {
  test("rejects bad input with JSON errors", async ({ request }) => {
    const bad = await request.post("/api/runs", { data: { text: "" } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error.code).toBe("empty");

    const type = await request.post("/api/runs", {
      headers: { "content-type": "text/plain" },
      data: "hello",
    });
    expect(type.status()).toBe(415);

    expect((await request.get("/api/runs/does-not-exist")).status()).toBe(404);
  });

  test("streams events and the stored run is then available", async ({ request }) => {
    const res = await request.post("/api/runs", {
      data: { text: "# Tiny\n\n## One\n\nA cat is an animal. A dog is an animal. A bird can fly." },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain("event: stage");
    expect(body).toContain("event: done");
    const id = res.headers()["x-run-id"];
    expect((await request.get(`/api/runs/${id}`)).status()).toBe(200);
  });
});
