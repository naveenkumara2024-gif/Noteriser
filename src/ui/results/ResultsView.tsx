"use client";

import Link from "next/link";
import { useState } from "react";
import type { RunResult, ShownItem } from "@/core/pipeline";
import { copy, docWarningLabel } from "../copy";
import { DeleteRun } from "./DeleteRun";
import { ItemCard } from "./ItemCard";
import { RemovedPanel } from "./RemovedPanel";
import { ReportCard } from "./ReportCard";
import { SourcePanel } from "./SourcePanel";
import type { Selection, SentenceIndex } from "./types";

function Section({
  id,
  title,
  items,
  selection,
  onSelect,
  sentences,
  ordered,
}: {
  id: string;
  title: string;
  items: readonly ShownItem[];
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  sentences: SentenceIndex;
  ordered: boolean;
}) {
  const List = ordered ? "ol" : "ul";
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-2xl font-semibold">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 text-muted">{copy.results.noItems}</p>
      ) : (
        <List className="mt-3 space-y-3">
          {items.map((shown) => (
            <ItemCard
              key={shown.envelope.itemId}
              shown={shown}
              selection={selection}
              onSelect={onSelect}
              sentences={sentences}
            />
          ))}
        </List>
      )}
    </section>
  );
}

export function ResultsView({ result }: { result: RunResult }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const doc = result.doc;
  const sentences: SentenceIndex = new Map((doc?.sentences ?? []).map((s) => [s.id, s]));
  const shared = { selection, onSelect: setSelection, sentences };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-3xl font-semibold">{doc?.title ?? copy.results.untitled}</h1>
        <Link
          href="/"
          className="rounded border border-line-strong px-4 py-2 font-medium hover:bg-surface"
        >
          {copy.results.newRun}
        </Link>
      </div>

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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-8">
          <Section
            id="summary-heading"
            title={copy.results.summary}
            items={result.summary}
            ordered
            {...shared}
          />
          <Section
            id="glossary-heading"
            title={copy.results.glossary}
            items={result.glossary}
            ordered={false}
            {...shared}
          />
          <Section
            id="questions-heading"
            title={copy.results.questions}
            items={result.questions}
            ordered
            {...shared}
          />
        </div>
        {doc && <SourcePanel doc={doc} cited={selection?.ids ?? []} />}
      </div>

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

      <DeleteRun runId={result.runId} />
    </div>
  );
}
