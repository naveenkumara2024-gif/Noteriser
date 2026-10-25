import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { expectNoSeriousViolations, openSettings, runSample, SAMPLE_TITLE } from "./helpers";

const FILENAME = /^notebridge-\d{4}-\d{2}-\d{2}-[a-z0-9]{8}\.(md|txt|tsv|json)$/;

const openExport = async (page: Page) => {
  const summary = page.locator("summary", { hasText: "Export and print" });
  const open = await summary.evaluate((el) => (el.parentElement as HTMLDetailsElement).open);
  if (!open) await summary.click();
};

/** Clicks a download link and returns the file name and text. */
async function download(page: Page, name: string): Promise<{ filename: string; text: string }> {
  const [d] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name }).click(),
  ]);
  const path = await d.path();
  return { filename: d.suggestedFilename(), text: readFileSync(path, "utf8") };
}

test.describe("export menu", () => {
  test("offers the four formats and print, closed until opened", async ({ page }) => {
    await runSample(page);
    await expect(page.getByRole("link", { name: /Markdown/ })).toBeHidden();
    await openExport(page);
    for (const name of [/^Markdown/, /^Plain text/, /^Anki flashcards/, /^Audit file/]) {
      await expect(page.getByRole("link", { name })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Print / Save as PDF" })).toBeVisible();
    await expect(page.getByText("Contains the full source text")).toBeVisible();
  });

  test("Markdown downloads with a sanitised, dated name and the full content", async ({ page }) => {
    await runSample(page);
    await openExport(page);
    const { filename, text } = await download(page, "Markdown (.md)");
    expect(filename).toMatch(FILENAME);
    expect(filename.endsWith(".md")).toBe(true);
    expect(text.startsWith(`# ${SAMPLE_TITLE}`)).toBe(true);
    expect(text).toContain("Check flagged items against the source.");
    expect(text).toContain("⚠ Check against source — ");
    expect(text).toContain("## Appendix A: Removed items");
    expect(text).toContain("- S3.5 — Round Robin (RR) gives each process a fixed time slice");
  });

  test("plain text downloads with WARNING lines and no markup", async ({ page }) => {
    await runSample(page);
    await openExport(page);
    const { filename, text } = await download(page, "Plain text (.txt)");
    expect(filename).toMatch(FILENAME);
    expect(text).toContain("WARNING: Check against source - ");
    expect(text).not.toMatch(/\*\*|\[S\d/);
  });

  test("Anki flashcards leave out flagged items unless the box is ticked", async ({ page }) => {
    await runSample(page);
    await openExport(page);
    const plain = await download(page, "Anki flashcards (.tsv)");
    expect(plain.filename.endsWith(".tsv")).toBe(true);
    expect(plain.text.startsWith("#separator:tab")).toBe(true);
    expect(plain.text).not.toContain("Preemption");

    await page.getByLabel("Include flagged items in the flashcards").check();
    const withFlagged = await download(page, "Anki flashcards (.tsv)");
    expect(withFlagged.text).toContain("Preemption");
    expect(withFlagged.text).toContain("check-against-source");
  });

  test("the audit file downloads for the browser that made the run", async ({ page }) => {
    await runSample(page);
    await openExport(page);
    const { filename, text } = await download(page, "Audit file (.json)");
    expect(filename.endsWith(".json")).toBe(true);
    const audit = JSON.parse(text);
    expect(audit.contains_source_text).toBe(true);
    expect(audit.removed).toHaveLength(5);
    expect(audit.verifications.length).toBeGreaterThan(20);
  });

  test("the audit file is refused to anyone else, though the study aids are not", async ({
    page,
    request,
  }) => {
    const path = await runSample(page);
    const id = path.split("/").pop();
    // `request` is a different client with no cookie: it is not the owner
    const audit = await request.get(`/api/runs/${id}/export?format=json`);
    expect(audit.status()).toBe(403);
    expect((await audit.json()).error.code).toBe("forbidden");
    expect((await request.get(`/api/runs/${id}/export?format=md`)).status()).toBe(200);
  });

  test("plain-language wording is offered only for a run that has it", async ({ page }) => {
    await runSample(page);
    await openExport(page);
    await expect(page.getByLabel("Use the plain-language wording")).toHaveCount(0);

    await runSample(page, { plain: true });
    await openExport(page);
    await page.getByLabel("Use the plain-language wording").check();
    const { text } = await download(page, "Markdown (.md)");
    expect(text).toContain("Plain-language wording: each rewrite was checked against the source");
    expect(text).toContain("It keeps the CPU busy.");
  });

  test("an export of a deleted run is a 404", async ({ page, request }) => {
    const path = await runSample(page);
    const id = path.split("/").pop();
    await page.getByRole("button", { name: "Delete this run" }).click();
    await page.getByRole("button", { name: "Yes, delete" }).click();
    await page.waitForURL(/deleted=1/);
    expect((await request.get(`/api/runs/${id}/export?format=md`)).status()).toBe(404);
  });

  test("axe: zero serious or critical with the menu open", async ({ page }) => {
    await runSample(page, { plain: true });
    await openExport(page);
    await expectNoSeriousViolations(page, "export menu open");
  });

  test("the menu works from the keyboard", async ({ page }) => {
    await runSample(page);
    await page.locator("summary", { hasText: "Export and print" }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab"); // the flashcards checkbox
    await page.keyboard.press("Space");
    await expect(page.getByLabel("Include flagged items in the flashcards")).toBeChecked();
    await page.keyboard.press("Tab"); // Markdown link
    const [d] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
    expect(d.suggestedFilename()).toMatch(FILENAME);
  });
});

test.describe("print", () => {
  test("print view drops the chrome and keeps the notice, the flags and the cited sentences", async ({
    page,
  }) => {
    await runSample(page, { plain: true });
    await page.emulateMedia({ media: "print" });

    // chrome is gone
    await expect(page.getByRole("banner")).toBeHidden();
    await expect(page.getByRole("heading", { name: "Source", exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Read summary aloud" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Reveal answer" }).first()).toBeHidden();
    await expect(page.getByRole("button", { name: "Delete this run" })).toBeHidden();
    await expect(page.locator("summary", { hasText: "Export and print" })).toBeHidden();
    await expect(page.getByRole("group", { name: "Reading level" })).toBeHidden();

    // the notice is repeated, because the header it normally lives in is not printed
    await expect(
      page.getByRole("note").filter({ hasText: "Check flagged items against the source." }),
    ).toBeVisible();

    // each item carries the sentences it cites, quoted
    const first = page.locator("li[data-item-id]").first();
    await expect(first.getByText("Source sentences cited")).toBeVisible();
    await expect(
      first.getByText("S1.1 — CPU scheduling is the method an operating system uses"),
    ).toBeVisible();

    // flags are text
    await expect(page.getByText("Check against source:")).toBeVisible();
    await expect(page.getByText("Check against source (partial)")).toBeVisible();

    // the answers follow the questions on paper
    await expect(page.getByRole("heading", { name: "Answer key" })).toBeVisible();
  });

  test("print uses the light palette at normal size even when the screen is dark and large", async ({
    page,
  }) => {
    await runSample(page);
    await openSettings(page);
    await page.getByRole("radio", { name: "Dark" }).check();
    await page.getByLabel(/^Text size/).fill("200");
    await page.emulateMedia({ media: "print" });
    const style = await page.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      color: getComputedStyle(document.body).color,
      root: getComputedStyle(document.documentElement).fontSize,
    }));
    expect(style.background).toBe("rgb(255, 255, 255)");
    expect(style.color).toBe("rgb(0, 0, 0)");
    expect(style.root).toBe("16px");
  });

  test("before printing every disclosure opens, and afterwards they close again", async ({
    page,
  }) => {
    await runSample(page);
    const removedSummary = page.getByText(/^Removed items/);
    const removedItem = page.getByText("sum-7", { exact: true });
    await expect(removedItem).toBeHidden();

    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    await expect(removedItem).toBeVisible();

    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await expect(removedItem).toBeHidden();
    await expect(removedSummary).toBeVisible();
  });

  test("the removed items are on paper too, so nothing disappears there either", async ({
    page,
  }) => {
    await runSample(page);
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    await page.emulateMedia({ media: "print" });
    for (const id of ["sum-7", "sum-8", "q-4", "q-6", "q-8"]) {
      await expect(page.getByText(id, { exact: true })).toBeVisible();
    }
  });

  test("the Print button prints, and a PDF can be produced from the print view", async ({
    page,
  }) => {
    await runSample(page);
    await page.evaluate(() => {
      (window as unknown as { __printed: number }).__printed = 0;
      window.print = () => {
        (window as unknown as { __printed: number }).__printed++;
      };
    });
    await openExport(page);
    await page.getByRole("button", { name: "Print / Save as PDF" }).click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(
      1,
    );

    const pdf = await page.pdf({ format: "A4" });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(10_000);
  });

  test("axe: zero serious or critical in the print view", async ({ page }) => {
    await runSample(page, { plain: true });
    await page.emulateMedia({ media: "print" });
    await expectNoSeriousViolations(page, "print view");
  });
});
