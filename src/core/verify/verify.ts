import type { DraftItem } from "../generate/types";
import type { Embedder } from "../ports/embed";
import { addUsage, type LlmClient, type Usage, ZERO_USAGE } from "../ports/llm";
import type { Nli } from "../ports/nli";
import type { ItemEnvelope, QuestionItem, Scores, Verdict } from "../schema/items";
import type { SourceDoc, SourceSentence } from "../schema/source";
import { mapPool } from "../util/pool";
import { claimOf } from "./claims";
import { buildSourceIndex, citationHint, closestSentences, type Match } from "./closest";
import { type DecideInputs, decide, isContradicted } from "./decide";
import { type PremiseUnit, scoreEntailment } from "./entailment";
import { buildVocab, findNovelEntities } from "./entities";
import { judgeClaim, judgeDistractors } from "./judge";
import { findOverGeneral } from "./overgeneral";
import { quoteExists } from "./quote";
import { THRESHOLDS, type Thresholds } from "./thresholds";

export interface VerifyDeps {
  nli: Nli;
  /** The judge role of this client is used; keep it a different model from the generator. */
  llm: LlmClient;
  /** Optional: only used to say which sentence a claim is closest to. */
  embedder?: Embedder;
  thresholds?: Thresholds;
  signal?: AbortSignal;
  /** Run every check even when the verdict is already settled. For evaluation; costs judge calls. */
  exhaustive?: boolean;
}

export interface DistractorFinding {
  option: string;
  /** True: the notes could support it, so the question is ambiguous. null: not reviewed. */
  couldBeCorrect: boolean | null;
  novelEntities: string[];
}

export interface Verification {
  itemId: string;
  verdict: Verdict;
  reasons: string[];
  /** A check failed to run; the run must show a "verifier degraded" notice. */
  degraded: boolean;
  scores: Scores;
  /** Raw entailment-model output behind `scores.entailment`; null when it did not run. */
  nli: { entailment: number; contradiction: number } | null;
  entities: { hard: string[]; soft: string[] };
  /** What the second reviewer said was unsupported. */
  judgeParts: string[];
  distractors: DistractorFinding[];
  closest: Match[];
  /** Judge tokens and cost for this item. */
  usage: Usage;
}

export interface Verifier {
  verify(item: DraftItem): Promise<Verification>;
  /** Items are verified `concurrency` at a time (default 4); results keep input order. */
  verifyAll(items: readonly DraftItem[], concurrency?: number): Promise<Verification[]>;
}

const DEFAULT_CONCURRENCY = 4;

