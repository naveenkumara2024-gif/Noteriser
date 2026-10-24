import { expect, type Page, test } from "@playwright/test";
import { SAMPLE_TITLE } from "./helpers";

/** What the focused element is called, as a person would hear it. */
const focusedName = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return "";
    return (
      el.getAttribute("aria-label") ??
      (el.tagName === "TEXTAREA" || el.tagName === "INPUT"
        ? (document.querySelector(`label[for="${el.id}"]`)?.textContent ?? "")
        : (el.textContent ?? ""))
    ).trim();
  });

/** The focused element must show a ring: an outline of real width and style. */
async function expectVisibleFocus(page: Page) {
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, width: Number.parseFloat(s.outlineWidth) };
  });
  expect(ring.style).not.toBe("none");
  expect(ring.width).toBeGreaterThanOrEqual(2);
}

/** Presses Tab until the focused element's name matches, checking the focus ring at every stop. */
async function tabTo(page: Page, name: string | RegExp, limit = 60) {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press("Tab");
    await expectVisibleFocus(page);
    const current = await focusedName(page);
    if (typeof name === "string" ? current === name : name.test(current)) return;
  }
  throw new Error(
    `Never reached ${String(name)} by keyboard; stopped at "${await focusedName(page)}"`,
  );
}

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
  await tabTo(page, /^S\d+\.\d+$/);
  const cited = await focusedName(page);
  await page.keyboard.press("Enter");
  await expect(page.locator(`#src-${cited}`)).toHaveAttribute("aria-current", "true");

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
