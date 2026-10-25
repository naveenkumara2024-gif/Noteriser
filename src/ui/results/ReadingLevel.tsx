import type { PlainSummary } from "@/core/pipeline";
import { copy } from "../copy";
import type { View } from "./ItemCard";

/** Switch between the notes' own wording and the verified plain-language versions, with the numbers. */
export function ReadingLevel({
  plain,
  view,
  onChange,
}: {
  plain: PlainSummary;
  view: View;
  onChange: (view: View) => void;
}) {
  const t = copy.plain;
  const options: { value: View; label: string }[] = [
    { value: "original", label: t.original },
    { value: "plain", label: t.plainView },
  ];
  return (
    <fieldset className="rounded-lg border border-line p-4">
      <legend className="px-1 text-xl font-semibold">{t.group}</legend>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {options.map((o) => (
          <label key={o.value} className="inline-flex min-h-6 items-center gap-2">
            <input
              type="radio"
              name="reading-level"
              value={o.value}
              checked={view === o.value}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
      <p className="measure mt-2 text-sm">
        {t.summary(plain)} {t.gradeAverage(plain.gradeBefore, plain.gradeAfter)}
      </p>
    </fieldset>
  );
}
