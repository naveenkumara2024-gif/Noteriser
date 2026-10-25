"use client";

import { useId, useState } from "react";
import type { ShownItem } from "@/core/pipeline";
import type { QuestionItem } from "@/core/schema/items";
import { copy, questionTypeLabel } from "../copy";
import { StatusBadge } from "../StatusBadge";
import { speakableAnswer, speakableText, textOffsetOf } from "../speech-text";
import type { ReaderApi } from "../use-reader";
import { Citations } from "./Citations";
import { FeedbackControl } from "./FeedbackControl";
import { SentenceLine } from "./SourcePanel";
import type { Select, Selection, SentenceIndex } from "./types";

export type View = "original" | "plain";

const isQuestion = (e: ShownItem["envelope"]): e is QuestionItem => "qtype" in e;
const BUTTON =
  "min-h-6 rounded border border-line-strong px-3 py-1 text-sm font-medium hover:bg-surface";

interface CardProps {
  shown: ShownItem;
  view: View;
  selection: Selection | null;
  onSelect: Select;
  sentences: SentenceIndex;
  reader: ReaderApi;
  runId: string;
}

function Answer({
  q,
  selection,
  onSelect,
  reader,
}: { q: QuestionItem } & Pick<CardProps, "selection" | "onSelect" | "reader">) {
  const [revealed, setRevealed] = useState(false);
  const panel = useId();
  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={revealed}
        aria-controls={panel}
        onClick={() => setRevealed((v) => !v)}
        className={`print:hidden ${BUTTON}`}
      >
        {revealed ? copy.results.hideAnswer : copy.results.revealAnswer}
      </button>
      <div id={panel} className="mt-2">
        {revealed && (
          <div className="space-y-2 rounded bg-surface p-3">
            <p className="measure">
              <strong>{copy.results.answer}:</strong> {q.answer}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Citations
                itemId={q.itemId}
                ids={q.answerSourceIds}
                selection={selection}
                onSelect={onSelect}
              />
              {reader.supported && (
                <button
                  type="button"
                  onClick={() =>
                    reader.play([{ id: `${q.itemId}:answer`, text: speakableAnswer(q) }])
                  }
                  className={BUTTON}
                >
                  {copy.read.answer}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The item's text with the word being read aloud marked. The mark is bold and underlined as well
 * as tinted, so it never relies on colour. With no word information the text is shown plain.
 */
function SpokenText({ text, word }: { text: string; word?: { start: number; end: number } }) {
  if (!word || word.start < 0 || word.end > text.length || word.start >= word.end)
    return <>{text}</>;
  return (
    <>
      {text.slice(0, word.start)}
      <mark className="bg-mark-bg font-bold text-mark-fg underline">
        {text.slice(word.start, word.end)}
      </mark>
      {text.slice(word.end)}
    </>
  );
}

/** What the plain-language view says about this item's rewrite. */
function PlainNote({ shown }: { shown: ShownItem }) {
  const p = shown.plain;
  if (!p) return null;
  if (p.status === "simplified") {
    return (
      <p className="measure text-sm text-muted">
        {copy.plain.verified} {copy.plain.grade(p.gradeBefore, p.gradeAfter)}.
      </p>
    );
  }
  if (p.status === "unchanged") return <p className="text-sm text-muted">{copy.plain.unchanged}</p>;
  return (
    <p className="measure rounded border border-warn bg-warn-bg px-3 py-1 text-sm text-warn">
      <strong>{copy.plain.keptOriginal}:</strong> {copy.plain.keptReason(p.reason)}
    </p>
  );
}

/** A summary point, glossary entry or question, with its status in words and icon and its sources. */
export function ItemCard({
  shown,
  view,
  selection,
  onSelect,
  sentences,
  reader,
  runId,
}: CardProps) {
  const plain = shown.plain;
  // Only a rewrite that passed every check is ever shown in place of the original.
  const rewritten = view === "plain" && plain?.status === "simplified" ? plain.envelope : null;
  const envelope = rewritten ?? shown.envelope;
  const flagged = rewritten ? false : shown.flagged;
  const { repaired, originalText } = shown;

  const mine = selection?.itemId === envelope.itemId;
  const cited = mine ? selection.ids : [];
  const sourcesOpen = mine && selection.ids.length === envelope.sourceIds.length;
  const question = isQuestion(envelope) ? envelope : null;
  const printSources = [...new Set([...envelope.sourceIds, ...(question?.answerSourceIds ?? [])])];
  const speaking =
    reader.state.currentId === envelope.itemId ||
    reader.state.currentId === `${envelope.itemId}:answer`;

  return (
    <li
      className="rounded-lg border border-line p-4"
      data-item-id={envelope.itemId}
      data-speaking={speaking ? "true" : undefined}
    >
      {speaking && (
        <p className="text-sm font-semibold">
          <span aria-hidden="true">▶ </span>
          {copy.read.reading}
        </p>
      )}
      {question && (
        <p className="text-sm font-medium text-muted">{questionTypeLabel[question.qtype]}</p>
      )}
      <p className="measure">
        {envelope.term && <strong>{envelope.term}: </strong>}
        <SpokenText text={envelope.text} word={speaking ? reader.state.word : undefined} />
      </p>

      {question?.options && question.options.length > 0 && (
        <ol className="mt-2 list-[upper-alpha] space-y-1 pl-6">
          {question.options.map((option) => (
            <li key={option}>{option}</li>
          ))}
        </ol>
      )}
      {question && (
        <Answer q={question} selection={selection} onSelect={onSelect} reader={reader} />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <StatusBadge kind="verdict" verdict={flagged ? "PARTIAL" : "SUPPORTED"} />
        <Citations
          itemId={envelope.itemId}
          ids={envelope.sourceIds}
          selection={selection}
          onSelect={onSelect}
        />
        <button
          type="button"
          aria-pressed={sourcesOpen}
          onClick={() =>
            onSelect(sourcesOpen ? null : { itemId: envelope.itemId, ids: envelope.sourceIds })
          }
          className={`hidden lg:inline-flex print:hidden ${BUTTON}`}
        >
          {sourcesOpen ? copy.results.hideSource : copy.results.showSource}
        </button>
        {reader.supported && (
          <button
            type="button"
            onClick={() =>
              reader.play([
                {
                  id: envelope.itemId,
                  text: speakableText(envelope),
                  textOffset: textOffsetOf(envelope),
                },
              ])
            }
            className={`print:hidden ${BUTTON}`}
          >
            {question ? copy.read.question : copy.read.item}
          </button>
        )}
      </div>

      {flagged && (
        <p className="measure mt-2 rounded border border-warn bg-warn-bg px-3 py-2 text-warn">
          <strong>{copy.results.flaggedPrefix}:</strong>{" "}
          {envelope.flagReason ?? "Part of this is not clearly in the notes."}
        </p>
      )}

      {view === "plain" && (
        <div className="mt-2">
          <PlainNote shown={shown} />
        </div>
      )}

      {repaired && (
        <div className="mt-2 text-sm text-muted">
          <p>{copy.results.repaired}</p>
          {originalText && (
            <details className="mt-1">
              <summary className="min-h-6 cursor-pointer">{copy.results.originalWording}</summary>
              <p className="mt-1">{originalText}</p>
            </details>
          )}
        </div>
      )}

      <FeedbackControl runId={runId} itemId={envelope.itemId} />

      {/* On paper there is no Source column and no disclosure: write the cited sentences out. */}
      <div className="mt-2 hidden text-sm print:block">
        <p className="font-semibold">{copy.export.sourceHeading}</p>
        <ul>
          {printSources.map((id) => (
            <li key={id}>
              {id} — {sentences.get(id)?.text ?? ""}
            </li>
          ))}
        </ul>
      </div>

      {/* Narrow screens have no Source column: the sentences open under the item instead. */}
      <details
        className="mt-3 lg:hidden print:hidden"
        open={mine}
        onToggle={(e) => {
          const open = e.currentTarget.open;
          if (open && !mine) onSelect({ itemId: envelope.itemId, ids: envelope.sourceIds });
          if (!open && mine) onSelect(null);
        }}
      >
        <summary className="min-h-6 cursor-pointer font-medium">{copy.results.showSource}</summary>
        <ol className="mt-2 space-y-1">
          {envelope.sourceIds.map((id) => (
            <SentenceLine
              key={id}
              id={id}
              text={sentences.get(id)?.text ?? ""}
              cited={cited.includes(id)}
            />
          ))}
        </ol>
      </details>
    </li>
  );
}
