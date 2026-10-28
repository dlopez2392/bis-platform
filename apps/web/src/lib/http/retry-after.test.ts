import { describe, it, expect, vi, afterEach } from "vitest";
import {
  rateLimitWaitMs, realSleep, SEND_TIMEOUT_MS, RATE_LIMIT_DEFAULT_WAIT_MS, RATE_LIMIT_MAX_WAIT_MS,
} from "./retry-after";

/**
 * F-196 Q4: one provider send is attempt + wait + attempt, and under fan-out it
 * has to end inside the 90 s pass route (Task 7 pins the sum). These three
 * constants are that sum's inputs, so they are pinned by value here.
 */
const NOW = Date.parse("2026-10-28T12:00:00.000Z");

afterEach(() => {
  vi.useRealTimers();
});

describe("the bound's inputs", () => {
  it("one attempt is 10 s, the longest wait is 3 s, an unreadable header waits 1 s (mutation: a 10 s cap → 60 + 20 + 10 + 5 = 95 > 90, FAILS here first)", () => {
    expect(SEND_TIMEOUT_MS).toBe(10_000);
    expect(RATE_LIMIT_MAX_WAIT_MS).toBe(3_000);
    expect(RATE_LIMIT_DEFAULT_WAIT_MS).toBe(1_000);
  });
});

describe("rateLimitWaitMs", () => {
  it("reads delta-seconds", () => {
    expect(rateLimitWaitMs("2", NOW)).toBe(2_000);
    expect(rateLimitWaitMs("0", NOW)).toBe(0);
  });

  it("reads an HTTP-date against the given now", () => {
    expect(rateLimitWaitMs(new Date(NOW + 2_000).toUTCString(), NOW)).toBe(2_000);
  });

  it("a date already past waits nothing, never a negative wait", () => {
    expect(rateLimitWaitMs(new Date(NOW - 60_000).toUTCString(), NOW)).toBe(0);
  });

  it("no header, or one we cannot read, waits the 1 s default", () => {
    expect(rateLimitWaitMs(null, NOW)).toBe(1_000);
    expect(rateLimitWaitMs(undefined, NOW)).toBe(1_000);
    expect(rateLimitWaitMs("", NOW)).toBe(1_000);
    expect(rateLimitWaitMs("soon", NOW)).toBe(1_000);
  });

  it("exactly the cap is still waited for", () => {
    expect(rateLimitWaitMs("3", NOW)).toBe(3_000);
    expect(rateLimitWaitMs(new Date(NOW + 3_000).toUTCString(), NOW)).toBe(3_000);
  });

  it("a longer ask is not waited for: null, the send fails now and the next tick retries (mutation: drop the max check → \"4\" returns 4000, FAILS)", () => {
    expect(rateLimitWaitMs("4", NOW)).toBeNull();
    expect(rateLimitWaitMs("30", NOW)).toBeNull();
    expect(rateLimitWaitMs(new Date(NOW + 4_000).toUTCString(), NOW)).toBeNull();
  });
});

describe("realSleep", () => {
  it("resolves after the given milliseconds, not before", async () => {
    vi.useFakeTimers();
    let done = false;
    void realSleep(1_000).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });
});
