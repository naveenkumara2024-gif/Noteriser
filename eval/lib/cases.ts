import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Type from "typebox";
import Value from "typebox/value";
import type { DraftItem } from "../../src/core/generate/types";
import { parseDocument } from "../../src/core/ingest";
import type { SourceDoc } from "../../src/core/schema/source";
import { quoteExists } from "../../src/core/verify";

export const FAILURE_TYPES = [
  "invented_stat",
  "outside_fact",
  "reversed_meaning",
  "overgeneralisation",
  "fake_quote",
  "number_altered",
  "negation_dropped",
  "scope_shift",
] as const;
export type FailureType = (typeof FAILURE_TYPES)[number];

export type Split = "dev" | "test";

const CaseDraft = Type.Object({
  type: Type.Union([Type.Literal("summary_point"), Type.Literal("glossary")]),
  /** Glossary drafts only: the term the text defines. */
  term: Type.Optional(Type.String({ minLength: 1 })),
  text: Type.String({ minLength: 1 }),
  sourceIds: Type.Array(Type.String({ pattern: "^S[1-9][0-9]*\\.[1-9][0-9]*$" }), { minItems: 1 }),
  evidenceQuote: Type.String({ minLength: 1 }),
  label: Type.Union([Type.Literal("good"), Type.Literal("bad")]),
  // Spelled out: a union built by mapping over an array loses its literal types in TypeBox.
  failureType: Type.Union([
    Type.Literal("invented_stat"),
    Type.Literal("outside_fact"),
    Type.Literal("reversed_meaning"),
    Type.Literal("overgeneralisation"),
    Type.Literal("fake_quote"),
    Type.Literal("number_altered"),
    Type.Literal("negation_dropped"),
    Type.Literal("scope_shift"),
    Type.Null(),
  ]),
});
export type CaseDraft = Type.Static<typeof CaseDraft>;

const EvalCaseSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  split: Type.Union([Type.Literal("dev"), Type.Literal("test"), Type.Literal("regression")]),
  subject: Type.String(),
  topic: Type.String(),
  /** Lecture notes as Markdown: `# title`, then `## section` headings with prose. */
  notes: Type.String({ minLength: 1 }),
  drafts: Type.Array(CaseDraft, { minItems: 1 }),
});
export type EvalCase = Type.Static<typeof EvalCaseSchema>;

/** The fixed rule: sorted by id, even position -> dev, odd position -> test. Reproducible, not tuned. */
export const splitFor = (index: number): Split => (index % 2 === 0 ? "dev" : "test");

export const CASES_DIR = resolve(process.cwd(), "eval/cases");
export const REGRESSIONS_DIR = resolve(process.cwd(), "eval/regressions");

/** Reads every `*.json` in a folder, checking its shape. Sorted by id so the split rule is stable. */
export function loadCaseDir(dir: string): EvalCase[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const cases = files.map((file) => {
    const raw: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
    if (!Value.Check(EvalCaseSchema, raw)) {
      const why = [...Value.Errors(EvalCaseSchema, raw)]
        .slice(0, 3)
        .map((e) => `${e.instancePath || "/"}: ${e.message}`)
        .join("; ");
      throw new Error(`${file} is not a valid case: ${why}`);
    }
    return raw;
  });
  return cases.sort((a, b) => a.id.localeCompare(b.id));
}

export const loadCases = (): EvalCase[] => loadCaseDir(CASES_DIR);
export const loadRegressions = (): EvalCase[] => loadCaseDir(REGRESSIONS_DIR);

/** One case's drafts as verifier input, ids `<case>-d<n>`. They are static: nothing is generated. */
export function toDraftItems(c: EvalCase, doc: SourceDoc): DraftItem[] {
  const known = new Set(doc.sentences.map((s) => s.id));
  return c.drafts.map((d, i): DraftItem => {
    const base = {
      itemId: `${c.id}-d${i + 1}`,
      scope: "eval",
      sourceIds: d.sourceIds,
      evidenceQuote: d.evidenceQuote,
      text: d.text,
      idsExist: d.sourceIds.every((id) => known.has(id)),
      problems: [],
    };
    return d.type === "glossary"
      ? { ...base, type: "glossary", term: d.term ?? "" }
      : { ...base, type: "summary_point" };
  });
}

