import type { DraftItem, QuestionDraft } from "../generate/types";
import type { Embedder } from "../ports/embed";
import type { Verdict } from "../schema/items";
import { normalizeForMatch } from "../text";
import { toEnvelope, type Verification } from "../verify";
import type { RemovalKind, RemovedItem, RunWarning, ShownItem } from "./types";

/** Higher is better. Used to pick the better of two attempts and the better of two duplicates. */
export const VERDICT_RANK: Record<Verdict, number> = {
  SUPPORTED: 3,
  PARTIAL: 2,
  UNSUPPORTED: 1,
  CONTRADICTED: 0,
};

/** What a draft finally is, after at most one repair. */
export interface Final {
  draft: DraftItem;
  v: Verification;
  repaired: boolean;
}

/** One draft's whole life. Keeping it in one place is what makes the report reconcile. */
export interface Entry {
  original: DraftItem;
  v1: Verification;
  final: Final;
  repair?: {
    outcome: "improved" | "unchanged" | "rejected" | "failed";
    note?: string;
  };
}

const COSINE_DUPLICATE = 0.95;
const TYPE_ORDER: Record<DraftItem["type"], number> = {
  summary_point: 0,
  glossary: 1,
  question: 2,
};
export const DEFAULT_QUESTION_COUNT = 5;

const isShown = (verdict: Verdict): boolean => verdict === "SUPPORTED" || verdict === "PARTIAL";
const idNumber = (id: string): number => Number(/-(\d+)$/.exec(id)?.[1] ?? 0);
const byDraftOrder = (a: Entry, b: Entry): number =>
  idNumber(a.original.itemId) - idNumber(b.original.itemId);

/** The text two items are compared on to decide they say the same thing. */
function dedupeText(d: DraftItem): string {
  return d.type === "glossary" ? `${d.term}: ${d.text}` : d.text;
}

const better = (a: Entry, b: Entry): Entry => {
  const diff = VERDICT_RANK[a.final.v.verdict] - VERDICT_RANK[b.final.v.verdict];
  if (diff !== 0) return diff > 0 ? a : b;
  return byDraftOrder(a, b) <= 0 ? a : b;
};

const dot = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

/**
 * Items of the same kind that say the same thing: equal after normalisation (glossary: same term),
 * or, when an embedder is available, cosine >= 0.95. The better item is kept.
 */
async function findDuplicates(
  entries: readonly Entry[],
  embedder: Embedder | undefined,
): Promise<{ dropped: Map<Entry, Entry>; warning?: RunWarning }> {
  const dropped = new Map<Entry, Entry>();
  let warning: RunWarning | undefined;

  for (const type of ["summary_point", "glossary", "question"] as const) {
    const group = entries.filter((e) => e.final.draft.type === type);

    // 1. Exact, after normalisation.
    const seen = new Map<string, Entry>();
    for (const e of group) {
      const d = e.final.draft;
      const key = normalizeForMatch(d.type === "glossary" ? d.term : d.text);
      const other = seen.get(key);
      if (!other) {
        seen.set(key, e);
        continue;
      }
      const keep = better(e, other);
      seen.set(key, keep);
      dropped.set(keep === e ? other : e, keep);
    }

    // 2. Near-identical meaning.
    const alive = group.filter((e) => !dropped.has(e));
    if (!embedder || alive.length < 2) continue;
    try {
      const vectors = await embedder.embed(alive.map((e) => dedupeText(e.final.draft)));
      for (let i = 0; i < alive.length; i++) {
        for (let j = i + 1; j < alive.length; j++) {
          const a = alive[i];
          const b = alive[j];
          const va = vectors[i];
          const vb = vectors[j];
          if (!a || !b || !va || !vb || dropped.has(a) || dropped.has(b)) continue;
          if (dot(va, vb) >= COSINE_DUPLICATE) {
            const keep = better(a, b);
            dropped.set(keep === a ? b : a, keep);
          }
        }
      }
    } catch (e) {
      warning = {
        code: "duplicate_detection_limited",
        message: `Near-duplicate detection by meaning was unavailable (${e instanceof Error ? e.message : String(e)}); only exact repeats were removed.`,
      };
    }
  }
  return { dropped, warning };
}

/**
 * Choose `n` questions from the verified candidates. SUPPORTED ones first, PARTIAL (flagged) only
 * to fill the gap, never padding. Within a tier, spread the question types and avoid asking twice
 * about the same sentence.
 */
