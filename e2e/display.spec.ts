import { expect, type Page, test } from "@playwright/test";
import { openSettings, runSample, SAMPLE_TITLE, tabTo } from "./helpers";

const KEY = "noteriser.display.v1";
const html = (page: Page, attr: string) =>
  page.evaluate((a) => document.documentElement.getAttribute(a), attr);
const rootFontPx = (page: Page) =>
  page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize));
const bodyColor = (page: Page, prop: "backgroundColor" | "color") =>
  page.evaluate((p) => getComputedStyle(document.body)[p as "color"], prop);

test.describe("display settings", () => {
  test("a chosen theme applies at once and is remembered across reloads", async ({ page }) => {
    await page.goto("/");
    expect(await html(page, "data-theme")).toBeNull();

    await openSettings(page);
    await page.getByRole("radio", { name: "Dark" }).check();
    expect(await html(page, "data-theme")).toBe("dark");
    expect(await bodyColor(page, "backgroundColor")).toBe("rgb(11, 15, 20)");

    await page.reload();
    expect(await html(page, "data-theme")).toBe("dark");
    await openSettings(page);
    await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  });

  test("saved settings are in place before the page is shown, not applied after (no flash)", async ({
    page,
  }) => {
    await page.addInitScript(
      ([key]) =>
        localStorage.setItem(
          key as string,
          JSON.stringify({
            theme: "contrast",
            textSize: 150,
            font: "readable",
            spacing: "comfortable",
          }),
        ),
      [KEY],
    );
    // Block hydration entirely: if the settings still apply, the head script did it.
    await page.route(/\/_next\/static\/.*\.js/, (route) => route.abort());
    await page.goto("/", { waitUntil: "domcontentloaded" });

    expect(await html(page, "data-theme")).toBe("contrast");
    expect(await html(page, "data-font")).toBe("readable");
    expect(await html(page, "data-spacing")).toBe("comfortable");
    expect(await rootFontPx(page)).toBe(24);
    expect(await bodyColor(page, "backgroundColor")).toBe("rgb(0, 0, 0)");
  });

  test("each theme has its own palette: light, dark and high contrast", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);
    const colours: Record<string, string> = {};
    for (const [label, theme] of [
      ["Light", "light"],
      ["Dark", "dark"],
      ["High contrast", "contrast"],
    ] as const) {
      await page.getByRole("radio", { name: label }).check();
      colours[theme] = await bodyColor(page, "backgroundColor");
    }
    expect(colours).toEqual({
      light: "rgb(255, 255, 255)",
      dark: "rgb(11, 15, 20)",
      contrast: "rgb(0, 0, 0)",
    });
  });

  test("the system theme follows the device: dark, and high contrast via prefers-contrast", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    expect(await bodyColor(page, "backgroundColor")).toBe("rgb(11, 15, 20)");

    await page.emulateMedia({ colorScheme: "light", contrast: "more" });
    expect(await bodyColor(page, "backgroundColor")).toBe("rgb(0, 0, 0)");

    // an explicit choice beats the device
    await openSettings(page);
    await page.getByRole("radio", { name: "Light" }).check();
    expect(await bodyColor(page, "backgroundColor")).toBe("rgb(255, 255, 255)");
  });

  test("text size runs from 100% to 200% and scales the whole interface", async ({ page }) => {
    await page.goto("/");
    expect(await rootFontPx(page)).toBe(16);
    await openSettings(page);
    const slider = page.getByLabel(/^Text size/);
    await slider.fill("200");
    expect(await rootFontPx(page)).toBe(32);
    await expect(page.getByText("Text size: 200%")).toBeVisible();
    await slider.fill("100");
    expect(await rootFontPx(page)).toBe(16);
  });

  test("the readable font is a real, loaded font and the label makes no health claim", async ({
    page,
  }) => {
    await page.goto("/");
    const before = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    await openSettings(page);
    await expect(page.getByLabel("Font")).toContainText("Readable font (Atkinson Hyperlegible)");
    await expect(page.locator("body")).not.toContainText(/dyslex/i);

    await page.getByLabel("Font").selectOption("readable");
    const after = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(after).not.toBe(before);
    expect(after).not.toMatch(/^system-ui/); // the bundled font file leads the stack
    const loaded = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].some((f) => f.status === "loaded");
    });
    expect(loaded).toBe(true);
  });

  test("Comfortable spacing meets the WCAG 1.4.12 minimums by default", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);
    await page.getByLabel("Spacing").selectOption("comfortable");
    const m = await page.evaluate(() => {
      const s = getComputedStyle(document.body);
      const size = Number.parseFloat(s.fontSize);
      return {
        lineHeight: Number.parseFloat(s.lineHeight) / size,
        letter: Number.parseFloat(s.letterSpacing) / size,
        word: Number.parseFloat(s.wordSpacing) / size,
        paragraph:
          Number.parseFloat(
            getComputedStyle(document.querySelector("main p") as Element).marginBottom,
          ) / size,
      };
    });
    expect(m.lineHeight).toBeGreaterThanOrEqual(1.5);
    expect(m.letter).toBeGreaterThanOrEqual(0.12);
    expect(m.word).toBeGreaterThanOrEqual(0.16);
    expect(m.paragraph).toBeGreaterThanOrEqual(2);
  });

  test("Reset returns every setting to its default", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);
    await page.getByRole("radio", { name: "Dark" }).check();
    await page.getByLabel(/^Text size/).fill("170");
    await page.getByLabel("Spacing").selectOption("extra");
    await page.getByRole("button", { name: "Reset display settings" }).click();
    expect(await html(page, "data-theme")).toBeNull();
    expect(await html(page, "data-spacing")).toBeNull();
    expect(await rootFontPx(page)).toBe(16);
    await page.reload();
    expect(await html(page, "data-theme")).toBeNull();
  });

  test("corrupt saved settings fall back to the defaults instead of breaking the page", async ({
    page,
  }) => {
    await page.addInitScript(([key]) => localStorage.setItem(key as string, "{not json"), [KEY]);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "NoteBridge" })).toBeVisible();
    expect(await html(page, "data-theme")).toBeNull();
  });

  test("the whole settings panel works from the keyboard", async ({ page }) => {
    await page.goto("/");
    await tabTo(page, "Display settings");
    await page.keyboard.press("Enter");

    // theme radios: arrow keys move between them
    await tabTo(page, "Match my device");
    await page.keyboard.press("ArrowRight"); // Light
    await page.keyboard.press("ArrowRight"); // Dark
    expect(await html(page, "data-theme")).toBe("dark");

    await tabTo(page, /^Text size/);
    await page.keyboard.press("End");
    expect(await rootFontPx(page)).toBe(32);

    await tabTo(page, "Font");
    await page.keyboard.press("ArrowDown");
    expect(await html(page, "data-font")).toBe("readable");

    await tabTo(page, "Reset display settings");
    await page.keyboard.press("Enter");
    expect(await html(page, "data-theme")).toBeNull();
    expect(await rootFontPx(page)).toBe(16);
  });
});

test.describe("on the results page", () => {
  test("settings carry over and persist from the home page", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);
    await page.getByRole("radio", { name: "High contrast" }).check();
    await runSample(page);
    expect(await html(page, "data-theme")).toBe("contrast");
    await expect(page.getByRole("heading", { level: 1, name: SAMPLE_TITLE })).toBeVisible();
  });
});
