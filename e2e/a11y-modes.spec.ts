import { expect, test } from "@playwright/test";
import { expectNoSeriousViolations, openSettings, runSample, stubSpeech } from "./helpers";

const THEMES = [
  ["Light", "light"],
  ["Dark", "dark"],
  ["High contrast", "high-contrast"],
] as const;

test.describe("axe in every theme and at both text-size extremes", () => {
  for (const [label, name] of THEMES) {
    for (const size of [100, 200]) {
      test(`${name} theme, text ${size}%: results with the Removed panel and a flagged item`, async ({
        page,
      }) => {
        await stubSpeech(page); // so the read-aloud controls are part of what is checked
        await runSample(page, { plain: true });
        await openSettings(page);
        await page.getByRole("radio", { name: label }).check();
        await page.getByLabel(/^Text size/).fill(String(size));
        await page.getByRole("radio", { name: "Plain language" }).check();
        await page.getByText(/^Removed items/).click();
        await expect(page.getByText("Check against source (partial)")).toBeVisible();
        await expectNoSeriousViolations(page, `${name} ${size}% results`);
      });
    }
  }

  test("home page in each theme with the settings panel open", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);
    for (const [label, name] of THEMES) {
      await page.getByRole("radio", { name: label }).check();
      await expectNoSeriousViolations(page, `${name} home + settings`);
    }
  });

  test("readable font and extra spacing together", async ({ page }) => {
    await runSample(page, { plain: true });
    await openSettings(page);
    await page.getByLabel("Font").selectOption("readable");
    await page.getByLabel("Spacing").selectOption("extra");
    await expectNoSeriousViolations(page, "readable font, extra spacing");
  });

  test("progress panel with the plain-language stage", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Use sample lecture" }).click();
    await page.getByRole("checkbox", { name: "Also write plain-language versions" }).check();
    await page.getByRole("button", { name: "Make study aids" }).click();
    await expect(page.getByRole("heading", { name: "Working on your notes" })).toBeVisible();
    await expectNoSeriousViolations(page, "progress with plain stage");
    await page.waitForURL(/\/runs\//);
  });
});

test.describe("operating-system modes", () => {
  test("forced colours (Windows high-contrast): axe is clean and the cues survive", async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await runSample(page, { plain: true });
    await page.getByText(/^Removed items/).click();
    await expectNoSeriousViolations(page, "forced colours results");

    // With system colours the tint is gone, so the non-colour cues must carry the meaning.
    await page
      .getByRole("region", { name: "Summary" })
      .getByRole("button", { name: /^Source sentence S/ })
      .first()
      .click();
    const cited = page.locator('[aria-current="true"]:visible').first();
    await expect(cited).toContainText("(Cited)");
    const outline = await cited.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe("solid");
    await expect(page.getByText("Check against source (partial)")).toBeVisible();
  });

  test("prefers-contrast: more gives the high-contrast palette without any setting", async ({
    page,
  }) => {
    await page.emulateMedia({ contrast: "more" });
    await runSample(page, { plain: true });
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      "rgb(0, 0, 0)",
    );
    await expectNoSeriousViolations(page, "prefers-contrast results");
  });

  test("prefers-reduced-motion removes transitions and animations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const motion = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector("button") as Element);
      return { transition: s.transitionProperty, animation: s.animationName };
    });
    expect(motion.transition).toBe("none");
    expect(motion.animation).toBe("none");
  });
});
