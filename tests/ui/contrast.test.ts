import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Reads the app shell's colour tokens straight out of globals.css and checks every pair that is
 * ever drawn on top of each other, in every theme block. A bad pair fails the build, so the
 * reference design's soft grey-on-grey cannot creep back in.
 */
const CSS = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

interface Block {
  selector: string;
  vars: Record<string, string>;
}

function blocks(): Block[] {
  const out: Block[] = [];
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const vars: Record<string, string> = {};
    for (const d of (m[2] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      if (d[1] && d[2]) vars[d[1]] = d[2].trim();
    }
    if (vars["--frame-top"]) out.push({ selector: (m[1] ?? "").trim(), vars });
  }
  return out;
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const n = Number.parseInt(m[1], 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const all = blocks();
const isContrast = (b: Block): boolean => b.vars["--text"] === "#ffffff";

describe("the colour tokens are found", () => {
  it("covers light, dark (system and chosen) and high contrast (system and chosen)", () => {
    expect(all.length).toBeGreaterThanOrEqual(5);
    expect(all.filter(isContrast)).toHaveLength(2);
  });
});

describe.each(all.map((b, i) => [`${i + 1}: ${b.selector.replace(/\s+/g, " ")}`, b] as const))(
  "shell contrast, block %s",
  (_name, block) => {
    const v = (name: string): string => {
      const value = block.vars[name];
      if (!value) throw new Error(`${name} missing`);
      return value;
    };
    const backgrounds = ["--frame-top", "--frame-bottom", "--side-top", "--side-bottom"];
    const hc = isContrast(block);
    const text = hc ? 7 : 4.5;
    const large = hc ? 7 : 3;
    const edge = hc ? 7 : 3;

    it("body and muted text read on every surface (WCAG 1.4.3)", () => {
      for (const bg of backgrounds) {
        expect(ratio(v("--text"), v(bg)), `text on ${bg}`).toBeGreaterThanOrEqual(text);
        expect(ratio(v("--text-muted"), v(bg)), `muted on ${bg}`).toBeGreaterThanOrEqual(text);
      }
      for (const fill of ["--control-fill", "--control-active"]) {
        expect(ratio(v("--text"), v(fill)), `text on ${fill}`).toBeGreaterThanOrEqual(text);
        expect(ratio(v("--text-muted"), v(fill)), `muted on ${fill}`).toBeGreaterThanOrEqual(text);
      }
    });

    it("the headline is large text with at least 3:1 (7:1 in high contrast) against its background", () => {
      for (const bg of ["--frame-top", "--frame-bottom"]) {
        expect(ratio(v("--headline-fill"), v(bg)), `headline on ${bg}`).toBeGreaterThanOrEqual(
          large,
        );
      }
    });

    it("control edges and the focus ring are visible (WCAG 1.4.11)", () => {
      for (const bg of [...backgrounds, "--control-fill", "--control-active"]) {
        expect(ratio(v("--control-border"), v(bg)), `border on ${bg}`).toBeGreaterThanOrEqual(edge);
      }
      for (const bg of backgrounds) {
        expect(ratio(v("--accent"), v(bg)), `focus ring on ${bg}`).toBeGreaterThanOrEqual(3);
      }
    });

    it("the round action button's icon reads against both ends of its gradient", () => {
      for (const end of ["--send-top", "--send-bottom"]) {
        expect(ratio(v("--send-fg"), v(end)), `icon on ${end}`).toBeGreaterThanOrEqual(text);
      }
    });
  },
);
