import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stampWithRetry, STAMP_RETRY_DELAYS_MS } from "./stamp-retry";

/**
 * Fake timers throughout, so the documented backoff is asserted rather than
 * waited out: the delays exist to survive a real connection blip, and a test
 * that sat through them would pay ~1s per case for nothing.
 */
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Total wall time a fully-failing run spends asleep. */
const TOTAL_BACKOFF_MS = STAMP_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);

describe("stampWithRetry", () => {
  it("calls the stamp once and sleeps not at all when it lands first try", async () => {
    const stamp = vi.fn().mockResolvedValue(undefined);

    // No timer advancement anywhere in this test: if the happy path awaited a
    // backoff, this await would never settle and the test would time out.
    const outcome = await stampWithRetry(stamp);

    expect(outcome).toEqual({ stamped: true, attempts: 1 });
    expect(stamp).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure and reports the attempt it finally landed on", async () => {
    const stamp = vi.fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(undefined);

    const pending = stampWithRetry(stamp);
    await vi.advanceTimersByTimeAsync(TOTAL_BACKOFF_MS);
    const outcome = await pending;

    expect(outcome).toEqual({ stamped: true, attempts: 2 });
    expect(stamp).toHaveBeenCalledTimes(2);
  });

  it("gives up after a BOUNDED number of attempts and hands back the last error", async () => {
    // The bound is the whole point: an unbounded retry inside a cron tick
    // would trade "a duplicate email" for "the tick never finishes".
    const stamp = vi.fn().mockRejectedValue(new Error("db unavailable"));

    const pending = stampWithRetry(stamp);
    await vi.advanceTimersByTimeAsync(TOTAL_BACKOFF_MS);
    const outcome = await pending;

    const expectedAttempts = STAMP_RETRY_DELAYS_MS.length + 1;
    expect(stamp).toHaveBeenCalledTimes(expectedAttempts);
    expect(outcome.stamped).toBe(false);
    expect(outcome.attempts).toBe(expectedAttempts);
    expect(String((outcome as { lastError: unknown }).lastError)).toContain("db unavailable");
  });

  it("waits the documented backoff between attempts, and does not fire them all at once", async () => {
    // Pins the SCHEDULE, not just the count. A mutant that dropped the sleeps
    // would have all three attempts done before the first advance, and a
    // mutant that shortened them would run ahead of these checkpoints.
    const stamp = vi.fn().mockRejectedValue(new Error("db unavailable"));
    const [firstDelay, secondDelay] = STAMP_RETRY_DELAYS_MS;

    const pending = stampWithRetry(stamp);

    // Attempt 1 has run and failed; attempt 2 is asleep behind the first delay.
    await vi.advanceTimersByTimeAsync(0);
    expect(stamp).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(firstDelay! - 1);
    expect(stamp).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(stamp).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(secondDelay! - 1);
    expect(stamp).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(stamp).toHaveBeenCalledTimes(3);

    await pending;
  });

  it("backs OFF rather than hammering: each delay is longer than the one before", async () => {
    // An immediate re-fire would most likely hit the same blip that just
    // rejected. Asserted as a property so the constant can be retuned without
    // rewriting the test, but not silently flattened.
    for (let i = 1; i < STAMP_RETRY_DELAYS_MS.length; i++) {
      expect(STAMP_RETRY_DELAYS_MS[i]!).toBeGreaterThan(STAMP_RETRY_DELAYS_MS[i - 1]!);
    }
    // And the whole schedule stays under a second, because a cron tick that
    // retries many rows pays this per row.
    expect(TOTAL_BACKOFF_MS).toBeLessThanOrEqual(1000);
  });
});