export function createVerifier(doc: SourceDoc, deps: VerifyDeps): Verifier {
  const t = deps.thresholds ?? THRESHOLDS;
  const vocab = buildVocab(doc.sentences);
  const byId = new Map(doc.sentences.map((s) => [s.id, s]));
  const sections = new Map(doc.sections.map((s) => [s.number, s]));
  let indexPromise: ReturnType<typeof buildSourceIndex> | undefined;

  async function verify(item: DraftItem): Promise<Verification> {
    try {
      return await run(item);
    } catch (e) {
      // A bug must never become a SUPPORTED verdict or crash the run.
      return failure(item, `Verifier error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function run(item: DraftItem): Promise<Verification> {
    const claim = claimOf(item);

    // Check 1: citations and quote. For questions the answer's own sentences must exist too.
    let quote = quoteExists(item.evidenceQuote, doc.sentences, item.sourceIds);
    if (item.type === "question" && quote.ok) {
      const missing = item.answerSourceIds.filter((id) => !byId.has(id));
      if (missing.length > 0) {
        quote = {
          ok: false,
          missingIds: missing,
          reason: `The answer cites ${missing.join(", ")}, which ${missing.length === 1 ? "is" : "are"} not in the notes.`,
        };
      }
    }

    const premise = [...new Set(claim.citedIds)]
      .map((id) => byId.get(id))
      .filter((s): s is SourceSentence => s !== undefined)
      .sort((a, b) => a.position - b.position);
    const citedText = premise.map((s) => s.text).join(" ");

    // Checks 3 and wording (deterministic)
    const entities = findNovelEntities(claim.text, vocab);
    const overGeneral = findOverGeneral(claim.text, citedText);

    // Check 2 (local and cheap, so it always runs when there is something to compare with)
    let nli: DecideInputs["nli"] = { status: "skipped" };
    if (premise.length > 0) {
      const units: PremiseUnit[] = premise.map((s) => {
        const section = sections.get(s.section);
        return {
          text: s.text,
          section: s.section,
          // Placeholder titles we made up ("Notes", "Part 2") are not source text.
          heading: section && !section.generatedTitle ? section.title : null,
        };
      });
      const r = await scoreEntailment(deps.nli, units, claim.text);
      nli = r.ok
        ? { status: "ok", entailment: r.value.entailment, contradiction: r.value.contradiction }
        : { status: "failed", reason: r.error };
    }

    // Check 4 costs a model call, so skip it when the verdict is already decided.
    const settled =
      !quote.ok ||
      entities.hard.length > 0 ||
      isContradicted(nli, t) ||
      (nli.status === "ok" && nli.entailment < t.entailmentPartial);
    const askJudge = premise.length > 0 && (deps.exhaustive === true || !settled);

    let usage = ZERO_USAGE;
    let judge: DecideInputs["judge"] = { status: "skipped" };
    if (askJudge) {
      const r = await judgeClaim(deps.llm, claim.text, premise, deps.signal);
      if (r.ok) {
        judge = { status: "ok", ...r.value.result };
        usage = addUsage(usage, r.value.usage);
      } else {
        judge = { status: "failed", reason: `${r.error.code}: ${r.error.message}` };
        usage = addUsage(usage, r.error.usage);
      }
    }

    // Multiple choice: the "wrong" options must be wrong and must not invent facts.
    const findings: DistractorFinding[] = [];
    if (item.type === "question" && item.qtype === "mcq" && item.options) {
      const wrong = item.options.filter((o) => o !== item.answer);
      for (const option of wrong) {
        findings.push({
          option,
          couldBeCorrect: null,
          novelEntities: findNovelEntities(option, vocab).hard,
        });
      }
      if (askJudge && wrong.length > 0) {
        const r = await judgeDistractors(deps.llm, item.question, premise, wrong, deps.signal);
        if (r.ok) {
          usage = addUsage(usage, r.value.usage);
          for (const j of r.value.judgements) {
            const finding = findings.find((x) => x.option === j.option);
            if (finding) finding.couldBeCorrect = j.couldBeCorrect;
          }
        } else {
          usage = addUsage(usage, r.error.usage);
          judge = {
            status: "failed",
            reason: `distractor review: ${r.error.code}: ${r.error.message}`,
          };
        }
      }
    }

    const decision = decide(
      {
        quote,
        nli,
        entities,
        overGeneral,
        judge,
        distractors: {
          ambiguous: findings.filter((f) => f.couldBeCorrect === true).map((f) => f.option),
          novel: findings.filter((f) => f.novelEntities.length > 0).map((f) => f.option),
        },
      },
      t,
    );

    // Explain a probably-wrong citation. Never affects the verdict.
    let closest: Match[] = [];
    const reasons = [...decision.reasons];
    // Only useful when the evidence is the problem. A contradicted claim has the right sentence.
    const wantsHint = decision.verdict === "UNSUPPORTED" || decision.verdict === "PARTIAL";
    if (wantsHint && deps.embedder) {
      try {
        indexPromise ??= buildSourceIndex(deps.embedder, doc);
        closest = await closestSentences(await indexPromise, deps.embedder, claim.text, 3);
        const hint = citationHint(closest, claim.citedIds);
        if (hint) reasons.push(hint);
      } catch {
        // hints are optional
      }
    }

    return {
      itemId: item.itemId,
      verdict: decision.verdict,
      reasons,
      degraded: decision.degraded,
      scores: {
        quoteFound: quote.ok,
        entailment: nli.status === "ok" ? nli.entailment : null,
        novelEntities: [...entities.hard, ...entities.soft],
        overGeneral,
        judge: judge.status === "ok" ? judge.outcome : "not_run",
      },
      nli:
        nli.status === "ok"
          ? { entailment: nli.entailment, contradiction: nli.contradiction }
          : null,
      entities,
      judgeParts: judge.status === "ok" ? judge.unsupportedParts : [],
      distractors: findings,
      closest,
      usage,
    };
  }

  function failure(item: DraftItem, reason: string): Verification {
    return {
      itemId: item.itemId,
      verdict: "UNSUPPORTED",
      reasons: [reason],
      degraded: true,
      scores: {
        quoteFound: false,
        entailment: null,
        novelEntities: [],
        overGeneral: [],
        judge: "not_run",
      },
      nli: null,
      entities: { hard: [], soft: [] },
      judgeParts: [],
      distractors: [],
      closest: [],
      usage: ZERO_USAGE,
    };
  }

  return {
    verify,
    verifyAll: (items, concurrency = DEFAULT_CONCURRENCY) => mapPool(items, concurrency, verify),
  };
}

/** The shared item envelope (lore §3.3) for a verified draft. Questions carry their extra fields. */
export function toEnvelope(item: DraftItem, v: Verification): ItemEnvelope | QuestionItem {
  const base: ItemEnvelope = {
    itemId: item.itemId,
    type: item.type,
    sourceIds: item.sourceIds,
    evidenceQuote: item.evidenceQuote,
    text: item.text,
    ...(item.type === "glossary" ? { term: item.term } : {}),
    verdict: v.verdict,
    scores: v.scores,
    flagReason: v.reasons.length > 0 ? v.reasons.join(" ") : null,
  };
  if (item.type !== "question") return base;
  return {
    ...base,
    qtype: item.qtype,
    question: item.question,
    ...(item.options ? { options: item.options } : {}),
    answer: item.answer,
    answerStatement: item.answerStatement,
    answerSourceIds: item.answerSourceIds,
  };
}
