"use client";

import { useId } from "react";
import { copy } from "../copy";
import type { ReaderApi } from "../use-reader";

const BUTTON =
  "min-h-6 rounded border border-line-strong px-3 py-1 font-medium hover:bg-surface disabled:opacity-60";
const FIELD = "max-w-full rounded border border-line-strong bg-bg px-2 py-1";
const RATES = [0.75, 1, 1.25, 1.5];

/**
 * Whole-list reading and the transport controls. Drawn only when the browser has speech synthesis,
 * so no dead controls appear. Nothing plays until a button is pressed.
 */
export function ReadAloudBar({
  reader,
  onReadSummary,
  onReadGlossary,
}: {
  reader: ReaderApi;
  onReadSummary: () => void;
  onReadGlossary: () => void;
}) {
  const rateId = useId();
  const voiceId = useId();
  const t = copy.read;
  if (!reader.supported) return null;
  const idle = reader.state.status === "idle";

  return (
    <section aria-labelledby="read-heading" className="rounded-lg border border-line p-4">
      <h2 id="read-heading" className="text-xl font-semibold">
        {t.group}
      </h2>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onReadSummary} className={BUTTON}>
          {t.readSummary}
        </button>
        <button type="button" onClick={onReadGlossary} className={BUTTON}>
          {t.readGlossary}
        </button>
        {reader.state.status === "paused" ? (
          <button type="button" onClick={reader.resume} className={BUTTON}>
            {t.resume}
          </button>
        ) : (
          <button type="button" onClick={reader.pause} disabled={idle} className={BUTTON}>
            {t.pause}
          </button>
        )}
        <button type="button" onClick={reader.stop} disabled={idle} className={BUTTON}>
          {t.stop}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <div className="max-w-full">
          <label htmlFor={rateId} className="mr-2">
            {t.rate}
          </label>
          <select
            id={rateId}
            value={reader.rate}
            onChange={(e) => reader.setRate(Number(e.target.value))}
            className={FIELD}
          >
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r}x
              </option>
            ))}
          </select>
        </div>
        {reader.voices.length > 0 && (
          <div className="max-w-full">
            <label htmlFor={voiceId} className="mr-2">
              {t.voice}
            </label>
            <select
              id={voiceId}
              value={reader.voiceURI}
              onChange={(e) => reader.setVoice(e.target.value)}
              className={FIELD}
            >
              <option value="">{t.defaultVoice}</option>
              {reader.voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <p className="measure mt-2 text-sm text-muted">{t.hint}</p>
    </section>
  );
}
