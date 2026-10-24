import type { RunStore } from "../core/ports/store";

const HOUR_MS = 3_600_000;

export interface PurgeOptions {
  ttlHours: number;
  clock?: () => Date;
  /** How often to run after the first sweep. Default one hour. */
  everyMs?: number;
  onPurged?: (removed: number) => void;
  onError?: (error: unknown) => void;
}

/**
 * Retention: delete runs older than `ttlHours`, once now and then every hour. The timer does not
 * keep the process alive. Source text is never kept longer than the configured period.
 */
export function startPurgeSchedule(
  store: RunStore,
  options: PurgeOptions,
): { stop(): void; runNow(): Promise<number> } {
  const clock = options.clock ?? (() => new Date());

  const runNow = async (): Promise<number> => {
    try {
      const cutoff = new Date(clock().getTime() - options.ttlHours * HOUR_MS);
      const removed = await store.purgeOlderThan(cutoff);
      options.onPurged?.(removed);
      return removed;
    } catch (e) {
      options.onError?.(e);
      return 0;
    }
  };

  void runNow();
  const timer = setInterval(() => void runNow(), options.everyMs ?? HOUR_MS);
  timer.unref();
  return { stop: () => clearInterval(timer), runNow };
}
