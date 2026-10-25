/**
 * Display settings: theme, text size, font, spacing. They live in the browser only (localStorage),
 * are applied as attributes and one CSS variable on <html>, and are set by an inline script before
 * the page paints so there is no flash of the wrong theme.
 */

export const THEMES = ["system", "light", "dark", "contrast"] as const;
export const FONTS = ["system", "readable"] as const;
export const SPACINGS = ["default", "comfortable", "extra"] as const;
export const SIDEBARS = ["open", "closed"] as const;
/** "auto": open on the home page and while a run is going, closed on a results page. */
export const PANELS = ["auto", "open", "closed"] as const;
export const HISTORY_VIEWS = ["timeline", "project"] as const;

export type Theme = (typeof THEMES)[number];
export type FontChoice = (typeof FONTS)[number];
export type Spacing = (typeof SPACINGS)[number];
export type SidebarChoice = (typeof SIDEBARS)[number];
export type PanelChoice = (typeof PANELS)[number];
export type HistoryView = (typeof HISTORY_VIEWS)[number];

export interface Settings {
  theme: Theme;
  /** Percent of the browser's default text size, 100 to 200 in steps of 10. */
  textSize: number;
  font: FontChoice;
  spacing: Spacing;
  /** Layout choices live here too, so one stored object (and one storage key) holds every preference. */
  sidebar: SidebarChoice;
  panel: PanelChoice;
  historyView: HistoryView;
}

export const TEXT_SIZE = { min: 100, max: 200, step: 10 } as const;

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  textSize: 100,
  font: "system",
  spacing: "default",
  sidebar: "open",
  panel: "auto",
  historyView: "timeline",
};

export const SETTINGS_KEY = "noteriser.display.v1";

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  typeof value === "string" && (list as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

/** Anything that is not a valid setting falls back to its default, so stale or hand-edited storage cannot break the page. */
export function parseSettings(raw: unknown): Settings {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const size = typeof o.textSize === "number" && Number.isFinite(o.textSize) ? o.textSize : 100;
  const snapped = Math.round(size / TEXT_SIZE.step) * TEXT_SIZE.step;
  return {
    theme: oneOf(THEMES, o.theme, DEFAULT_SETTINGS.theme),
    textSize: Math.min(TEXT_SIZE.max, Math.max(TEXT_SIZE.min, snapped)),
    font: oneOf(FONTS, o.font, DEFAULT_SETTINGS.font),
    spacing: oneOf(SPACINGS, o.spacing, DEFAULT_SETTINGS.spacing),
    sidebar: oneOf(SIDEBARS, o.sidebar, DEFAULT_SETTINGS.sidebar),
    panel: oneOf(PANELS, o.panel, DEFAULT_SETTINGS.panel),
    historyView: oneOf(HISTORY_VIEWS, o.historyView, DEFAULT_SETTINGS.historyView),
  };
}

/** Reads saved settings. Storage can be blocked or full (private windows), so every access is guarded. */
export function loadSettings(storage: Pick<Storage, "getItem"> | undefined): Settings {
  try {
    const text = storage?.getItem(SETTINGS_KEY);
    return text ? parseSettings(JSON.parse(text)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(storage: Pick<Storage, "setItem"> | undefined, s: Settings): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // The settings still apply for this visit; they just will not be remembered.
  }
}

/** The subset of an element the settings need, so tests do not need a DOM. */
export interface SettingsTarget {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  style: { setProperty(name: string, value: string): void };
}

/** Theme "system" and font/spacing defaults remove their attribute, leaving the stylesheet's own defaults (and OS preferences) in charge. */
export function applySettings(root: SettingsTarget, s: Settings): void {
  const set = (name: string, value: string | undefined): void =>
    value === undefined ? root.removeAttribute(name) : root.setAttribute(name, value);
  set("data-theme", s.theme === "system" ? undefined : s.theme);
  set("data-font", s.font === "system" ? undefined : s.font);
  set("data-spacing", s.spacing === "default" ? undefined : s.spacing);
  // Only the choices that change the first paint: the layout reads them until the page has hydrated.
  set("data-sidebar-pref", s.sidebar === "open" ? undefined : s.sidebar);
  set("data-panel-pref", s.panel === "auto" ? undefined : s.panel);
  root.style.setProperty("--text-scale", String(s.textSize / 100));
}

/**
 * Runs in the <head> before first paint. It must be self-contained (it is serialised with
 * `toString`), so it repeats the parsing above in miniature; a unit test checks that both agree.
 */
function bootstrap(key: string): void {
  try {
    const raw = window.localStorage.getItem(key);
    const s = raw ? JSON.parse(raw) : {};
    const root = document.documentElement;
    const pick = (value: unknown, allowed: string[]): string | undefined =>
      typeof value === "string" && allowed.includes(value) ? value : undefined;
    const theme = pick(s.theme, ["light", "dark", "contrast"]);
    const font = pick(s.font, ["readable"]);
    const spacing = pick(s.spacing, ["comfortable", "extra"]);
    const sidebar = pick(s.sidebar, ["closed"]);
    const panel = pick(s.panel, ["open", "closed"]);
    if (theme) root.setAttribute("data-theme", theme);
    if (font) root.setAttribute("data-font", font);
    if (spacing) root.setAttribute("data-spacing", spacing);
    if (sidebar) root.setAttribute("data-sidebar-pref", sidebar);
    if (panel) root.setAttribute("data-panel-pref", panel);
    const size = typeof s.textSize === "number" && Number.isFinite(s.textSize) ? s.textSize : 100;
    const snapped = Math.min(200, Math.max(100, Math.round(size / 10) * 10));
    root.style.setProperty("--text-scale", String(snapped / 100));
  } catch {
    // blocked storage: the defaults apply
  }
}

export const NO_FLASH_SCRIPT = `(${bootstrap.toString()})(${JSON.stringify(SETTINGS_KEY)})`;
