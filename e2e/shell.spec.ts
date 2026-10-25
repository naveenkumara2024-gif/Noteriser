import { expect, type Page, test } from "@playwright/test";
import {
  appAlert,
  expectNoSeriousViolations,
  openSettings,
  runSample,
  SAMPLE_TITLE,
} from "./helpers";

const history = (page: Page) => page.getByRole("navigation", { name: "History" });
const rowLinks = (page: Page) => page.locator(".nb-row-link");
const search = (page: Page) => page.getByRole("searchbox", { name: "Search your runs" });
const notes = (page: Page) => page.getByLabel("Paste your lecture notes");

/** A second run, started from the sidebar's "New study aid" link as a person would. */
async function runSampleAgain(page: Page) {
  await history(page).getByRole("link", { name: "New study aid" }).click();
  await page.getByRole("button", { name: "Use sample lecture" }).click();
  await page.getByRole("button", { name: "Make study aids" }).click();
  await page.waitForURL(/\/runs\/[\w-]+$/);
}

test.describe("the shell around every page", () => {
  test("has one set of landmarks, one h1, and the trust notice on home and on results", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(history(page)).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Verification activity" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("note").filter({ hasText: "Check flagged items" })).toBeVisible();

    await runSample(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("note").filter({ hasText: "Check flagged items" })).toBeVisible();
  });

  test("the headline is one sentence for a screen reader and the composer is labelled", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "What are you studying today?" }),
    ).toBeVisible();
    await expect(notes(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload a file", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Make study aids" })).toBeVisible();
  });

  test("print shows none of the shell", async ({ page }) => {
    await runSample(page);
    await page.emulateMedia({ media: "print" });
    await expect(history(page)).toBeHidden();
    await expect(page.getByRole("complementary", { name: "Verification activity" })).toBeHidden();
    await expect(page.getByRole("banner")).toBeHidden();
  });
});

test.describe("history", () => {
  test("lists runs newest first, marks the open one, searches, groups and deletes", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(history(page).getByText("No runs yet")).toBeVisible();

    await runSample(page);
    await runSampleAgain(page);

    await expect(rowLinks(page)).toHaveCount(2);
    await expect(rowLinks(page).first()).toHaveAttribute("aria-current", "page");
    await expect(rowLinks(page).nth(1)).not.toHaveAttribute("aria-current", "page");
    // the time is spelled out for a screen reader
    await expect(rowLinks(page).first()).toContainText("just now");

    await search(page).fill("scheduling");
    await expect(rowLinks(page)).toHaveCount(2);
    await search(page).fill("zzzz");
    await expect(rowLinks(page)).toHaveCount(0);
    await expect(history(page).getByText("No runs match “zzzz”.")).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(rowLinks(page)).toHaveCount(2);

    // Project view: the two runs share one source title
    await history(page).getByRole("tab", { name: "Project" }).click();
    await expect(history(page).getByRole("tab", { name: "Project" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(history(page).getByRole("button", { name: /2 runs/ })).toBeVisible();
    await history(page).getByRole("tab", { name: "Timeline" }).click();

    // delete the open run from the sidebar: confirm first, then land on home with the notice
    await rowLinks(page).first().hover();
    await history(page)
      .getByRole("button", { name: /^Delete / })
      .first()
      .click();
    await expect(page.getByText("Delete this run and its source text permanently?")).toBeVisible();
    await page.getByRole("button", { name: "Keep it" }).click();
    await expect(rowLinks(page)).toHaveCount(2);

    await rowLinks(page).first().hover();
    await history(page)
      .getByRole("button", { name: /^Delete / })
      .first()
      .click();
    await page.getByRole("button", { name: "Yes, delete" }).click();
    await page.waitForURL(/\/\?deleted=1$/);
    await expect(rowLinks(page)).toHaveCount(1);
  });

  test("Ctrl+K moves focus to the search box", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+k");
    await expect(search(page)).toBeFocused();
    await page.keyboard.type("abc");
    await page.keyboard.press("Escape");
    await expect(search(page)).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(search(page)).not.toBeFocused();
  });
});

test.describe("columns", () => {
  test("the history and activity columns can be hidden, and the choice survives a reload", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Hide history" }).first().click();
    await expect(history(page)).toBeHidden();
    await page.reload();
    await expect(history(page)).toBeHidden();
    await expect(page.locator("html")).toHaveAttribute("data-sidebar-pref", "closed");
    await page.getByRole("button", { name: "Show history" }).click();
    await expect(history(page)).toBeVisible();

    await page.getByRole("button", { name: "Close verification activity" }).click();
    const panel = page.getByRole("complementary", { name: "Verification activity" });
    await expect(panel).toBeHidden();
    await page.reload();
    await expect(panel).toBeHidden();
    await page.getByRole("button", { name: "Show verification activity" }).click();
    await expect(panel).toBeVisible();
  });

  test("closing the history from inside it puts focus back on the button that opens it", async ({
    page,
  }) => {
    await page.goto("/");
    await history(page).getByRole("button", { name: "Hide history" }).click();
    await expect(page.getByRole("button", { name: "Show history" })).toBeFocused();
  });

  test.describe("on a narrow window the columns are drawers", () => {
    test.use({ viewport: { width: 800, height: 900 } });

    test("history opens as a modal dialog, Escape closes it and focus returns", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(history(page)).toBeHidden();
      const toggle = page.getByRole("button", { name: "Show history" });
      await toggle.click();
      const dialog = page.getByRole("dialog", { name: "History" });
      await expect(dialog).toBeVisible();
      await expectNoSeriousViolations(page, "history drawer");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(toggle).toBeFocused();
    });

    test("the activity drawer opens and closes the same way", async ({ page }) => {
      await page.goto("/");
      const toggle = page.getByRole("button", { name: "Show verification activity" });
      await toggle.click();
      const dialog = page.getByRole("dialog", { name: "Verification activity" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("Nothing running.")).toBeVisible();
      await expectNoSeriousViolations(page, "activity drawer");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    });
  });
});

