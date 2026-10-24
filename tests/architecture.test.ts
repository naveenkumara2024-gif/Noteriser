import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { extractImports, findViolations, PI_AI, SRC, walk } from "./support/boundaries";

describe("import boundaries", () => {
  it("scans real source files", () => {
    expect(walk(SRC).length).toBeGreaterThan(0);
  });

  it("src/core is pure and only src/llm imports pi-ai", () => {
    const violations = walk(SRC).flatMap((file) =>
      findViolations(file, readFileSync(file, "utf8")).map((v) => `${relative(SRC, file)}: ${v}`),
    );
    expect(violations).toEqual([]);
  });
});

describe("boundary checker (guards against a vacuous pass)", () => {
  const coreFile = join(SRC, "core", "verify", "x.ts");
  const uiFile = join(SRC, "ui", "x.tsx");

  it("extracts all import forms", () => {
    const src = [
      `import a from "pkg-a";`,
      `import { b,\n  c } from 'pkg-b';`,
      `import type { T } from "pkg-c";`,
      `export * from "pkg-d";`,
      `import "pkg-e";`,
      `const m = await import("pkg-f");`,
      `const r = require("pkg-g");`,
    ].join("\n");
    expect(extractImports(src)).toEqual([
      "pkg-a",
      "pkg-b",
      "pkg-c",
      "pkg-d",
      "pkg-e",
      "pkg-f",
      "pkg-g",
    ]);
  });

  it("flags forbidden packages in core", () => {
    for (const pkg of [
      "next/server",
      "react",
      "react-dom/client",
      "@huggingface/transformers",
      "node:sqlite",
      PI_AI,
      `${PI_AI}/providers/all`,
    ]) {
      expect(findViolations(coreFile, `import x from "${pkg}";`).length).toBeGreaterThan(0);
    }
  });

  it("flags adapter layers in core via alias and relative paths", () => {
    expect(findViolations(coreFile, `import { x } from "@/llm/pi";`)).toHaveLength(1);
    expect(findViolations(coreFile, `import { x } from "../../nlp/nli";`)).toHaveLength(1);
    expect(findViolations(coreFile, `import { x } from "../../config/env";`)).toHaveLength(1);
  });

  it("allows core-to-core imports and ordinary packages", () => {
    expect(findViolations(coreFile, `import { x } from "../ports/llm";`)).toEqual([]);
    expect(findViolations(coreFile, `import Type from "typebox";`)).toEqual([]);
    expect(findViolations(coreFile, `import { y } from "node:path";`)).toEqual([]);
  });

  it("flags pi-ai outside src/llm but allows it inside", () => {
    expect(findViolations(uiFile, `import { Type } from "${PI_AI}";`)).toHaveLength(1);
    expect(findViolations(join(SRC, "llm", "pi.ts"), `import { Type } from "${PI_AI}";`)).toEqual(
      [],
    );
  });
});