export async function parseCase(c: EvalCase): Promise<SourceDoc> {
  const parsed = await parseDocument({ kind: "text", text: c.notes });
  if (!parsed.ok) throw new Error(`${c.id}: notes do not parse (${parsed.error.message})`);
  return parsed.value;
}

export interface CaseSetRules {
  minCases: number;
  minGoodPerCase: number;
  minBadPerCase: number;
  minPerFailureType: number;
}

export const RULES: CaseSetRules = {
  minCases: 20,
  minGoodPerCase: 2,
  minBadPerCase: 2,
  minPerFailureType: 5,
};

/**
 * Checks a case set against the stage's rules and against itself. Every problem is a sentence, so
 * a failure says which case and draft to fix. It never looks at a verifier result.
 */
export async function checkCases(
  cases: readonly EvalCase[],
  options: { rules?: CaseSetRules | null; requireSplitRule?: boolean } = {},
): Promise<string[]> {
  const problems: string[] = [];
  const rules = options.rules === undefined ? RULES : options.rules;

  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) problems.push(`${c.id}: duplicate case id`);
    ids.add(c.id);
  }
  if (rules && cases.length < rules.minCases) {
    problems.push(`only ${cases.length} cases; at least ${rules.minCases} are required`);
  }

  const counts = new Map<FailureType, number>();
  const texts = new Set<string>();

  for (const [index, c] of cases.entries()) {
    if (options.requireSplitRule && c.split !== splitFor(index)) {
      problems.push(
        `${c.id}: split is ${c.split} but the alternating rule says ${splitFor(index)}`,
      );
    }
    const doc = await parseCase(c);
    const known = new Map(doc.sentences.map((s) => [s.id, s]));

    const good = c.drafts.filter((d) => d.label === "good").length;
    const bad = c.drafts.length - good;
    if (rules && good < rules.minGoodPerCase)
      problems.push(`${c.id}: ${good} good drafts (need ${rules.minGoodPerCase})`);
    if (rules && bad < rules.minBadPerCase)
      problems.push(`${c.id}: ${bad} bad drafts (need ${rules.minBadPerCase})`);

    for (const [i, d] of c.drafts.entries()) {
      const where = `${c.id}-d${i + 1}`;
      if (d.type === "glossary" && !d.term)
        problems.push(`${where}: glossary draft without a term`);
      if (d.label === "good" && d.failureType !== null)
        problems.push(`${where}: a good draft has a failureType`);
      if (d.label === "bad" && d.failureType === null)
        problems.push(`${where}: a bad draft has no failureType`);
      if (d.failureType) counts.set(d.failureType, (counts.get(d.failureType) ?? 0) + 1);

      const missing = d.sourceIds.filter((id) => !known.has(id));
      if (missing.length > 0) {
        problems.push(`${where}: cites ${missing.join(", ")}, which is not in the notes`);
        continue;
      }
      // Only fake_quote drafts may have a quote that is not in the cited sentences; every other
      // draft must have a real quote, so it tests the other checks and not the quote check.
      const quote = quoteExists(d.evidenceQuote, doc.sentences, d.sourceIds);
      if (d.failureType === "fake_quote" && quote.ok) {
        problems.push(
          `${where}: a fake_quote draft whose quote is actually in the cited sentences`,
        );
      }
      if (d.failureType !== "fake_quote" && !quote.ok) {
        problems.push(
          `${where}: its quote is not in the cited sentences (${quote.reason ?? "no match"})`,
        );
      }
      const key = `${c.id}|${d.text}`;
      if (texts.has(key)) problems.push(`${where}: duplicate draft text`);
      texts.add(key);
    }
  }

  if (rules) {
    for (const t of FAILURE_TYPES) {
      const n = counts.get(t) ?? 0;
      if (n < rules.minPerFailureType) {
        problems.push(`failure type ${t} appears ${n} times (need ${rules.minPerFailureType})`);
      }
    }
  }
  return problems;
}

/** Counts for reports: drafts by label and failure type, per split. */
export function describeCases(cases: readonly EvalCase[]) {
  const out = { cases: cases.length, good: 0, bad: 0, byType: {} as Record<string, number> };
  for (const c of cases) {
    for (const d of c.drafts) {
      if (d.label === "good") out.good++;
      else out.bad++;
      if (d.failureType) out.byType[d.failureType] = (out.byType[d.failureType] ?? 0) + 1;
    }
  }
  return out;
}
