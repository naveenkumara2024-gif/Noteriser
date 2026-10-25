import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect } from "vitest";

const DIR = resolve(process.cwd(), "tests/golden");

/**
 * Compares `actual` with a committed golden file. Goldens change only on purpose: run
 * `UPDATE_GOLDEN=1 npx vitest run tests/core/export` to rewrite them, then read the diff.
 */
export function expectGolden(name: string, actual: string): void {
  const path = resolve(DIR, name);
  if (process.env.UPDATE_GOLDEN === "1") {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, actual);
    return;
  }
  if (!existsSync(path)) {
    throw new Error(`Missing golden file ${name}. Run with UPDATE_GOLDEN=1 to create it.`);
  }
  expect(actual).toBe(readFileSync(path, "utf8"));
}
