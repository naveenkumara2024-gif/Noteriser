import type { RemovedItem } from "@/core/pipeline";
import { failedChecks } from "../checks";
import { copy } from "../copy";
import { StatusBadge } from "../StatusBadge";

/** Every draft that is not shown, with the check that failed and why. Collapsed by default. */
export function RemovedPanel({ removed }: { removed: readonly RemovedItem[] }) {
  return (
    <details className="rounded-lg border border-line p-4">
      <summary className="cursor-pointer text-xl font-semibold">
        {copy.results.removed(removed.length)}
      </summary>
      <p className="mt-2 text-sm text-muted">{copy.results.removedHint}</p>
      {removed.length === 0 ? (
        <p className="mt-3">{copy.results.removedNone}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {removed.map((item) => {
            const checks =
              item.kind === "duplicate" || item.kind === "surplus"
                ? []
                : failedChecks(item.envelope);
            return (
              <li key={item.envelope.itemId} className="rounded border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm">{item.envelope.itemId}</span>
                  <StatusBadge kind="removed" removal={item.kind} />
                </div>
                <p className="mt-2">
                  {item.envelope.term && <strong>{item.envelope.term}: </strong>}
                  {item.envelope.text}
                </p>
                {item.reasons.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                    {item.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                )}
                {item.duplicateOf && (
                  <p className="mt-1 text-sm">Kept instead: {item.duplicateOf}.</p>
                )}
                {checks.length > 0 && (
                  <div className="mt-2 text-sm">
                    <p className="font-medium">{copy.results.checksFailed}</p>
                    <ul className="list-disc space-y-1 pl-5">
                      {checks.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {item.repairAttempted && (
                  <p className="mt-1 text-sm text-muted">
                    {copy.results.repairTried}
                    {item.repairNote ? `: ${item.repairNote}` : "."}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
