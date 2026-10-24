import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export const SRC = resolve(process.cwd(), "src");
export const PI_AI = "@earendil-works/pi-ai";

const IMPORT_RE =
  /(?:import|export)\s[^"'`;]*?\sfrom\s*["']([^"']+)["']|import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

/** Core may not depend on frameworks, SDKs, or any adapter layer. */
const CORE_FORBIDDEN_PACKAGES = [
  "next",
  "react",
  "react-dom",
  PI_AI,
  "@huggingface/transformers",
  "node:sqlite",
];
const CORE_FORBIDDEN_LAYERS = ["app", "ui", "llm", "nlp", "store", "config"];

export function extractImports(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (spec) found.push(spec);
  }
  return found;
}

function isPackage(spec: string, name: string): boolean {
  return spec === name || spec.startsWith(`${name}/`);
}

/** First path segment under src/ that a specifier points into, or undefined for packages. */
function layerOf(spec: string, fromFile: string): string | undefined {
  let abs: string | undefined;
  if (spec.startsWith("@/")) abs = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) abs = resolve(dirname(fromFile), spec);
  if (!abs) return undefined;
  const rel = relative(SRC, abs);
  if (rel.startsWith("..")) return undefined;
  return rel.split(sep)[0];
}

export function findViolations(file: string, source: string): string[] {
  const layer = relative(SRC, file).split(sep)[0];
  const out: string[] = [];

  for (const spec of extractImports(source)) {
    if (layer === "core") {
      if (CORE_FORBIDDEN_PACKAGES.some((p) => isPackage(spec, p))) {
        out.push(`core must not import "${spec}"`);
      }
      const target = layerOf(spec, file);
      if (target && CORE_FORBIDDEN_LAYERS.includes(target)) {
        out.push(`core must not import from src/${target} ("${spec}")`);
      }
    }
    if (layer !== "llm" && isPackage(spec, PI_AI)) {
      out.push(`only src/llm may import ${PI_AI} ("${spec}")`);
    }
  }
  return out;
}

export function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx|mts)$/.test(e.name) ? [p] : [];
  });
}
