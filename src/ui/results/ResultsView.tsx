"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Envelope, RunResult, ShownItem } from "@/core/pipeline";
import type { QuestionItem } from "@/core/schema/items";
import { copy, docWarningLabel } from "../copy";
import { queueFor } from "../speech-text";
import { useReader } from "../use-reader";
import { DeleteRun } from "./DeleteRun";
import { ExportMenu } from "./ExportMenu";
import { ItemCard, type View } from "./ItemCard";
import { ReadAloudBar } from "./ReadAloudBar";
import { ReadingLevel } from "./ReadingLevel";
import { RemovedPanel } from "./RemovedPanel";
import { ReportCard } from "./ReportCard";
import { SourcePanel } from "./SourcePanel";
import type { Selection, SentenceIndex } from "./types";

type SectionKey = "summary" | "glossary" | "questions";

function Section({
  id,
  title,
  items,
  open,
  onToggle,
  ordered,
  card,
}: {
  id: string;
  title: string;
  items: readonly ShownItem[];
  open: boolean;
  onToggle: (open: boolean) => void;
  ordered: boolean;
  card: (shown: ShownItem) => React.ReactNode;
}) {
  const List = ordered ? "ol" : "ul";
  return (
    <section aria-labelledby={id}>
      {/* A chunked disclosure: a reader can collapse a part and take the notes one piece at a time. */}
      <details open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
        <summary className="min-h-6 cursor-pointer list-none">
          <h2 id={id} className="inline text-2xl font-semibold">
            {title}
          </h2>
        </summary>
        {items.length === 0 ? (
          <p className="mt-2 text-muted">{copy.results.noItems}</p>
        ) : (
          <List className="mt-3 space-y-3">{items.map(card)}</List>
        )}
      </details>
    </section>
  );
}

export function ResultsView({ result }: { result: RunResult }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [view, setView] = useState<View>("original");
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    summary: true,
    glossary: true,
    questions: true,
  });
  const reader = useReader();
  const doc = result.doc;
  const sentences: SentenceIndex = new Map((doc?.sentences ?? []).map((s) => [s.id, s]));
  const allOpen = Object.values(open).every(Boolean);

  // Paper cannot open a disclosure: before printing (button or Ctrl+P) open them all, then put back.
  useEffect(() => {
    let reopened: HTMLDetailsElement[] = [];
    const before = (): void => {
      reopened = [...document.querySelectorAll<HTMLDetailsElement>("main details")].filter(
        (d) => !d.open,
      );
      for (const d of reopened) d.open = true;
    };
    const after = (): void => {
      for (const d of reopened) d.open = false;
      reopened = [];
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  /** The wording on screen: the verified plain version only if that view is chosen and it exists. */
  const shownEnvelope = (item: ShownItem): Envelope =>
    view === "plain" && item.plain?.status === "simplified" ? item.plain.envelope : item.envelope;

  const card = (shown: ShownItem) => (
    <ItemCard
      key={shown.envelope.itemId}
      shown={shown}
      view={view}
      selection={selection}
      onSelect={setSelection}
      sentences={sentences}
      reader={reader}
      runId={result.runId}
    />
  );
  const sectionProps = (key: SectionKey) => ({
    open: open[key],
    onToggle: (value: boolean) => setOpen((o) => ({ ...o, [key]: value })),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-3xl font-semibold">{doc?.title ?? copy.results.untitled}</h1>
        <Link
          href="/"
          className="rounded border border-line-strong px-4 py-2 font-medium hover:bg-surface print:hidden"
        >
          {copy.results.newRun}
        </Link>
      </div>

      {/* The header (and its trust notice) is not printed, so the notice is repeated on paper. */}
      <p role="note" className="hidden print:block">
        {copy.export.printNotice}
      </p>

      <ExportMenu runId={result.runId} hasPlain={result.plain !== undefined} />

      {result.degraded && (
        <p
          role="alert"
          className="rounded border-2 border-danger bg-danger-bg px-4 py-3 font-medium text-danger"
        >
          {copy.results.degraded}
        </p>
      )}
      {result.status === "incomplete" && (
        <p role="status" className="rounded border border-warn bg-warn-bg px-4 py-3 text-warn">
          {copy.results.incomplete}
        </p>
      )}
      {result.status === "failed" && (
        <p
          role="alert"
          className="rounded border-2 border-danger bg-danger-bg px-4 py-3 font-medium text-danger"
        >
          {copy.results.failed}
        </p>
      )}

      {doc && doc.warnings.length > 0 && (
        <section
          aria-labelledby="doc-warnings"
          className="rounded border border-warn bg-warn-bg p-4 text-warn"
        >
          <h2 id="doc-warnings" className="font-semibold">
            {copy.results.docWarnings}
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {doc.warnings.map((w) => (
              <li key={`${w.kind}-${w.location?.line ?? ""}-${w.detail}`}>
                <strong>{docWarningLabel[w.kind]}.</strong> {w.detail}
                {w.location ? ` (line ${w.location.line})` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.plain && (
        <div className="print:hidden">
          <ReadingLevel plain={result.plain} view={view} onChange={setView} />
        </div>
      )}

      <div className="print:hidden">
        <ReadAloudBar
          reader={reader}
          onReadSummary={() => reader.play(queueFor(result.summary, shownEnvelope))}
          onReadGlossary={() => reader.play(queueFor(result.glossary, shownEnvelope))}
        />
      </div>

      <div className="print:hidden">
        <button
          type="button"
          onClick={() => setOpen({ summary: !allOpen, glossary: !allOpen, questions: !allOpen })}
          className="min-h-6 rounded border border-line-strong px-3 py-1 text-sm font-medium hover:bg-surface"
        >
          {allOpen ? copy.results.collapseAll : copy.results.expandAll}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] print:block">
        <div className="space-y-8">
          <Section
            id="summary-heading"
            title={copy.results.summary}
            items={result.summary}
            ordered
            card={card}
            {...sectionProps("summary")}
          />
          <Section
            id="glossary-heading"
            title={copy.results.glossary}
            items={result.glossary}
            ordered={false}
            card={card}
            {...sectionProps("glossary")}
          />
          <Section
            id="questions-heading"
            title={copy.results.questions}
            items={result.questions}
            ordered
            card={card}
            {...sectionProps("questions")}
          />
        </div>
        {doc && <SourcePanel doc={doc} cited={selection?.ids ?? []} />}
      </div>

      {/* On paper the questions are followed by their answers, as in the exports. */}
      {result.questions.length > 0 && (
        <section aria-labelledby="print-key-heading" className="hidden print:block">
          <h2 id="print-key-heading" className="text-2xl font-semibold">
            {copy.export.answerKey}
          </h2>
          <ol className="mt-2 list-decimal pl-6">
            {result.questions.map((q) => {
              const e = shownEnvelope(q) as QuestionItem;
              return (
                <li key={e.itemId}>
                  {e.answer} ({e.answerSourceIds.join(", ")})
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <RemovedPanel removed={result.removed} />
      <ReportCard report={result.report} />

      {result.warnings.length > 0 && (
        <section aria-labelledby="notices-heading">
          <h2 id="notices-heading" className="font-semibold">
            {copy.results.notices}
          </h2>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
            {result.warnings.map((w) => (
              <li key={`${w.code}-${w.message}`}>{w.message}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="print:hidden">
        <DeleteRun runId={result.runId} />
      </div>
    </div>
  );
}
