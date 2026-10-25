"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import {
  applySettings,
  DEFAULT_SETTINGS,
  loadSettings,
  type Settings,
  saveSettings,
} from "./settings";

interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Holds the display settings. The page already carries them (the head script ran first); this keeps the controls in step and saves changes. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(loadSettings(storage()));
  }, []);

  const commit = useCallback((next: Settings) => {
    setSettings(next);
    applySettings(document.documentElement, next);
    saveSettings(storage(), next);
  }, []);

  const update = useCallback(
    (patch: Partial<Settings>) => commit({ ...settings, ...patch }),
    [commit, settings],
  );
  const reset = useCallback(() => commit(DEFAULT_SETTINGS), [commit]);

  return (
    <SettingsContext.Provider value={{ settings, update, reset }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings must be used inside SettingsProvider");
  return value;
}
