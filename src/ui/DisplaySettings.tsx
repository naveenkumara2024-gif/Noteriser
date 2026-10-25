"use client";

import { useId } from "react";
import { copy } from "./copy";
import { useSettings } from "./SettingsProvider";
import { type FontChoice, type Spacing, TEXT_SIZE, THEMES, type Theme } from "./settings";

const FIELD = "max-w-full rounded border border-line-strong bg-bg px-2 py-1";

/** Theme, text size, font and spacing. Applied at once and remembered in this browser only. */
export function DisplaySettings() {
  const { settings, update, reset } = useSettings();
  const sizeId = useId();
  const fontId = useId();
  const spacingId = useId();
  const t = copy.settings;

  return (
    <details className="w-full sm:w-auto">
      <summary className="inline-flex min-h-6 cursor-pointer items-center rounded border border-line-strong px-3 py-1 font-medium hover:bg-surface">
        {t.title}
      </summary>
      <div className="mt-3 space-y-4 rounded-lg border border-line p-4">
        <fieldset>
          <legend className="font-medium">{t.theme}</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {THEMES.map((theme: Theme) => (
              <label key={theme} className="inline-flex min-h-6 items-center gap-2">
                <input
                  type="radio"
                  name="theme"
                  value={theme}
                  checked={settings.theme === theme}
                  onChange={() => update({ theme })}
                />
                {t.themes[theme]}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor={sizeId} className="font-medium">
            {t.textSize}: <output htmlFor={sizeId}>{settings.textSize}%</output>
          </label>
          <input
            id={sizeId}
            type="range"
            min={TEXT_SIZE.min}
            max={TEXT_SIZE.max}
            step={TEXT_SIZE.step}
            value={settings.textSize}
            onChange={(e) => update({ textSize: Number(e.target.value) })}
            className="mt-1 block h-6 w-full max-w-xs"
          />
        </div>

        <div>
          <label htmlFor={fontId} className="block font-medium">
            {t.font}
          </label>
          <select
            id={fontId}
            value={settings.font}
            onChange={(e) => update({ font: e.target.value as FontChoice })}
            className={FIELD}
          >
            <option value="system">{t.fonts.system}</option>
            <option value="readable">{t.fonts.readable}</option>
          </select>
        </div>

        <div>
          <label htmlFor={spacingId} className="block font-medium">
            {t.spacing}
          </label>
          <select
            id={spacingId}
            value={settings.spacing}
            onChange={(e) => update({ spacing: e.target.value as Spacing })}
            className={FIELD}
          >
            <option value="default">{t.spacings.default}</option>
            <option value="comfortable">{t.spacings.comfortable}</option>
            <option value="extra">{t.spacings.extra}</option>
          </select>
        </div>

        <button
          type="button"
          onClick={reset}
          className="min-h-6 rounded border border-line-strong px-3 py-1 font-medium hover:bg-surface"
        >
          {t.reset}
        </button>
      </div>
    </details>
  );
}
