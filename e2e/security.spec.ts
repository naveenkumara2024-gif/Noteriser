import { expect, type Page, test } from "@playwright/test";
import { openSettings, runSample } from "./helpers";

const ORIGIN = "http://localhost:3100";

/** Everything the page asks the network for during `flow`, and every console complaint about CSP. */
async function watch(page: Page) {
  const urls: string[] = [];
  const cspProblems: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  page.on("console", (m) => {
    if (/content security policy|refused to (load|execute|apply|connect)/i.test(m.text())) {
      cspProblems.push(m.text());
    }
  });
  page.on("pageerror", (e) => {
    if (/content security policy/i.test(e.message)) cspProblems.push(e.message);
  });
  return { urls, cspProblems };
}

test.describe("response headers", () => {
  const CSP_DIRECTIVES = [
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "connect-src 'self'",
    "font-src 'self' data:",
  ];

  test("every page and API response carries CSP, nosniff, no-referrer and frame protection", async ({
    page,
    request,
  }) => {
    const path = await runSample(page);
    const id = path.split("/").pop();
    for (const url of ["/", path, "/api/runs/does-not-exist", `/api/runs/${id}/export?format=md`]) {
      const res = await request.get(url);
      const h = res.headers();
      const csp = h["content-security-policy"] ?? "";
      for (const d of CSP_DIRECTIVES) expect(csp, `${url}: ${d}`).toContain(d);
      // a policy that would allow any other origin would defeat the point
      expect(csp).not.toMatch(/https?:\/\//);
      expect(csp).not.toContain("*");
      expect(h["x-content-type-options"], url).toBe("nosniff");
      expect(h["referrer-policy"], url).toBe("no-referrer");
      expect(h["x-frame-options"], url).toBe("DENY");
      expect(h["permissions-policy"], url).toContain("camera=()");
    }
  });

  test("scripts are only from this origin (inline allowed for Next and the settings bootstrap)", async ({
    request,
  }) => {
    const csp = (await request.get("/")).headers()["content-security-policy"] ?? "";
    const script = /script-src ([^;]+)/.exec(csp)?.[1] ?? "";
    expect(script).toContain("'self'");
    expect(script).not.toContain("'unsafe-eval'"); // production build
  });
});

test.describe("no third parties", () => {
  test("a full session (run, results, plain language, export, feedback, print, settings) talks only to the app's own origin", async ({
    page,
  }) => {
    const seen = await watch(page);
    await runSample(page, { plain: true });
    await page.getByRole("radio", { name: "Plain language" }).check();
    await openSettings(page);
    await page.getByLabel("Font").selectOption("readable");
    await page.locator("summary", { hasText: "Export and print" }).click();
    await page.getByText(/^Removed items/).click();
    await page.locator("summary", { hasText: "Report a problem" }).first().click();
    await page.emulateMedia({ media: "print" });
    await page.waitForLoadState("networkidle");

    const hosts = new Set(
      seen.urls
        .filter((u) => !u.startsWith("data:") && !u.startsWith("blob:"))
        .map((u) => new URL(u).origin),
    );
    expect([...hosts]).toEqual([ORIGIN]);
    expect(seen.urls.length).toBeGreaterThan(5);
    // the bundled font is one of those same-origin requests, not a Google Fonts call
    expect(seen.urls.some((u) => /\.woff2/.test(u))).toBe(true);
    expect(seen.urls.some((u) => /fonts\.(googleapis|gstatic)\.com/.test(u))).toBe(false);
  });

  test("the same session raises no Content Security Policy violation", async ({ page }) => {
    const seen = await watch(page);
    await runSample(page, { plain: true });
    await page.getByRole("button", { name: "Reveal answer" }).first().click();
    await page.locator("summary", { hasText: "Export and print" }).click();
    await openSettings(page);
    await page.getByRole("radio", { name: "High contrast" }).check();
    await page.reload();
    expect(seen.cspProblems).toEqual([]);
  });

  test("nothing is stored in the browser beyond the display settings and the owner cookie", async ({
    page,
    context,
  }) => {
    await runSample(page, { plain: true });
    await openSettings(page);
    await page.getByRole("radio", { name: "Dark" }).check();

    const keys = await page.evaluate(() => [
      ...Object.keys(localStorage),
      ...Object.keys(sessionStorage),
    ]);
    expect(keys.every((k) => k === "noteriser.display.v1")).toBe(true);

    const cookies = await context.cookies();
    expect(cookies.length).toBeGreaterThan(0);
    for (const c of cookies) {
      expect(c.name).toMatch(/^nb_owner_/);
      expect(c.httpOnly).toBe(true);
      expect(c.sameSite).toBe("Strict");
    }
    const databases = await page.evaluate(async () => (await indexedDB.databases?.())?.length ?? 0);
    expect(databases).toBe(0);
  });

  test("the pages include no analytics, trackers or external scripts", async ({ page }) => {
    await runSample(page);
    const external = await page.evaluate(() =>
      [...document.querySelectorAll("script[src], link[href], img[src], iframe")]
        .map((el) => el.getAttribute("src") ?? el.getAttribute("href") ?? "")
        .filter((u) => /^https?:\/\//.test(u) && !u.startsWith(location.origin)),
    );
    expect(external).toEqual([]);
  });
});
