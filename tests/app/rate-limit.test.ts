import { describe, expect, it } from "vitest";
import { clientKey, createRateLimiter } from "@/app/server/rate-limit";

describe("rate limiter", () => {
  it("allows `max` runs per window, then says how long to wait", () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ max: 2, windowMs: 600_000, now: () => now });
    expect(limiter.take("a")).toEqual({ ok: true });
    now += 10_000;
    expect(limiter.take("a")).toEqual({ ok: true });
    now += 10_000;
    expect(limiter.take("a")).toEqual({ ok: false, retryAfterSeconds: 580 });
    expect(limiter.take("b")).toEqual({ ok: true });
  });

  it("slides: capacity returns as the oldest run leaves the window", () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => now });
    expect(limiter.take("a").ok).toBe(true);
    now = 999;
    expect(limiter.take("a").ok).toBe(false);
    now = 1000;
    expect(limiter.take("a").ok).toBe(true);
  });

  it("never reports a wait shorter than one second", () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => now });
    limiter.take("a");
    now = 999;
    expect(limiter.take("a")).toEqual({ ok: false, retryAfterSeconds: 1 });
  });
});

describe("clientKey", () => {
  it("uses the first forwarded address, then X-Real-IP, then one shared bucket", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(clientKey(new Headers({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
    expect(clientKey(new Headers())).toBe("local");
  });
});