test.describe("the activity panel", () => {
  test("shows the stages and counts while a run is going, a log of ids and verdicts only, then the report", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Use sample lecture" }).click();
    await page.getByRole("button", { name: "Make study aids" }).click();

    const panel = page.getByRole("complementary", { name: "Verification activity" });
    await expect(panel.getByRole("list").filter({ hasText: "Reading your notes" })).toBeVisible();
    await expect(panel.getByText(/drafted · .* checked/)).toBeVisible();
    // exactly one Cancel, on the round button
    await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(1);

    await panel.getByRole("tab", { name: "Details" }).click();
    const log = panel.getByRole("log", { name: "Activity log" });
    await expect(log).toContainText(/Drafted (summary point|glossary entry|question) /);
    // ids, kinds and verdict words: never the notes' own words or an item's text
    const text = (await log.textContent()) ?? "";
    expect(text).not.toMatch(/dispatcher|ready queue|turnaround|Round Robin|CPU scheduling/i);

    await page.waitForURL(/\/runs\//);
    await expect(page.getByRole("heading", { level: 1, name: SAMPLE_TITLE })).toBeVisible();
    // the session went back to idle: no run is "in progress" on the results page
    await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    await page.getByRole("button", { name: "Show verification activity" }).click();
    await expect(panel.getByText(/Counts reconcile: all \d+ generated items/)).toBeVisible();
  });

  test("a run started on the home page keeps going while the history is searched", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Use sample lecture" }).click();
    await page.getByRole("button", { name: "Make study aids" }).click();
    await search(page).fill("anything");
    await page.waitForURL(/\/runs\//);
  });
});

test.describe("the composer", () => {
  test("Enter adds a line; Ctrl+Enter makes the study aids", async ({ page }) => {
    await page.goto("/");
    await notes(page).click();
    await page.keyboard.type("First line");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second line");
    await expect(notes(page)).toHaveValue("First line\nSecond line");
    await expect(page).toHaveURL("/");

    await page.getByRole("button", { name: "Use sample lecture" }).click();
    await expect(notes(page)).toBeFocused();
    await page.keyboard.press("Control+Enter");
    await page.waitForURL(/\/runs\//);
  });

  test("the box grows with the notes", async ({ page }) => {
    await page.goto("/");
    const before = (await notes(page).boundingBox())?.height ?? 0;
    await page.getByRole("button", { name: "Use sample lecture" }).click();
    const after = (await notes(page).boundingBox())?.height ?? 0;
    expect(after).toBeGreaterThan(before + 100);
    // but never more than 40% of the window
    const viewport = page.viewportSize()?.height ?? 0;
    expect(after).toBeLessThanOrEqual(viewport * 0.4 + 2);
  });

  test("a chosen file shows as a chip, replaces the pasted text, and can be removed", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("Or upload a file").setInputFiles("fixtures/lecture7.md");
    await expect(page.getByText(/lecture7\.md \(\d+ KB\)/)).toBeVisible();
    await page.getByRole("button", { name: "Remove file" }).click();
    await expect(page.getByText(/lecture7\.md/)).toHaveCount(0);
    await page.getByRole("button", { name: "Make study aids" }).click();
    await expect(appAlert(page)).toContainText("Paste your notes");
  });

  test("dropping a file on the composer picks it, and a wrong type is refused in words", async ({
    page,
  }) => {
    await page.goto("/");
    const drop = async (name: string, mime: string) => {
      const data = await page.evaluateHandle(
        ([n, m]) => {
          const dt = new DataTransfer();
          dt.items.add(
            new File(["# Title\n\nSome notes here. More notes follow."], n as string, {
              type: m as string,
            }),
          );
          return dt;
        },
        [name, mime],
      );
      await page.locator(".nb-composer").dispatchEvent("drop", { dataTransfer: data });
    };
    await drop("notes.exe", "application/octet-stream");
    await expect(appAlert(page)).toContainText("not supported");
    await drop("dropped.md", "text/markdown");
    await expect(page.getByText(/dropped\.md/)).toBeVisible();
    await expect(page.getByText("File added.")).toBeVisible();
  });

  test("dictation is offered only when the browser reports an on-device recognizer", async ({
    page,
  }) => {
    // Automated browsers never probe the speech API (it crashes headless Chromium), so there is no button.
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Dictate notes" })).toHaveCount(0);
  });
});

