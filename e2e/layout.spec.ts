import { expect, type Page, test } from "@playwright/test";
import { openSettings, runSample } from "./helpers";

const pageOverflows = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

/** Anything wider than the viewport, named, so a failure says which element broke reflow. */
const overflowing = (page: Page) =>
  page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    return [...document.querySelectorAll("body *")]
      .filter((el) => {
        // content inside a closed <details> is not on screen, whatever its box says
        if (!el.checkVisibility()) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > limit + 1 && getComputedStyle(el).position !== "fixed";
      })
      .slice(0, 6)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}" right=${Math.round(el.getBoundingClientRect().right)}`,
      );
  });

test.describe("reflow", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("home: no horizontal scrolling at 320 CSS px", async ({ page }) => {
    await page.goto("/");
    expect(await overflowing(page)).toEqual([]);
    expect(await pageOverflows(page)).toBe(false);
  });

  test("results: no horizontal scrolling at 320 CSS px, with everything open", async ({ page }) => {
    await runSample(page, { plain: true });
    await page.getByText(/^Removed items/).click();
    await page.locator("summary", { hasText: "Show source" }).first().click();
    expect(await overflowing(page)).toEqual([]);
    expect(await pageOverflows(page)).toBe(false);
  });

  test("results at 200% text size on a 320px screen (the 400% zoom case): still no sideways scroll", async ({
    page,
  }) => {
    await runSample(page, { plain: true });
    await openSettings(page);
    await page.getByLabel(/^Text size/).fill("200");
    await page.getByText(/^Removed items/).click();
    expect(await overflowing(page)).toEqual([]);
    expect(await pageOverflows(page)).toBe(false);
  });

  test("settings panel itself reflows at 320px and 200% text", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);
    await page.getByLabel(/^Text size/).fill("200");
    expect(await overflowing(page)).toEqual([]);
  });
});

test.describe("WCAG 1.4.12 text spacing", () => {
  /** The four overrides from the criterion, forced on every element. */
  const SPACING = `
    * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
    p { margin-bottom: 2em !important; }
  `;

  test("results: nothing is clipped or overlaps when a user forces the four spacing overrides", async ({
    page,
  }) => {
    await runSample(page, { plain: true });
    await page.getByText(/^Removed items/).click();
    await page.addStyleTag({ content: SPACING });

    expect(await pageOverflows(page)).toBe(false);

    const problems = await page.evaluate(() => {
      const out: string[] = [];
      // 1. no card, chip, button or status label clips its own content
      for (const el of document.querySelectorAll<HTMLElement>(
        "li[data-item-id], button, summary, [data-item-id] p",
      )) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || !el.checkVisibility()) continue;
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible") {
          out.push(`clipped: ${el.tagName} ${el.textContent?.slice(0, 30)}`);
        }
      }
      // 2. consecutive blocks in each list do not overlap
      for (const list of document.querySelectorAll("main ol, main ul")) {
        if (!list.querySelector(":scope > li[data-item-id]")) continue; // chip rows and option lists flow sideways by design
        const boxes = [...list.children]
          .map((c) => c.getBoundingClientRect())
          .filter((r) => r.height > 0);
        for (let i = 1; i < boxes.length; i++) {
          const prev = boxes[i - 1];
          const next = boxes[i];
          if (prev && next && next.top < prev.bottom - 1) out.push(`overlap in list at item ${i}`);
        }
      }
      // 3. an item's text stays inside its card
      for (const card of document.querySelectorAll<HTMLElement>("li[data-item-id]")) {
        const c = card.getBoundingClientRect();
        for (const p of card.querySelectorAll("p")) {
          if (!p.checkVisibility()) continue;
          const r = p.getBoundingClientRect();
          if (r.right > c.right + 1 || r.bottom > c.bottom + 1) {
            out.push(`text outside card ${card.dataset.itemId}`);
          }
        }
      }
      return out;
    });
    expect(problems).toEqual([]);
  });

  test("the text-spacing overrides also hold on the home page", async ({ page }) => {
    await page.goto("/");
    await page.addStyleTag({ content: SPACING });
    expect(await pageOverflows(page)).toBe(false);
    await expect(page.getByRole("button", { name: "Make study aids" })).toBeVisible();
  });
});

test.describe("target size (WCAG 2.5.8)", () => {
  test("every control on the results page is at least 24 by 24 CSS px", async ({ page }) => {
    await runSample(page, { plain: true });
    await openSettings(page);
    const small = await page.evaluate(() => {
      const out: string[] = [];
      const targets = document.querySelectorAll<HTMLElement>(
        "button, a[href], summary, select, input:not([type=radio]):not([type=checkbox]), label:has(input[type=radio]), label:has(input[type=checkbox])",
      );
      for (const el of targets) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || !el.checkVisibility()) continue; // hidden
        if (el.matches(".sr-only, .sr-only *")) continue;
        if (r.width < 24 || r.height < 24) {
          out.push(
            `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 25)}" ${Math.round(r.width)}x${Math.round(r.height)}`,
          );
        }
      }
      return out;
    });
    expect(small).toEqual([]);
  });
});
