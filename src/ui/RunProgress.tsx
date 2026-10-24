import { copy } from "./copy";
import { type ProgressState, STAGES, stageStatus } from "./progress";

/**
 * Stage list for a running job. Only the "Step n of 5" line is a live region, so a screen reader
 * hears one short update per stage instead of every item as it is checked.
 */
export function RunProgress({
  progress,
  onCancel,
}: {
  progress: ProgressState;
  onCancel: () => void;
}) {
  const t = copy.progress;
  const active = progress.current;
  const index = active ? STAGES.indexOf(active) + 1 : progress.finished.length;
  const label = active ? t.stageLabel[active] : t.stageLabel.parse;

  return (
    <section aria-labelledby="progress-heading" className="rounded-lg border border-line p-5">
      <h2 id="progress-heading" className="text-xl font-semibold">
        {t.heading}
      </h2>
      <p role="status" className="mt-2 font-medium">
        {t.step(Math.max(1, index), STAGES.length, label)}
      </p>
      <ol className="mt-4 space-y-2">
        {STAGES.map((stage) => {
          const status = stageStatus(progress, stage);
          return (
            <li key={stage} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full border text-sm ${
                  status === "done"
                    ? "border-ok bg-ok-bg text-ok"
                    : status === "active"
                      ? "border-accent text-accent"
                      : "border-line-strong text-muted"
                }`}
              >
                {status === "done" ? "✓" : status === "active" ? "…" : ""}
              </span>
              <span>
                {t.stageLabel[stage]} <span className="text-muted">({t.stageState[status]})</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-sm text-muted">
        {t.counts(progress.drafted, progress.checked, progress.repaired, progress.removed)}
      </p>
      <button
        type="button"
        onClick={onCancel}
        className="mt-4 rounded border border-line-strong px-4 py-2 font-medium hover:bg-surface"
      >
        {t.cancel}
      </button>
    </section>
  );
}
