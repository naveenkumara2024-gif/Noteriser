import type { RemovalKind } from "@/core/pipeline";
import { copy, removalLabel, verdictLabel } from "./copy";

type Tone = "ok" | "warn" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  ok: "border-ok bg-ok-bg text-ok",
  warn: "border-warn bg-warn-bg text-warn",
  danger: "border-danger bg-danger-bg text-danger",
};

/** The glyph is decoration (hidden from assistive technology); the words carry the meaning. */
const GLYPH: Record<Tone, string> = { ok: "✓", warn: "⚠", danger: "✕" };

export type BadgeKind =
  | { kind: "verdict"; verdict: "SUPPORTED" | "PARTIAL" }
  | { kind: "removed"; removal: RemovalKind };

function describeBadge(props: BadgeKind): { tone: Tone; label: string } {
  if (props.kind === "verdict") {
    return {
      tone: props.verdict === "SUPPORTED" ? "ok" : "warn",
      label: verdictLabel[props.verdict],
    };
  }
  const tone: Tone =
    props.removal === "duplicate" || props.removal === "surplus" ? "warn" : "danger";
  return { tone, label: removalLabel[props.removal] };
}

/** The single place that maps a verdict or removal reason to its icon, words and colours. */
export function StatusBadge(props: BadgeKind) {
  const { tone, label } = describeBadge(props);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-medium ${TONE_CLASS[tone]}`}
    >
      <span aria-hidden="true">{GLYPH[tone]}</span>
      {props.kind === "verdict" && props.verdict === "PARTIAL" && (
        <span className="sr-only">{copy.results.warningPrefix}</span>
      )}
      {label}
    </span>
  );
}
