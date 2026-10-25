import { expect, test } from "@playwright/test";
import {
  finishUtterance,
  fireBoundary,
  runSample,
  speechCalls,
  spoken,
  stubSpeech,
  tabTo,
} from "./helpers";

test.describe("read aloud", () => {
  test("controls are not drawn where the browser has no speech synthesis", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        value: undefined,
        configurable: true,
      });
    });
    await runSample(page);
    await expect(page.getByRole("heading", { name: "Read aloud" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /read .*aloud/i })).toHaveCount(0);
  });

  test("nothing is spoken until a button is pressed", async ({ page }) => {
    await stubSpeech(page);
    await runSample(page);
    await expect(page.getByRole("heading", { name: "Read aloud" })).toBeVisible();
    expect(await spoken(page)).toEqual([]);
  });

  test("reads the whole summary in order, item by item, and highlights the item being read", async ({
    page,
  }) => {
    await stubSpeech(page);
    await runSample(page);
    // item cards only: citation chips are list items too
    const summaryItems = page.getByRole("region", { name: "Summary" }).locator("li[data-item-id]");
    const expected = (await summaryItems.locator(":scope > p.measure").allTextContents()).map((t) =>
      t.trim(),
    );
    expect(expected.length).toBeGreaterThan(3);

    await page.getByRole("button", { name: "Read summary aloud" }).click();
    expect(await spoken(page)).toEqual([expected[0]]);

    // the first item is marked with words and a thick edge, not colour alone
    const first = summaryItems.first();
    await expect(first).toHaveAttribute("data-speaking", "true");
    await expect(first.getByText("Reading aloud")).toBeVisible();
    await expect(page.locator('[data-speaking="true"]')).toHaveCount(1);

    await finishUtterance(page);
    await expect.poll(() => spoken(page)).toEqual(expected.slice(0, 2));
    await expect(summaryItems.nth(1)).toHaveAttribute("data-speaking", "true");
    await expect(first).not.toHaveAttribute("data-speaking", "true");

    for (let i = 2; i < expected.length; i++) await finishUtterance(page);
    await finishUtterance(page);
    expect(await spoken(page)).toEqual(expected);
    await expect(page.locator('[data-speaking="true"]')).toHaveCount(0);
  });

  test("marks the word being spoken when the engine reports word boundaries", async ({ page }) => {
    await stubSpeech(page);
    await runSample(page);
    const first = page.getByRole("region", { name: "Summary" }).locator("li[data-item-id]").first();
    await page.getByRole("button", { name: "Read summary aloud" }).click();
    await expect(first.locator("mark")).toHaveCount(0); // no word events yet: item-level only

    await fireBoundary(page, 4); // "CPU scheduling decides ..." -> scheduling
    await expect(first.locator("mark")).toHaveText("scheduling");
    // the mark is not colour alone: bold and underlined
    const style = await first.locator("mark").evaluate((el) => {
      const s = getComputedStyle(el);
      return { weight: s.fontWeight, underline: s.textDecorationLine };
    });
    expect(Number(style.weight)).toBeGreaterThanOrEqual(700);
    expect(style.underline).toContain("underline");

    await fireBoundary(page, 15); // "decides"
    await expect(first.locator("mark")).toHaveText("decides");

    await finishUtterance(page);
    await expect(first.locator("mark")).toHaveCount(0);
  });

  test("a glossary term is not marked, but the words of its definition are", async ({ page }) => {
    await stubSpeech(page);
    await runSample(page);
    const entry = page
      .getByRole("region", { name: "Glossary" })
      .locator("li[data-item-id]")
      .first();
    await page.getByRole("button", { name: "Read glossary aloud" }).click();
    // spoken: "Dispatcher. The component that hands ..."
    await fireBoundary(page, 0); // inside the term
    await expect(entry.locator("mark")).toHaveCount(0);
    await fireBoundary(page, 16); // "component"
    await expect(entry.locator("mark")).toHaveText("component");
  });

  test("a glossary item says its term first, and removed items are never read", async ({
    page,
  }) => {
    await stubSpeech(page);
    await runSample(page);
    await page.getByRole("button", { name: "Read glossary aloud" }).click();
    expect((await spoken(page))[0]).toBe(
      "Dispatcher. The component that hands the CPU to the chosen process.",
    );
    for (let i = 0; i < 12; i++) await finishUtterance(page);

    await page.getByRole("button", { name: "Read summary aloud" }).click();
    for (let i = 0; i < 12; i++) await finishUtterance(page);

    const all = (await spoken(page)).join(" ");
    for (const removedWording of [
      "most widely used",
      "impossible to implement",
      "typical time quantum",
    ]) {
      expect(all).not.toContain(removedWording);
    }
  });

  test("question mode reads the question and options, then waits for Reveal answer", async ({
    page,
  }) => {
    await stubSpeech(page);
    await runSample(page);
    const mcq = page
      .getByRole("region", { name: "Practice questions" })
      .getByRole("listitem")
      .filter({ hasText: "Multiple choice" })
      .first();

    await mcq.getByRole("button", { name: "Read question aloud" }).click();
    const first = (await spoken(page))[0] ?? "";
    expect(first).toContain("what happens if the time quantum is made very small?");
    expect(first).toContain("A. RR behaves like FCFS.");
    expect(first).not.toMatch(/\banswer\b/i);

    // the answer is a separate step: nothing more is said, and no answer button exists yet
    await finishUtterance(page);
    expect(await spoken(page)).toHaveLength(1);
    await expect(mcq.getByRole("button", { name: "Read answer aloud" })).toHaveCount(0);

    await mcq.getByRole("button", { name: "Reveal answer" }).click();
    await expect(mcq.getByRole("button", { name: "Read answer aloud" })).toBeVisible();
    await mcq.getByRole("button", { name: "Read answer aloud" }).click();
    expect((await spoken(page)).at(-1)).toBe("Answer: Context-switch overhead increases");
  });

  test("pause, resume and stop reach the speech engine; the rate applies to the next item", async ({
    page,
  }) => {
    await stubSpeech(page);
    await runSample(page);
    await expect(page.getByRole("button", { name: "Pause" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Stop" })).toBeDisabled();

    await page.getByLabel("Speed").selectOption("1.5");
    await page.getByRole("button", { name: "Read summary aloud" }).click();
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
    await page.getByRole("button", { name: "Resume" }).click();
    await page.getByRole("button", { name: "Stop" }).click();

    expect(await speechCalls(page)).toEqual(["cancel", "speak", "pause", "resume", "cancel"]);
    await expect(page.locator('[data-speaking="true"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pause" })).toBeDisabled();
  });

  test("leaving the page cancels speech", async ({ page }) => {
    await stubSpeech(page);
    await runSample(page);
    await page.getByRole("button", { name: "Read summary aloud" }).click();
    await page.getByRole("link", { name: "Start another" }).click();
    await page.waitForURL("/");
    expect((await speechCalls(page)).at(-1)).toBe("cancel");
  });

  test("the voice list comes from the engine, with a default", async ({ page }) => {
    await stubSpeech(page);
    await runSample(page);
    await expect(page.getByLabel("Voice")).toContainText("Default voice");
    await expect(page.getByLabel("Voice")).toContainText("Mock Voice (en-GB)");
  });

  test("works from the keyboard: Tab to the controls, Enter to play, Space to pause", async ({
    page,
  }) => {
    await stubSpeech(page);
    await runSample(page);
    await tabTo(page, "Read summary aloud");
    await page.keyboard.press("Enter");
    expect(await spoken(page)).toHaveLength(1);
    await tabTo(page, "Pause");
    await page.keyboard.press("Space");
    // the same button is now "Resume" and keeps focus, so a keyboard user is not dropped
    await expect(page.getByRole("button", { name: "Resume" })).toBeFocused();
    await page.keyboard.press("Enter");
    await tabTo(page, "Stop");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Stop" })).toBeDisabled();
  });
});

test.describe("chunked sections", () => {
  test("each part collapses and expands, and Expand all / Collapse all drive them together", async ({
    page,
  }) => {
    await runSample(page);
    const summary = page.getByRole("region", { name: "Summary" });
    const items = summary.getByRole("listitem");
    await expect(items.first()).toBeVisible();

    await summary.locator("summary").first().click();
    await expect(items.first()).toBeHidden();
    // the other parts are unaffected
    await expect(
      page.getByRole("region", { name: "Glossary" }).getByRole("listitem").first(),
    ).toBeVisible();

    // with one part collapsed the button offers to expand them all
    await page.getByRole("button", { name: "Expand all sections" }).click();
    await expect(items.first()).toBeVisible();
    await page.getByRole("button", { name: "Collapse all sections" }).click();
    await expect(
      page.getByRole("region", { name: "Practice questions" }).getByRole("listitem"),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Expand all sections" })).toBeVisible();

    await page.getByRole("button", { name: "Expand all sections" }).click();
    await expect(items.first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Collapse all sections" })).toBeVisible();
  });

  test("works from the keyboard", async ({ page }) => {
    await runSample(page);
    await tabTo(page, "Collapse all sections");
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "Expand all sections" })).toBeFocused();
    await tabTo(page, "Summary");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("region", { name: "Summary" }).getByRole("listitem").first(),
    ).toBeVisible();
  });

  test("a partial item is announced as a warning in text for screen readers", async ({ page }) => {
    await runSample(page);
    const badge = page.getByText("Check against source (partial)");
    await expect(badge).toHaveCount(1);
    await expect(badge.locator("xpath=..")).toContainText("Warning:");
  });
});

test.describe("plain-language mode", () => {
  test("is off by default: no reading-level control, no extra stage", async ({ page }) => {
    await runSample(page);
    await expect(page.getByRole("group", { name: "Reading level" })).toHaveCount(0);
  });

  test("the progress panel gains a plain-language stage", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Use sample lecture" }).click();
    await page.getByRole("checkbox", { name: "Also write plain-language versions" }).check();
    await page.getByRole("button", { name: "Make study aids" }).click();
    await expect(page.getByText(/^Step \d of 6:/)).toBeVisible();
    await expect(page.getByText("Writing and checking plain-language versions")).toBeVisible();
    await page.waitForURL(/\/runs\//);
  });

  test("states the counts and the before-and-after reading grade", async ({ page }) => {
    await runSample(page, { plain: true });
    const group = page.getByRole("group", { name: "Reading level" });
    await expect(group).toContainText("11 simplified, 3 already plain, 5 kept as written.");
    await expect(group).toContainText(
      "Average reading grade: 6.6 as written, 5.3 in plain language.",
    );
  });

  test("shows verified plain wording on request and the original again on request", async ({
    page,
  }) => {
    await runSample(page, { plain: true });
    const summary = page.getByRole("region", { name: "Summary" });
    const first = summary.getByRole("listitem").first();
    const original =
      "CPU scheduling decides which process in the ready queue gets the CPU next and keeps the CPU busy with acceptable response times.";
    await expect(first).toContainText(original);

    await page.getByRole("radio", { name: "Plain language" }).check();
    await expect(first).toContainText(
      "CPU scheduling decides which process gets the CPU next. It keeps the CPU busy.",
    );
    await expect(first).not.toContainText(original);
    await expect(first).toContainText("checked against the source like every other item");
    await expect(first).toContainText("Reading grade 10.7 to 4.3");
    await expect(first.getByText("Supported", { exact: false }).first()).toBeVisible();

    await page.getByRole("radio", { name: "Original wording" }).check();
    await expect(first).toContainText(original);
  });

  test("an unverifiable rewrite is not shown: the original stays, with the reason", async ({
    page,
  }) => {
    await runSample(page, { plain: true });
    await page.getByRole("radio", { name: "Plain language" }).check();
    const fcfs = page
      .getByRole("region", { name: "Summary" })
      .getByRole("listitem")
      .filter({ hasText: "FCFS runs processes in arrival order" });
    await expect(fcfs).toContainText("where short processes wait behind one long process");
    await expect(fcfs).toContainText("Kept original:");
    await expect(fcfs).toContainText("The simplified version could not be verified.");
    await expect(page.locator("main")).not.toContainText("slowest method");
  });

  test("flag semantics and the trust notice are identical in plain view", async ({ page }) => {
    await runSample(page, { plain: true });
    await page.getByRole("radio", { name: "Plain language" }).check();
    await expect(page.getByText("Check against source (partial)")).toHaveCount(1);
    await expect(page.getByRole("note").filter({ hasText: "Check flagged items" })).toBeVisible();
    await page.getByText(/^Removed items/).click();
    await expect(page.getByText("sum-7", { exact: true })).toBeVisible();
  });

  test("read aloud follows the wording on screen", async ({ page }) => {
    await stubSpeech(page);
    await runSample(page, { plain: true });
    await page.getByRole("radio", { name: "Plain language" }).check();
    await page.getByRole("button", { name: "Read summary aloud" }).click();
    expect((await spoken(page))[0]).toContain("It keeps the CPU busy.");
  });
});
