"use client";

import { useId, useState } from "react";
import type { ShownItem } from "@/core/pipeline";
import type { QuestionItem } from "@/core/schema/items";
import { copy, questionTypeLabel } from "../copy";
import { StatusBadge } from "../StatusBadge";
import { Citations } from "./Citations";
import { SentenceLine } from "./SourcePanel";
import type { Select, Selection, SentenceIndex } from "./types";

const isQuestion = (e: ShownItem["envelope"]): e is QuestionItem => "qtype" in e;

interface CardProps {
  shown: ShownItem;
  selection: Selection | null;
  onSelect: Select;
  sentences: SentenceIndex;
}

function Answer({
  q,
  selection,
  onSelect,
}: { q: QuestionItem } & Pick<CardProps, "selection" | "onSelect">) {
  const [revealed, setRevealed] = useState(false);
  const panel = useId();
  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={revealed}
        aria-controls={panel}
        onClick={() => setRevealed((v) => !v)}
        className="rounded border border-line-strong px-3 py-1.5 font-medium hover:bg-surface"
      >
        {revealed ? copy.results.hideAnswer : copy.results.revealAnswer}
      </button>
      <div id={panel} className="mt-2">
        {revealed && (
          <div className="space-y-2 rounded bg-surface p-3">
            <p>
              <strong>{copy.results.answer}:</strong> {q.answer}
            </p>
            <Citations
              itemId={q.itemId}
              ids={q.answerSourceIds}
              selection={selection}
              onSelect={onSelect}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** A summary point, glossary entry or question, with its status in words and icon and its sources. */
export function ItemCard({ shown, selection, onSelect, sentences }: CardProps) {
  const { envelope, flagged, repaired, originalText } = shown;
  const mine = selection?.itemId === envelope.itemId;
  const cited = mine ? selection.ids : [];
  const sourcesOpen = mine && selection.ids.length === envelope.sourceIds.length;
  const question = isQuestion(envelope) ? envelope : null;

  return (
    <li className="rounded-lg border border-line p-4" data-item-id={envelope.itemId}>
      {question && (
        <p className="text-sm font-medium text-muted">{questionTypeLabel[question.qtype]}</p>
      )}
      <p>
        {envelope.term && <strong>{envelope.term}: </strong>}
        {envelope.text}
      </p>

      {question?.options && question.options.length > 0 && (
        <ol className="mt-2 list-[upper-alpha] space-y-1 pl-6">
          {question.options.map((option) => (
            <li key={option}>{option}</li>
          ))}
        </ol>
      )}
      {question && <Answer q={question} selection={selection} onSelect={onSelect} />}

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
          className="hidden rounded border border-line-strong px-3 py-1 text-sm font-medium hover:bg-surface lg:inline-flex"
        >
          {sourcesOpen ? copy.results.hideSource : copy.results.showSource}
        </button>
      </div>

      {flagged && (
        <p className="mt-2 rounded border border-warn bg-warn-bg px-3 py-2 text-warn">
          <strong>{copy.results.flaggedPrefix}:</strong>{" "}
          {envelope.flagReason ?? "Part of this is not clearly in the notes."}
        </p>
      )}

      {repaired && (
        <div className="mt-2 text-sm text-muted">
          <p>{copy.results.repaired}</p>
          {originalText && (
            <details className="mt-1">
              <summary className="cursor-pointer">{copy.results.originalWording}</summary>
              <p className="mt-1">{originalText}</p>
            </details>
          )}
        </div>
      )}

      {/* Narrow screens have no Source column: the sentences open under the item instead. */}
      <details
        className="mt-3 lg:hidden"
        open={mine}
        onToggle={(e) => {
          const open = e.currentTarget.open;
          if (open && !mine) onSelect({ itemId: envelope.itemId, ids: envelope.sourceIds });
          if (!open && mine) onSelect(null);
        }}
      >
        <summary className="cursor-pointer font-medium">{copy.results.showSource}</summary>
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
