import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const SAMPLE_TITLE = "Lecture 7: CPU Scheduling Basics";

/** Home -> sample lecture -> run -> results page. Returns the results page path. */
export async function runSample(page: Page, options: { plain?: boolean } = {}): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "Use sample lecture" }).click();
  if (options.plain) {
    await page.getByRole("checkbox", { name: "Also write plain-language versions" }).check();
  }
  await page.getByRole("button", { name: "Make study aids" }).click();
  await page.waitForURL(/\/runs\/[\w-]+$/);
  await expect(page.getByRole("heading", { level: 1, name: SAMPLE_TITLE })).toBeVisible();
  return new URL(page.url()).pathname;
}

/** The page's own alert, not Next's empty route announcer (which is also role="alert"). */
export const appAlert = (page: Page) =>
  page.locator('[role="alert"]:not(#__next-route-announcer__)');

/** Sentence lines in the Source column or an open disclosure that are currently highlighted and on screen. */
export const citedLines = (page: Page) => page.locator('[aria-current="true"]:visible');

/** Opens the Display settings panel. */
export async function openSettings(page: Page) {
  const panel = page.locator("details", {
    has: page.locator("summary", { hasText: "Display settings" }),
  });
  if (!(await panel.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await page.locator("summary", { hasText: "Display settings" }).click();
  }
}

/** What the focused element is called, as a person would hear it. */
export const focusedName = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return "";
    const labelled = (el as HTMLInputElement).labels?.[0]?.textContent;
    return (el.getAttribute("aria-label") ?? labelled ?? el.textContent ?? "").trim();
  });

/** The focused element must show a ring: an outline of real width and style. */
export async function expectVisibleFocus(page: Page) {
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, width: Number.parseFloat(s.outlineWidth) };
  });
  expect(ring.style).not.toBe("none");
  expect(ring.width).toBeGreaterThanOrEqual(2);
}

/** Presses Tab until the focused element's name matches, checking the focus ring at every stop. */
export async function tabTo(page: Page, name: string | RegExp, limit = 80) {
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

/**
 * Stands in for the browser's speech engine, which headless Chromium cannot play: it records what
 * would be said and what was asked of the engine, and utterances end only when the test says so.
 */
export async function stubSpeech(page: Page) {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    const calls: string[] = [];
    let current: {
      onend?: (() => void) | null;
      onstart?: (() => void) | null;
      onboundary?: ((e: { name: string; charIndex: number }) => void) | null;
    } | null = null;
    class Utterance {
      rate = 1;
      voice: unknown = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onboundary: ((e: { name: string; charIndex: number }) => void) | null = null;
      constructor(public text: string) {}
    }
    const synth = {
      speak(u: Utterance) {
        spoken.push(u.text);
        calls.push("speak");
        current = u;
        setTimeout(() => u.onstart?.(), 0);
      },
      cancel() {
        calls.push("cancel");
        current = null;
      },
      pause() {
        calls.push("pause");
      },
      resume() {
        calls.push("resume");
      },
      getVoices: () => [{ voiceURI: "mock-1", name: "Mock Voice", lang: "en-GB" }],
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: Utterance,
      configurable: true,
    });
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    Object.defineProperty(window, "__tts", {
      value: {
        spoken,
        calls,
        boundary(charIndex: number) {
          current?.onboundary?.({ name: "word", charIndex });
        },
        finish() {
          const u = current;
          current = null;
          u?.onend?.();
        },
      },
    });
  });
}

type TtsProbe = {
  spoken: string[];
  calls: string[];
  finish(): void;
  boundary(charIndex: number): void;
};
export const spoken = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...(window as unknown as { __tts: TtsProbe }).__tts.spoken]);
export const speechCalls = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...(window as unknown as { __tts: TtsProbe }).__tts.calls]);
export const finishUtterance = (page: Page) =>
  page.evaluate(() => (window as unknown as { __tts: TtsProbe }).__tts.finish());

/** Serious or critical violations (WCAG 2.2 A/AA rules and axe best practices), as readable strings. */
export async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

export async function expectNoSeriousViolations(page: Page, state: string) {
  expect(await seriousViolations(page), `axe violations on ${state}`).toEqual([]);
}
export const fireBoundary = (page: Page, charIndex: number) =>
  page.evaluate((i) => (window as unknown as { __tts: TtsProbe }).__tts.boundary(i), charIndex);