test.describe("the bell", () => {
  test("counts a run that finished while the page was open, lists it, and closes with Escape", async ({
    page,
  }) => {
    await runSample(page);
    const bell = page.getByRole("button", { name: "Notifications, 1 new" });
    await expect(bell).toBeVisible();
    await bell.click();
    const pop = page.getByRole("region", { name: "Recent activity" });
    await expect(
      pop.getByRole("link", { name: /Lecture 7: CPU Scheduling Basics finished: \d+ supported/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(pop).toBeHidden();
    await expect(page.getByRole("button", { name: "Notifications" })).toBeFocused();
  });
});

test.describe("accessibility of the new states", () => {
  const THEMES = [
    ["Light", "light"],
    ["Dark", "dark"],
    ["High contrast", "high contrast"],
  ] as const;

  for (const [label, name] of THEMES) {
    test(`home is clean in the ${name} theme: idle, typed, file chosen, popovers open`, async ({
      page,
    }) => {
      await page.goto("/");
      await openSettings(page);
      await page.getByRole("radio", { name: label }).check();
      await expectNoSeriousViolations(page, `${name} home with settings open`);
      await page.keyboard.press("Escape");
      await expectNoSeriousViolations(page, `${name} home idle`);

      await page.getByRole("button", { name: "Use sample lecture" }).click();
      await expectNoSeriousViolations(page, `${name} home typed`);

      await page.getByLabel("Or upload a file").setInputFiles("fixtures/lecture7.md");
      await expectNoSeriousViolations(page, `${name} home with a file`);

      await page.getByRole("button", { name: /^Notifications/ }).click();
      await expectNoSeriousViolations(page, `${name} home with notifications open`);
    });
  }

  test("running state, history with rows and the Project view", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Use sample lecture" }).click();
    await page.getByRole("button", { name: "Make study aids" }).click();
    await expect(page.getByRole("heading", { name: "Working on your notes" })).toBeVisible();
    await expectNoSeriousViolations(page, "running with the panel open");
    await page.getByRole("tab", { name: "Details" }).click();
    await expectNoSeriousViolations(page, "running, activity log");
    await page.waitForURL(/\/runs\//);
    await expect(rowLinks(page)).toHaveCount(1);
    await expectNoSeriousViolations(page, "results with history");
    await history(page).getByRole("tab", { name: "Project" }).click();
    await expectNoSeriousViolations(page, "history, project view");
  });

  test.describe("at 320 px and at 200% text", () => {
    test.use({ viewport: { width: 320, height: 640 } });

    test("home, with the history drawer open", async ({ page }) => {
      await page.goto("/");
      await expectNoSeriousViolations(page, "home 320");
      await page.getByRole("button", { name: "Show history" }).click();
      await expectNoSeriousViolations(page, "history drawer 320");
    });

    test("home at 200% text", async ({ page }) => {
      await page.goto("/");
      await openSettings(page);
      await page.getByLabel(/^Text size/).fill("200");
      await page.keyboard.press("Escape");
      await expectNoSeriousViolations(page, "home 320 at 200% text");
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(wide).toBe(false);
    });
  });

  test("forced colours: the composer, rows and tabs keep real edges", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto("/");
    await expectNoSeriousViolations(page, "forced colours home");
    const edges = await page.evaluate(() => {
      const width = (sel: string): number =>
        Number.parseFloat(getComputedStyle(document.querySelector(sel) as Element).borderTopWidth);
      return [width(".nb-composer"), width(".nb-seg"), width(".nb-send"), width(".nb-icon-btn")];
    });
    for (const w of edges) expect(w).toBeGreaterThanOrEqual(1);
  });
});
