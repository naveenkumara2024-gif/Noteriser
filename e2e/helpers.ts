import { expect, type Page } from "@playwright/test";

export const SAMPLE_TITLE = "Lecture 7: CPU Scheduling Basics";

/** Home -> sample lecture -> run -> results page. Returns the results page path. */
export async function runSample(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "Use sample lecture" }).click();
  await page.getByRole("button", { name: "Make study aids" }).click();
  await page.waitForURL(/\/runs\/[\w-]+$/);
  await expect(page.getByRole("heading", { level: 1, name: SAMPLE_TITLE })).toBeVisible();
  return new URL(page.url()).pathname;
}
