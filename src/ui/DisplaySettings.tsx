"use client";

import { useEffect, useId, useRef } from "react";
import { copy } from "./copy";
import { Settings as GearIcon } from "./icons";
import { useSettings } from "./SettingsProvider";
import { type FontChoice, type Spacing, TEXT_SIZE, THEMES, type Theme } from "./settings";

const FIELD = "max-w-full rounded border border-line-strong bg-bg px-2 py-1";

/**
 * Theme, text size, font and spacing. Applied at once and remembered in this browser only.
 * A `<details>` styled as an icon button with a popover: the summary's text content stays
 * "Display settings" (visually hidden) so it keeps its name, and the browser handles open/closed.
 */
export function DisplaySettings() {
  const { settings, update, reset } = useSettings();
  const host = useRef<HTMLDetailsElement>(null);
  const sizeId = useId();
  const fontId = useId();
  const spacingId = useId();
  const t = copy.settings;

  // Escape or a click outside closes the popover; Escape puts focus back on the button.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && el.open) {
        el.open = false;
        el.querySelector("summary")?.focus();
      }
    };
    const onPointer = (e: PointerEvent): void => {
      if (el.open && e.target instanceof Node && !el.contains(e.target)) el.open = false;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  return (
    <details ref={host} className="nb-pop-host">
      <summary className="nb-icon-btn" data-tip={t.title}>
        <GearIcon size={18} />
        <span className="sr-only">{t.title}</span>
      </summary>
      <div className="nb-pop space-y-4">
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

        <button type="button" onClick={reset} className="nb-pill">
          {t.reset}
        </button>
      </div>
    </details>
  );
}
