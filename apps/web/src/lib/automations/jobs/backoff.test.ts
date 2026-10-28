import { describe, it, expect } from "vitest";
import { nextRunAfter } from "./backoff";

/**
 * Spec section 8: after failed attempt n, wait `min(base * 2^(n-1), cap)`
 * with +/-20% jitter; `retryAfterMs` replaces the computed wait (still
 * capped). `random` is fixed at 0.5 unless a case says otherwise — at 0.5
 * the jitter multiplier is exactly 1.0 (0.8 + 0.4 * 0.5), so the "plain"
 * cases below land on an exact minute count.
 */
const NOW = new Date("2026-10-28T12:00:00Z");
const minutesFromNow = (n: number) => NOW.getTime() + n * 60_000;
const half = () => 0.5;

describe("nextRunAfter — the backoff schedule a retrying job waits on", () => {
  it("attempt 1 waits the base, 15 minutes", () => {
    const got = nextRunAfter({ attempt: 1, now: NOW, random: half });
    expect(got.getTime()).toBe(minutesFromNow(15));
  });

  it("attempt 3 doubles twice: 60 minutes", () => {
    const got = nextRunAfter({ attempt: 3, now: NOW, random: half });
    expect(got.getTime()).toBe(minutesFromNow(60));
  });

  it("attempt 20 is capped at 24 hours", () => {
    const got = nextRunAfter({ attempt: 20, now: NOW, random: half });
    expect(got.getTime()).toBe(minutesFromNow(24 * 60));
  });

  it("random 0 at attempt 1 is the jitter's low edge: 12 minutes (0.8x)", () => {
    const got = nextRunAfter({ attempt: 1, now: NOW, random: () => 0 });
    expect(got.getTime()).toBe(minutesFromNow(12));
  });

  it("random 0.999 at attempt 1 stays under the jitter's high edge, 18 minutes (1.2x)", () => {
    const got = nextRunAfter({ attempt: 1, now: NOW, random: () => 0.999 });
    expect(got.getTime()).toBeLessThan(minutesFromNow(18));
  });

  it("retryAfterMs replaces the computed wait: 5 minutes", () => {
    const got = nextRunAfter({ attempt: 1, now: NOW, retryAfterMs: 5 * 60_000, random: half });
    expect(got.getTime()).toBe(minutesFromNow(5));
  });

  it("retryAfterMs is still capped: 48 hours becomes 24", () => {
    const got = nextRunAfter({ attempt: 1, now: NOW, retryAfterMs: 48 * 60 * 60_000, random: half });
    expect(got.getTime()).toBe(minutesFromNow(24 * 60));
  });

  it("a handler's own backoff overrides the default: base 60 s, cap 600 s, attempt 5 -> 10 minutes", () => {
    const got = nextRunAfter({ attempt: 5, now: NOW, backoff: { baseMs: 60_000, capMs: 600_000 }, random: half });
    expect(got.getTime()).toBe(minutesFromNow(10));
  });
});
