const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const DATE = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

/** `now`, `5m`, `3h`, `1d`, `6d`, `1w`, `3w`, then a short date. Times in the future read as `now`. */
export function relativeShort(nowMs: number, thenMs: number): string {
  const diff = nowMs - thenMs;
  if (diff < MIN) return "now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  const days = Math.floor(diff / DAY);
  if (days < 7) return `${days}d`;
  if (days < 28) return `${Math.floor(days / 7)}w`;
  return DATE.format(thenMs);
}

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? "" : "s"} ago`;

/** The same moment in words, for screen readers and tooltips: "3 hours ago". */
export function relativeLong(nowMs: number, thenMs: number): string {
  const diff = nowMs - thenMs;
  if (diff < MIN) return "just now";
  if (diff < HOUR) return plural(Math.floor(diff / MIN), "minute");
  if (diff < DAY) return plural(Math.floor(diff / HOUR), "hour");
  const days = Math.floor(diff / DAY);
  if (days < 7) return plural(days, "day");
  if (days < 28) return plural(Math.floor(days / 7), "week");
  return `on ${DATE.format(thenMs)}`;
}
