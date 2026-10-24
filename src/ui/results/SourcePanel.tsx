"use client";

import { useEffect } from "react";
import type { SourceDoc } from "@/core/schema/source";
import { copy } from "../copy";

/** One numbered sentence; the same markup serves the sticky column and the narrow-screen disclosure. */
export function SentenceLine({
  id,
  text,
  cited,
  anchor,
}: {
  id: string;
  text: string;
  cited: boolean;
  /** Only the sticky column gets DOM ids, so they stay unique. */
  anchor?: boolean;
}) {
  return (
    <li
      id={anchor ? `src-${id}` : undefined}
      aria-current={cited ? "true" : undefined}
      className={`flex gap-2 rounded border-l-4 px-2 py-1 ${
        cited ? "border-mark-fg bg-mark-bg text-mark-fg" : "border-transparent"
      }`}
    >
      <span className="shrink-0 font-mono text-sm">{id}</span>
      <span>
        {text}
        {cited && <span className="ml-2 text-sm font-semibold">({copy.results.cited})</span>}
      </span>
    </li>
  );
}

/** The numbered source notes. A sticky column on wide screens; on narrow ones each item has its own disclosure. */
export function SourcePanel({ doc, cited }: { doc: SourceDoc; cited: readonly string[] }) {
  const first = cited[0];
  useEffect(() => {
    if (first) document.getElementById(`src-${first}`)?.scrollIntoView({ block: "nearest" });
  }, [first]);

  const bySection = new Map<number, typeof doc.sentences>();
  for (const s of doc.sentences) {
    bySection.set(s.section, [...(bySection.get(s.section) ?? []), s]);
  }

  return (
    <aside
      aria-labelledby="source-heading"
      className="hidden lg:sticky lg:top-4 lg:block lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto lg:rounded-lg lg:border lg:border-line lg:p-4"
      // A scrollable region must be reachable by keyboard.
      // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region
      tabIndex={0}
    >
      <h2 id="source-heading" className="text-xl font-semibold">
        {copy.results.source}
      </h2>
      <p className="text-sm text-muted">{copy.results.sourceHint}</p>
      {doc.sections.map((section) => (
        <section key={section.number} className="mt-4">
          <h3 className="font-semibold">{section.title}</h3>
          <ol className="mt-1 space-y-1">
            {(bySection.get(section.number) ?? []).map((s) => (
              <SentenceLine
                key={s.id}
                id={s.id}
                text={s.text}
                cited={cited.includes(s.id)}
                anchor
              />
            ))}
          </ol>
        </section>
      ))}
    </aside>
  );
}
