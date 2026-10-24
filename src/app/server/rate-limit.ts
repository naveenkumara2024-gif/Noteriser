export interface RateLimiter {
  /** Counts one run for `key`, or says how long until the oldest one in the window expires. */
  take(key: string): { ok: true } | { ok: false; retryAfterSeconds: number };
}

const MAX_KEYS = 10_000;

/**
 * In-memory sliding window per key. It protects one server process from one noisy client; it is not
 * a security boundary (the key is a client-supplied header unless a trusted proxy sets it) and it
 * resets on restart. Good enough for a classroom deployment; see STAGE.md.
 */
export function createRateLimiter(options: {
  max: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const now = options.now ?? Date.now;
  const hits = new Map<string, number[]>();

  return {
    take(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((at) => t - at < options.windowMs);
      const oldest = recent[0];
      if (recent.length >= options.max && oldest !== undefined) {
        hits.set(key, recent);
        return {
          ok: false,
          retryAfterSeconds: Math.max(1, Math.ceil((oldest + options.windowMs - t) / 1000)),
        };
      }
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > MAX_KEYS) {
        for (const [k, v] of hits) {
          if (v.every((at) => t - at >= options.windowMs)) hits.delete(k);
        }
      }
      return { ok: true };
    },
  };
}

/** Client address for rate limiting: first `X-Forwarded-For` hop, else `X-Real-IP`, else one shared bucket. */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "local";
}
