import type { RunResult, ShownItem } from "../../src/core/pipeline";
import type { QuestionItem } from "../../src/core/schema/items";

export const SHEET_COLUMNS = [
  "case",
  "item_id",
  "type",
  "text",
  "answer",
  "cited_sentences",
  "verdict",
  "flagged",
  "reviewer1",
  "reviewer2",
  "notes",
] as const;
export type SheetColumn = (typeof SHEET_COLUMNS)[number];
export type SheetRow = Record<SheetColumn, string>;

export const LABELS = ["supported", "unsupported", "unclear"] as const;
export type Label = (typeof LABELS)[number];

/** RFC 4180: a field with a comma, quote or line break is quoted, with inner quotes doubled. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const field = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
  return `${rows.map((r) => r.map(field).join(",")).join("\n")}\n`;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "") || row.length > 1) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

function rowOf(caseId: string, result: RunResult, shown: ShownItem): SheetRow {
  const e = shown.envelope;
  const q = "qtype" in e ? (e as QuestionItem) : undefined;
  const sentences = new Map(result.doc?.sentences.map((s) => [s.id, s.text]));
  const cited = [...new Set([...e.sourceIds, ...(q?.answerSourceIds ?? [])])];
  const options = (q?.options ?? []).map((o, i) => ` ${"ABCD"[i] ?? i + 1}) ${o}`).join("");
  return {
    case: caseId,
    item_id: e.itemId,
    type: q ? `question (${q.qtype})` : e.type,
    text: oneLine(`${e.term ? `${e.term}: ` : ""}${e.text}${options}`),
    answer: q ? oneLine(q.answer) : "",
    cited_sentences: cited.map((id) => `${id}: ${sentences.get(id) ?? "?"}`).join(" | "),
    verdict: e.verdict,
    flagged: shown.flagged ? "yes" : "no",
    reviewer1: "",
    reviewer2: "",
    notes: "",
  };
}

/**
 * The rows two reviewers fill in: every item the app would SHOW for a case, with the sentences it
 * cites. For a question, "supported" means: answerable from the cited sentences alone, the answer
 * key is right, and there is no ambiguity. Removed items are not on the sheet (nobody sees them).
 */
export function reviewRowsFor(caseId: string, result: RunResult): SheetRow[] {
  return [...result.summary, ...result.glossary, ...result.questions].map((s) =>
    rowOf(caseId, result, s),
  );
}

export function sheetToCsv(rows: readonly SheetRow[]): string {
  return toCsv([[...SHEET_COLUMNS], ...rows.map((r) => SHEET_COLUMNS.map((c) => r[c]))]);
}

export function sheetFromCsv(text: string): SheetRow[] {
  const [header, ...body] = parseCsv(text);
  if (!header) return [];
  const missing = SHEET_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0)
    throw new Error(`The review sheet is missing columns: ${missing.join(", ")}`);
  return body.map((cells) => {
    const row = {} as SheetRow;
    for (const c of SHEET_COLUMNS) row[c] = cells[header.indexOf(c)] ?? "";
    return row;
  });
}

const asLabel = (s: string): Label | undefined => {
  const v = s.trim().toLowerCase();
  return (LABELS as readonly string[]).includes(v) ? (v as Label) : undefined;
};

export interface Kappa {
  n: number;
  observed: number;
  expected: number;
  /** Cohen's kappa; NaN when agreement by chance is already 1 (one label used throughout). */
  kappa: number;
}

/** Cohen's kappa between two raters over the rows both have labelled. */
export function cohenKappa(
  a: readonly (Label | undefined)[],
  b: readonly (Label | undefined)[],
): Kappa {
  const pairs = a.flatMap((x, i) => {
    const y = b[i];
    return x && y ? [[x, y] as const] : [];
  });
  const n = pairs.length;
  if (n === 0) return { n: 0, observed: 0, expected: 0, kappa: Number.NaN };
  const observed = pairs.filter(([x, y]) => x === y).length / n;
  let expected = 0;
  for (const label of LABELS) {
    const pa = pairs.filter(([x]) => x === label).length / n;
    const pb = pairs.filter(([, y]) => y === label).length / n;
    expected += pa * pb;
  }
  return {
    n,
    observed,
    expected,
    kappa: expected === 1 ? Number.NaN : (observed - expected) / (1 - expected),
  };
}

export interface HumanMetrics {
  rows: number;
  /** Rows both reviewers have labelled. */
  labelled: number;
  kappa: Kappa;
  /** Shown items both reviewers judge supported. Lore target >= 95%. */
  faithfulness: number;
  /** Shown items at least one reviewer judges unsupported. Lore target <= 2%. */
  unsupportedSlip: number;
  /** Questions both reviewers judge answerable, correct and unambiguous. Lore target >= 90%. */
  questionQuality: number | null;
  /** Of items the verifier marked SUPPORTED, the share both reviewers also judge supported. */
  verifierSupportedAgreement: number | null;
  /** Items where the reviewers disagree or find the item unclear (needs adjudication). */
  contested: number;
}

/** The lore's human-judged metrics (section 8.5) from a filled review sheet. Unlabelled rows are ignored. */
export function humanMetrics(rows: readonly SheetRow[]): HumanMetrics {
  const r1 = rows.map((r) => asLabel(r.reviewer1));
  const r2 = rows.map((r) => asLabel(r.reviewer2));
  const both = rows
    .map((row, i) => ({ row, a: r1[i], b: r2[i] }))
    .filter(
      (x): x is { row: SheetRow; a: Label; b: Label } => x.a !== undefined && x.b !== undefined,
    );

  const share = (k: number, n: number): number => (n === 0 ? Number.NaN : k / n);
  const questions = both.filter((x) => x.row.type.startsWith("question"));
  const verifierOk = both.filter((x) => x.row.verdict === "SUPPORTED");
  return {
    rows: rows.length,
    labelled: both.length,
    kappa: cohenKappa(r1, r2),
    faithfulness: share(
      both.filter((x) => x.a === "supported" && x.b === "supported").length,
      both.length,
    ),
    unsupportedSlip: share(
      both.filter((x) => x.a === "unsupported" || x.b === "unsupported").length,
      both.length,
    ),
    questionQuality:
      questions.length === 0
        ? null
        : share(
            questions.filter((x) => x.a === "supported" && x.b === "supported").length,
            questions.length,
          ),
    verifierSupportedAgreement:
      verifierOk.length === 0
        ? null
        : share(
            verifierOk.filter((x) => x.a === "supported" && x.b === "supported").length,
            verifierOk.length,
          ),
    contested: both.filter((x) => x.a !== x.b || x.a === "unclear").length,
  };
}
