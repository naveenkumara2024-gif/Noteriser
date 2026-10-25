"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RunResult } from "@/core/pipeline";
import { type RunInput, type RunPhase, useRun } from "../use-run";

interface RunSessionValue {
  phase: RunPhase;
  running: boolean;
  /** Whether the run in progress also writes plain-language versions (adds a stage). */
  plain: boolean;
  start: (input: RunInput) => void;
  cancel: () => void;
  /** Counts up each time a run starts: the shell opens the activity panel on a change. */
  startCount: number;
  /** Counts up whenever the list of runs may have changed. */
  historyVersion: number;
  bumpHistory: () => void;
  /** Runs that finished while this page was open and whose notification has not been seen. */
  unseenIds: string[];
  markSeen: () => void;
  /** The result being shown on a results page, for the activity panel. Set by that page. */
  shown: RunResult | null;
  setShown: (result: RunResult | null) => void;
}

const Ctx = createContext<RunSessionValue | null>(null);

/**
 * Owns the run that the composer starts. It lives in the shell, which the router never remounts, so
 * a run keeps going (and keeps showing in the activity panel) while the person moves between pages.
 */
export function RunSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [plain, setPlain] = useState(false);
  const [startCount, setStartCount] = useState(0);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [unseenIds, setUnseenIds] = useState<string[]>([]);
  const [shown, setShown] = useState<RunResult | null>(null);
  const pendingNav = useRef(router);
  pendingNav.current = router;

  const bumpHistory = useCallback(() => setHistoryVersion((v) => v + 1), []);

  const onFinished = useCallback((runId: string) => {
    setUnseenIds((ids) => (ids.includes(runId) ? ids : [...ids, runId]));
    setHistoryVersion((v) => v + 1);
    pendingNav.current.push(`/runs/${runId}`);
  }, []);

  const { phase, start: startRun, cancel } = useRun(onFinished);

  const start = useCallback(
    (input: RunInput) => {
      setPlain(input.plain);
      setStartCount((n) => n + 1);
      void startRun(input);
    },
    [startRun],
  );

  const markSeen = useCallback(() => setUnseenIds([]), []);

  const value = useMemo<RunSessionValue>(
    () => ({
      phase,
      running: phase.name === "running",
      plain,
      start,
      cancel,
      startCount,
      historyVersion,
      bumpHistory,
      unseenIds,
      markSeen,
      shown,
      setShown,
    }),
    [
      phase,
      plain,
      start,
      cancel,
      startCount,
      historyVersion,
      bumpHistory,
      unseenIds,
      markSeen,
      shown,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRunSession(): RunSessionValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useRunSession must be used inside RunSessionProvider");
  return value;
}
