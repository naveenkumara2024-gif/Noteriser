import { describe, expect, it } from "vitest";
import {
  applySettings,
  DEFAULT_SETTINGS,
  loadSettings,
  NO_FLASH_SCRIPT,
  parseSettings,
  SETTINGS_KEY,
  type Settings,
  type SettingsTarget,
  saveSettings,
} from "@/ui/settings";

/** An element that records what was set on it, so no DOM is needed. */
function fakeRoot() {
  const attrs = new Map<string, string>();
  const vars = new Map<string, string>();
  const root: SettingsTarget = {
    setAttribute: (n, v) => void attrs.set(n, v),
    removeAttribute: (n) => void attrs.delete(n),
    style: { setProperty: (n, v) => void vars.set(n, v) },
  };
  return { root, attrs, vars };
}

describe("parseSettings", () => {
  it("accepts valid values", () => {
    const s: Settings = { theme: "contrast", textSize: 150, font: "readable", spacing: "extra" };
    expect(parseSettings(s)).toEqual(s);
  });

  it("falls back to the default for anything invalid, one field at a time", () => {
    expect(parseSettings({ theme: "neon", textSize: "big", font: 3, spacing: null })).toEqual(
      DEFAULT_SETTINGS,
    );
    expect(parseSettings({ theme: "dark", font: "comic" })).toEqual({
      ...DEFAULT_SETTINGS,
      theme: "dark",
    });
    for (const junk of [null, undefined, 5, "x", []]) {
      expect(parseSettings(junk)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("snaps the text size to steps of 10 and clamps it to 100-200", () => {
    expect(parseSettings({ textSize: 143 }).textSize).toBe(140);
    expect(parseSettings({ textSize: 50 }).textSize).toBe(100);
    expect(parseSettings({ textSize: 999 }).textSize).toBe(200);
    expect(parseSettings({ textSize: Number.NaN }).textSize).toBe(100);
    expect(parseSettings({ textSize: Number.POSITIVE_INFINITY }).textSize).toBe(100);
  });
});

describe("loading and saving", () => {
  it("returns defaults when storage is missing, empty, corrupt or throws", () => {
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings({ getItem: () => null })).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings({ getItem: () => "{not json" })).toEqual(DEFAULT_SETTINGS);
    expect(
      loadSettings({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips, and a failing write is swallowed", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const s: Settings = { theme: "dark", textSize: 180, font: "readable", spacing: "comfortable" };
    saveSettings(storage, s);
    expect(loadSettings(storage)).toEqual(s);
    expect(() =>
      saveSettings(
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
        s,
      ),
    ).not.toThrow();
  });
});

describe("applySettings", () => {
  it("sets attributes and the text-scale variable; defaults remove the attributes", () => {
    const { root, attrs, vars } = fakeRoot();
    applySettings(root, { theme: "dark", textSize: 150, font: "readable", spacing: "comfortable" });
    expect(Object.fromEntries(attrs)).toEqual({
      "data-theme": "dark",
      "data-font": "readable",
      "data-spacing": "comfortable",
    });
    expect(vars.get("--text-scale")).toBe("1.5");

    applySettings(root, DEFAULT_SETTINGS);
    expect([...attrs.keys()]).toEqual([]);
    expect(vars.get("--text-scale")).toBe("1");
  });
});

describe("the no-flash head script", () => {
  /** Runs the serialised script against fake window/document objects. */
  function runScript(stored: string | null | "throw") {
    const { root, attrs, vars } = fakeRoot();
    const win = {
      localStorage: {
        getItem: (k: string) => {
          if (stored === "throw") throw new Error("blocked");
          return k === SETTINGS_KEY ? stored : null;
        },
      },
    };
    new Function("window", "document", NO_FLASH_SCRIPT)(win, { documentElement: root });
    return { attrs: Object.fromEntries(attrs), size: vars.get("--text-scale") };
  }

  it("is a single self-contained expression (it is inlined in <head>)", () => {
    expect(NO_FLASH_SCRIPT.startsWith("(function")).toBe(true);
    expect(NO_FLASH_SCRIPT).not.toMatch(/\bimport\b|\brequire\b/);
  });

  it("applies exactly what applySettings applies, for valid and invalid storage", () => {
    const cases: unknown[] = [
      { theme: "contrast", textSize: 200, font: "readable", spacing: "extra" },
      { theme: "light", textSize: 120, font: "system", spacing: "comfortable" },
      { theme: "system", textSize: 100, font: "system", spacing: "default" },
      { theme: "neon", textSize: 12345, font: "comic", spacing: 7 },
      { textSize: 143 },
      {},
    ];
    for (const raw of cases) {
      const expected = fakeRoot();
      applySettings(expected.root, parseSettings(raw));
      const got = runScript(JSON.stringify(raw));
      expect(got.attrs, JSON.stringify(raw)).toEqual(Object.fromEntries(expected.attrs));
      expect(got.size, JSON.stringify(raw)).toBe(expected.vars.get("--text-scale"));
    }
  });

  it("does nothing harmful when storage is empty, corrupt or blocked", () => {
    expect(runScript(null).attrs).toEqual({});
    expect(runScript("{nope").attrs).toEqual({});
    expect(runScript("throw").attrs).toEqual({});
  });
});
