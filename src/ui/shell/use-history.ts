"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunSummary } from "@/core/ports/run-index";

export type HistoryState = "loading" | "ready" | "error";

export interface History {
  runs: RunSummary[];
  ttlHours: number | null;
  state: HistoryState;
  refresh: () => void;
  /** Drops a run from the list at once (after it was deleted), without waiting for a reload. */
  forget: (runId: string) => void;
}

/**
 * The viewer's runs from `GET /api/runs`. Loads on mount, whenever `version` changes (a run started
 * or finished) and when the tab becomes visible again, so the list is never long out of date.
 */
export function useHistory(version: number): History {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [ttlHours, setTtl] = useState<number | null>(null);
  const [state, setState] = useState<HistoryState>("loading");
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const res = await fetch("/api/runs", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { runs: RunSummary[]; ttlHours: number };
      if (ticket !== latest.current) return; // a newer request is on its way
      setRuns(body.runs);
      setTtl(body.ttlHours);
      setState("ready");
    } catch {
      if (ticket === latest.current) setState((s) => (s === "ready" ? s : "error"));
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the signal to reload
  useEffect(() => {
    void load();
  }, [load, version]);

  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const refresh = useCallback(() => {
    setState((s) => (s === "error" ? "loading" : s));
    void load();
  }, [load]);
  const forget = useCallback(
    (runId: string) => setRuns((list) => list.filter((r) => r.runId !== runId)),
    [],
  );

  return { runs, ttlHours, state, refresh, forget };
}
