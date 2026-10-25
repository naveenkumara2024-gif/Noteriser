import { expect, test } from "@playwright/test";
import { focusedName, SAMPLE_TITLE, tabTo } from "./helpers";

test("the whole flow works with Tab, Enter and Space only, with a visible focus ring everywhere", async ({
  page,
}) => {
  await page.goto("/");

  // load the sample, then start the run
  await tabTo(page, "Use sample lecture");
  await page.keyboard.press("Enter");
  await expect(page.locator("#notes")).not.toHaveValue("");

  await tabTo(page, "Make study aids");
  await page.keyboard.press("Space");
  await page.waitForURL(/\/runs\/[\w-]+$/);
  await expect(page.getByRole("heading", { level: 1, name: SAMPLE_TITLE })).toBeVisible();

  // pick a citation and see the sentence highlighted
  await tabTo(page, /^Source sentence S\d+\.\d+$/);
  const cited = (await focusedName(page)).replace("Source sentence ", "");
  await page.keyboard.press("Enter");
  await expect(page.locator(`[id="src-${cited}"]`)).toHaveAttribute("aria-current", "true");

  // reveal a question's answer
  await tabTo(page, "Reveal answer");
  await page.keyboard.press("Space");
  await expect(page.getByText("Answer:").first()).toBeVisible();

  // open the removed items panel
  await tabTo(page, /^Removed items \(\d+\)$/);
  await page.keyboard.press("Enter");
  await expect(page.getByText("sum-7", { exact: true })).toBeVisible();

  // delete the run, choosing the confirmation by keyboard
  await tabTo(page, "Delete this run");
  await page.keyboard.press("Enter");
  await tabTo(page, "Yes, delete");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/\?deleted=1$/);
  await expect(page.getByText("The run was deleted")).toBeVisible();
});

test("the skip link is the first stop and moves focus to the main content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  expect(await focusedName(page)).toBe("Skip to main content");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});
