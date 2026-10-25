"use client";

import { useState } from "react";
import { copy } from "../copy";

const LINK =
  "inline-flex min-h-6 items-center rounded border border-line-strong px-3 py-1 font-medium hover:bg-surface";

/**
 * Downloads and print. Each format is a plain link to the export route, so it works without
 * scripts and the server names the file. Printing expands every disclosure first (see ResultsView).
 */
export function ExportMenu({ runId, hasPlain }: { runId: string; hasPlain: boolean }) {
  const [plain, setPlain] = useState(false);
  const [flagged, setFlagged] = useState(false);
  const t = copy.export;

  const href = (format: "md" | "txt" | "tsv" | "json"): string => {
    const q = new URLSearchParams({ format });
    if (plain && format !== "json") q.set("wording", "plain");
    if (flagged && format === "tsv") q.set("flagged", "1");
    return `/api/runs/${runId}/export?${q}`;
  };

  return (
    <details className="rounded-lg border border-line p-4 print:hidden">
      <summary className="min-h-6 cursor-pointer text-xl font-semibold">{t.title}</summary>
      <div className="mt-3 space-y-3">
        <div className="space-y-1">
          {hasPlain && (
            <label className="flex min-h-6 items-center gap-2">
              <input type="checkbox" checked={plain} onChange={(e) => setPlain(e.target.checked)} />
              {t.plainWording}
            </label>
          )}
          <label className="flex min-h-6 items-center gap-2">
            <input
              type="checkbox"
              checked={flagged}
              onChange={(e) => setFlagged(e.target.checked)}
            />
            {t.includeFlagged}
          </label>
        </div>

        <ul className="flex flex-wrap gap-3">
          <li>
            <a href={href("md")} download className={LINK}>
              {t.markdown}
            </a>
          </li>
          <li>
            <a href={href("txt")} download className={LINK}>
              {t.text}
            </a>
          </li>
          <li>
            <a href={href("tsv")} download className={LINK}>
              {t.anki}
            </a>
          </li>
          <li>
            <a href={href("json")} download className={LINK}>
              {t.audit}
            </a>
          </li>
        </ul>
        <p className="measure text-sm text-muted">{t.auditWarning}</p>

        <button
          type="button"
          onClick={() => window.print()}
          className="min-h-6 rounded border border-line-strong px-3 py-1 font-medium hover:bg-surface"
        >
          {t.print}
        </button>
      </div>
    </details>
  );
}