export function selectQuestions(
  candidates: readonly Entry[],
  n: number,
): { picked: Entry[]; rest: Entry[] } {
  const picked: Entry[] = [];
  const typeCount = new Map<string, number>();
  const usedIds = new Set<string>();

  /** Lower is better: least-used type, then fewest already-asked sentences, then draft order. */
  const score = (e: Entry): number[] => {
    const q = e.final.draft as QuestionDraft;
    return [
      typeCount.get(q.qtype) ?? 0,
      q.answerSourceIds.filter((id) => usedIds.has(id)).length,
      idNumber(e.original.itemId),
    ];
  };
  const lexicographic = (a: number[], b: number[]): number => {
    for (let i = 0; i < a.length; i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };

  const pickFrom = (pool: Entry[]): void => {
    while (picked.length < n && pool.length > 0) {
      pool.sort((a, b) => lexicographic(score(a), score(b)));
      const [chosen] = pool.splice(0, 1);
      if (!chosen) break;
      const q = chosen.final.draft as QuestionDraft;
      picked.push(chosen);
      typeCount.set(q.qtype, (typeCount.get(q.qtype) ?? 0) + 1);
      for (const id of q.answerSourceIds) usedIds.add(id);
    }
  };

  const sorted = [...candidates].sort(byDraftOrder);
  const supported = sorted.filter((e) => e.final.v.verdict === "SUPPORTED");
  const partial = sorted.filter((e) => e.final.v.verdict === "PARTIAL");
  pickFrom(supported);
  pickFrom(partial);

  const chosen = new Set(picked);
  return { picked: picked.sort(byDraftOrder), rest: sorted.filter((e) => !chosen.has(e)) };
}

const shownFrom = (e: Entry): ShownItem => ({
  envelope: toEnvelope(e.final.draft, e.final.v),
  flagged: e.final.v.verdict === "PARTIAL",
  repaired: e.final.repaired,
  ...(e.final.repaired && e.original.text !== e.final.draft.text
    ? { originalText: e.original.text }
    : {}),
});

const removedFrom = (
  e: Entry,
  kind: RemovalKind,
  reasons: string[],
  duplicateOf?: string,
): RemovedItem => ({
  envelope: toEnvelope(e.final.draft, e.final.v),
  kind,
  reasons: reasons.length > 0 ? reasons : ["No supporting evidence was found."],
  repairAttempted: e.repair !== undefined,
  ...(e.repair?.note ? { repairNote: e.repair.note } : {}),
  ...(duplicateOf ? { duplicateOf } : {}),
});

export interface Assembled {
  summary: ShownItem[];
  glossary: ShownItem[];
  questions: ShownItem[];
  removed: RemovedItem[];
  warnings: RunWarning[];
}

/**
 * Turn finished entries into what the student sees and what is listed as removed. Every entry ends
 * in exactly one of the two, so nothing disappears silently.
 */
export async function assemble(
  entries: readonly Entry[],
  options: { questionCount: number; embedder?: Embedder },
): Promise<Assembled> {
  const removed: RemovedItem[] = [];
  const warnings: RunWarning[] = [];
  const candidates: Entry[] = [];

  for (const e of entries) {
    const verdict = e.final.v.verdict;
    if (isShown(verdict)) candidates.push(e);
    else {
      removed.push(
        removedFrom(
          e,
          verdict === "CONTRADICTED" ? "contradicted" : "unsupported",
          e.final.v.reasons,
        ),
      );
    }
  }

  const { dropped, warning } = await findDuplicates(candidates, options.embedder);
  if (warning) warnings.push(warning);
  for (const [dup, keep] of dropped) {
    removed.push(
      removedFrom(
        dup,
        "duplicate",
        [`Duplicate of ${keep.original.itemId}.`],
        keep.original.itemId,
      ),
    );
  }
  const unique = candidates.filter((e) => !dropped.has(e));

  const ofType = (type: DraftItem["type"]): Entry[] =>
    unique.filter((e) => e.final.draft.type === type).sort(byDraftOrder);

  const { picked, rest } = selectQuestions(ofType("question"), options.questionCount);
  for (const e of rest) {
    removed.push(
      removedFrom(e, "surplus", [
        `A valid question that was not needed: ${options.questionCount} questions were already chosen.`,
      ]),
    );
  }
  if (picked.length < options.questionCount) {
    warnings.push({
      code: "few_questions",
      message: `Only ${picked.length} of ${options.questionCount} questions could be supported by the notes.`,
    });
  }

  return {
    summary: ofType("summary_point").map(shownFrom),
    glossary: ofType("glossary").map(shownFrom),
    questions: picked.map(shownFrom),
    removed: removed.sort(
      (a, b) =>
        TYPE_ORDER[a.envelope.type] - TYPE_ORDER[b.envelope.type] ||
        idNumber(a.envelope.itemId) - idNumber(b.envelope.itemId),
    ),
    warnings,
  };
}
