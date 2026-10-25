import { expect, test } from "@playwright/test";
import { expectNoSeriousViolations, runSample, tabTo } from "./helpers";

const firstSummaryItem = (page: import("@playwright/test").Page) =>
  page.getByRole("region", { name: "Summary" }).locator("li[data-item-id]").first();

test.describe("instructor feedback", () => {
  test("is closed until opened, and Send stays disabled until a kind is chosen", async ({
    page,
  }) => {
    await runSample(page);
    const item = firstSummaryItem(page);
    await expect(item.getByRole("radio", { name: "Wrong" })).toBeHidden();
    await item.locator("summary", { hasText: "Report a problem" }).click();
    await expect(item.getByRole("button", { name: "Send feedback" })).toBeDisabled();
    await item.getByRole("radio", { name: "Unclear" }).check();
    await expect(item.getByRole("button", { name: "Send feedback" })).toBeEnabled();
  });

  test("sends feedback with a note, confirms it, and it appears in the owner's audit file", async ({
    page,
  }) => {
    const path = await runSample(page);
    const id = path.split("/").pop();
    const item = firstSummaryItem(page);
    const itemId = await item.getAttribute("data-item-id");

    await item.locator("summary", { hasText: "Report a problem" }).click();
    await item.getByRole("radio", { name: "Missing context" }).check();
    await item.getByLabel(/^Note/).fill("Needs the definition of response time.");
    await item.getByRole("button", { name: "Send feedback" }).click();
    await expect(item.getByRole("status")).toContainText('Marked as "Missing context"');
    // the form resets after sending
    await expect(item.getByRole("radio", { name: "Missing context" })).not.toBeChecked();

    // `page.request` shares this browser's cookies, so it is the owner
    const res = await page.request.get(`/api/runs/${id}/export?format=json`);
    expect(res.status()).toBe(200);
    const audit = await res.json();
    expect(audit.feedback).toEqual([
      expect.objectContaining({
        itemId,
        kind: "missing_context",
        note: "Needs the definition of response time.",
      }),
    ]);
  });

  test("works for every kind of item: a glossary entry and a question too", async ({ page }) => {
    await runSample(page);
    for (const section of ["Glossary", "Practice questions"]) {
      const item = page.getByRole("region", { name: section }).locator("li[data-item-id]").first();
      await item.locator("summary", { hasText: "Report a problem" }).click();
      await item.getByRole("radio", { name: "Wrong" }).check();
      await item.getByRole("button", { name: "Send feedback" }).click();
      await expect(item.getByRole("status")).toContainText("Thank you");
    }
  });

  test("a failed save is said plainly", async ({ page }) => {
    await runSample(page);
    await page.route("**/api/runs/*/feedback", (route) =>
      route.fulfill({ status: 500, body: "{}" }),
    );
    const item = firstSummaryItem(page);
    await item.locator("summary", { hasText: "Report a problem" }).click();
    await item.getByRole("radio", { name: "Wrong" }).check();
    await item.getByRole("button", { name: "Send feedback" }).click();
    await expect(item.getByRole("status")).toContainText("could not be saved");
  });

  test("is not in the print view", async ({ page }) => {
    await runSample(page);
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("summary", { hasText: "Report a problem" }).first()).toBeHidden();
  });

  test("axe: zero serious or critical with the form open", async ({ page }) => {
    await runSample(page);
    await firstSummaryItem(page).locator("summary", { hasText: "Report a problem" }).click();
    await expectNoSeriousViolations(page, "feedback form open");
  });

  test("can be completed with the keyboard alone", async ({ page }) => {
    await runSample(page);
    await tabTo(page, "Report a problem with this item");
    await page.keyboard.press("Enter");
    await tabTo(page, "Wrong");
    await page.keyboard.press("ArrowRight"); // Unclear
    await tabTo(page, /^Note/);
    await page.keyboard.type("keyboard note");
    await tabTo(page, "Send feedback");
    await page.keyboard.press("Enter");
    await expect(firstSummaryItem(page).getByRole("status")).toContainText('Marked as "Unclear"');
  });
});
