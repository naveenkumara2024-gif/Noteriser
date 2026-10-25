"use client";

import { useId, useState } from "react";
import type { FeedbackKind } from "@/core/ports/store";
import { copy } from "../copy";

const KINDS: FeedbackKind[] = ["wrong", "unclear", "missing_context"];
const MAX_NOTE = 500;

type State =
  | { name: "idle" }
  | { name: "sending" }
  | { name: "sent"; kind: FeedbackKind }
  | { name: "failed" };

/**
 * "Report a problem" on one item: wrong, unclear or missing context, with an optional note. It goes to
 * the run's stored audit trail, where an instructor's mark can later become a regression case.
 */
export function FeedbackControl({ runId, itemId }: { runId: string; itemId: string }) {
  const group = useId();
  const noteId = useId();
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [note, setNote] = useState("");
  const [state, setState] = useState<State>({ name: "idle" });
  const t = copy.feedback;

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!kind || state.name === "sending") return;
    setState({ name: "sending" });
    try {
      const res = await fetch(`/api/runs/${runId}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, kind, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      if (res.ok) {
        setState({ name: "sent", kind });
        setNote("");
        setKind(null);
        return;
      }
    } catch {
      // fall through to the message
    }
    setState({ name: "failed" });
  }

  return (
    <details className="mt-3 text-sm print:hidden">
      <summary className="min-h-6 cursor-pointer text-muted">{t.open}</summary>
      <form onSubmit={send} className="mt-2 space-y-2">
        <fieldset>
          <legend className="font-medium">{t.legend}</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {KINDS.map((k) => (
              <label key={k} className="inline-flex min-h-6 items-center gap-2">
                <input
                  type="radio"
                  name={group}
                  value={k}
                  checked={kind === k}
                  onChange={() => setKind(k)}
                />
                {t.kinds[k]}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor={noteId} className="block">
            {t.note}
          </label>
          <textarea
            id={noteId}
            rows={2}
            maxLength={MAX_NOTE}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded border border-line-strong bg-bg p-2"
          />
        </div>
        <button
          type="submit"
          disabled={!kind || state.name === "sending"}
          className="min-h-6 rounded border border-line-strong px-3 py-1 font-medium hover:bg-surface disabled:opacity-60"
        >
          {t.send}
        </button>
        <p role="status" className="min-h-6">
          {state.name === "sent" && t.thanks(t.kinds[state.kind])}
          {state.name === "failed" && t.failed}
        </p>
      </form>
    </details>
  );
}
