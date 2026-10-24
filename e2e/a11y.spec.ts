import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { runSample } from "./helpers";

/** Zero serious or critical violations (WCAG 2.2 A/AA rules and axe best practices). */
async function expectNoSeriousViolations(page: Page, state: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
    `axe violations on ${state}`,
  ).toEqual([]);
}

test.describe("axe: zero serious or critical", () => {
  test("home", async ({ page }) => {
    await page.goto("/");
    await expectNoSeriousViolations(page, "home");
  });

  test("home with an input error showing", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Make study aids" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expectNoSeriousViolations(page, "home with error");
  });

  test("progress", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Use sample lecture" }).click();
    await page.getByRole("button", { name: "Make study aids" }).click();
    await expect(page.getByRole("heading", { name: "Working on your notes" })).toBeVisible();
    await expectNoSeriousViolations(page, "progress");
  });

  test("results", async ({ page }) => {
    await runSample(page);
    await expectNoSeriousViolations(page, "results");
  });

  test("results with a citation selected and an answer revealed", async ({ page }) => {
    await runSample(page);
    await page
      .getByRole("region", { name: "Summary" })
      .getByRole("button", { name: /^Source sentence S/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Reveal answer" }).first().click();
    await expectNoSeriousViolations(page, "results, selected + revealed");
  });

  test("results with the Removed panel open", async ({ page }) => {
    await runSample(page);
    await page.getByText("Removed items (5)").click();
    await expect(page.getByText("sum-7", { exact: true })).toBeVisible();
    await expectNoSeriousViolations(page, "removed panel open");
  });

  test("results with the delete prompt showing", async ({ page }) => {
    await runSample(page);
    await page.getByRole("button", { name: "Delete this run" }).click();
    await expectNoSeriousViolations(page, "delete prompt");
  });

  test.describe("narrow", () => {
    test.use({ viewport: { width: 390, height: 800 } });

    test("results with a source disclosure open", async ({ page }) => {
      await runSample(page);
      await page.getByText("Show source").first().click();
      await expectNoSeriousViolations(page, "narrow results");
    });
  });

  test.describe("dark colour scheme", () => {
    test.use({ colorScheme: "dark" });

    test("home and results", async ({ page }) => {
      await page.goto("/");
      await expectNoSeriousViolations(page, "dark home");
      await runSample(page);
      await page.getByText("Removed items (5)").click();
      await expectNoSeriousViolations(page, "dark results");
    });
  });
});
