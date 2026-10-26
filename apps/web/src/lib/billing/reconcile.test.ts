import { describe, it, expect } from "vitest";
import { reconcileNightStart } from "@bis/db";
import { RECONCILE_SETTLE_MS, closedPeriodWindow, reconcileMeter, reconcileWindow } from "./reconcile";

const iso = (d: Date | undefined) => d?.toISOString();

describe("the nightly window (plan G14, review I4; the ONE shared reconcileNightStart, orchestrator ruling)", () => {
  it("nightlyRunStart is the most recent 08:00 UTC: 07:59 → yesterday's, 08:00 → today's (mutation: local midnight → FAILS)", () => {
    expect(reconcileNightStart(new Date("2026-10-26T07:59:59.999Z")).toISOString()).toBe("2026-10-25T08:00:00.000Z");
    expect(reconcileNightStart(new Date("2026-10-26T08:00:00.000Z")).toISOString()).toBe("2026-10-26T08:00:00.000Z");
    expect(reconcileNightStart(new Date("2026-10-26T23:59:00.000Z")).toISOString()).toBe("2026-10-26T08:00:00.000Z");
    // Across a month edge.
    expect(reconcileNightStart(new Date("2026-11-01T03:00:00.000Z")).toISOString()).toBe("2026-10-31T08:00:00.000Z");
  });

  it("pins the settle margin at 2 hours (assumption S1; mutation: change it → FAILS)", () => {
    expect(RECONCILE_SETTLE_MS).toBe(2 * 60 * 60 * 1000);
  });
});

describe("reconcileWindow (the current period so far, on whole minutes)", () => {
  const NOW = new Date("2026-10-26T09:30:45.500Z");

  it("start is the later of period start and billing start, CEILED to the minute; end is now FLOORED (mutation: floor the start → FAILS)", () => {
    const w = reconcileWindow({ currentPeriodStart: "2026-10-20T10:00:30+00:00", billingStartedAt: "2026-10-01T00:00:00+00:00" }, NOW);
    expect(iso(w?.start)).toBe("2026-10-20T10:01:00.000Z");
    expect(iso(w?.end)).toBe("2026-10-26T09:30:00.000Z");
    // Billing started inside the period: its start wins, ceiled.
    const b = reconcileWindow({ currentPeriodStart: "2026-10-20T10:00:00+00:00", billingStartedAt: "2026-10-22T14:05:00.250123+00:00" }, NOW);
    expect(iso(b?.start)).toBe("2026-10-22T14:06:00.000Z");
    // Already on a minute: unchanged.
    const m = reconcileWindow({ currentPeriodStart: "2026-10-20T10:00:00+00:00", billingStartedAt: "2026-10-01T00:00:00+00:00" }, NOW);
    expect(iso(m?.start)).toBe("2026-10-20T10:00:00.000Z");
  });

  it("no current_period_start → null (mutation: fall back to billing start → FAILS)", () => {
    expect(reconcileWindow({ currentPeriodStart: null, billingStartedAt: "2026-10-01T00:00:00+00:00" }, NOW)).toBeNull();
  });

  it("end ≤ start → null (mutation: return an empty window → FAILS)", () => {
    // The period began inside this minute: ceil(start) = 09:31 > floor(now) = 09:30.
    expect(reconcileWindow({ currentPeriodStart: "2026-10-26T09:30:10+00:00", billingStartedAt: "2026-10-01T00:00:00+00:00" }, NOW)).toBeNull();
    // Exactly equal: 09:30 = 09:30.
    expect(reconcileWindow({ currentPeriodStart: "2026-10-26T09:30:00+00:00", billingStartedAt: "2026-10-01T00:00:00+00:00" }, NOW)).toBeNull();
  });
});

describe("closedPeriodWindow (I9: the just-closed period, once, to its end)", () => {
  const ROW = { currentPeriodStart: "2026-10-20T10:00:30+00:00" };   // ceiled: 10:01

  it("the newest stored row's window_start, up to the current period's start ceiled; null when the newest row IS the current period or already reaches its end (mutation: compare window_end with now → FAILS: a closed period is re-checked every night)", () => {
    // Last checked the night before rollover: compared once more, to the end.
    const w = closedPeriodWindow({ windowStart: "2026-09-20T10:01:00+00:00", windowEnd: "2026-10-20T08:00:00+00:00" }, ROW);
    expect(iso(w?.start)).toBe("2026-09-20T10:01:00.000Z");
    expect(iso(w?.end)).toBe("2026-10-20T10:01:00.000Z");
    // Already compared to its end (the row this function's own window wrote).
    expect(closedPeriodWindow({ windowStart: "2026-09-20T10:01:00+00:00", windowEnd: "2026-10-20T10:01:00+00:00" }, ROW)).toBeNull();
    // The newest row IS the current period.
    expect(closedPeriodWindow({ windowStart: "2026-10-20T10:01:00+00:00", windowEnd: "2026-10-26T08:00:00+00:00" }, ROW)).toBeNull();
  });

  it("no stored row, or no current period start → null (mutation: treat a missing row as a closed period → FAILS)", () => {
    expect(closedPeriodWindow(null, ROW)).toBeNull();
    expect(closedPeriodWindow({ windowStart: "2026-09-20T10:01:00+00:00", windowEnd: "2026-10-20T08:00:00+00:00" }, { currentPeriodStart: null })).toBeNull();
  });
});

describe("reconcileMeter (plan G14: settled MUST be at Stripe, in flight MAY be, held is what this decides)", () => {
  it("no held rows: Stripe between settled and settled + in flight → match; below → stripe_under; above → stripe_over (mutation: ignore in-flight → FAILS)", () => {
    const bands = { settled: 10, inFlight: 3, heldQuantities: [] };
    expect(reconcileMeter(bands, 10)).toBe("match");
    expect(reconcileMeter(bands, 12)).toBe("match");
    expect(reconcileMeter(bands, 13)).toBe("match");
    expect(reconcileMeter(bands, 9)).toBe("stripe_under");
    expect(reconcileMeter(bands, 14)).toBe("stripe_over");
  });

  it("held rows Stripe already counts → held_at_stripe (mutation: send them anyway → FAILS)", () => {
    // settled 10, in flight 0..2, held 5: present = [15, 17], missing = [10, 12].
    expect(reconcileMeter({ settled: 10, inFlight: 2, heldQuantities: [5] }, 15)).toBe("held_at_stripe");
    expect(reconcileMeter({ settled: 10, inFlight: 2, heldQuantities: [5] }, 17)).toBe("held_at_stripe");
  });

  it("held rows Stripe does not count → held_missing (mutation: stamp them → FAILS)", () => {
    expect(reconcileMeter({ settled: 10, inFlight: 2, heldQuantities: [5] }, 10)).toBe("held_missing");
    expect(reconcileMeter({ settled: 10, inFlight: 2, heldQuantities: [5] }, 12)).toBe("held_missing");
  });

  it("the two ranges overlap → ambiguous (mutation: prefer held_at_stripe on overlap → FAILS)", () => {
    // missing = [10, 14], present = [12, 16]: 12..14 is in both.
    expect(reconcileMeter({ settled: 10, inFlight: 4, heldQuantities: [2] }, 13)).toBe("ambiguous");
    expect(reconcileMeter({ settled: 10, inFlight: 4, heldQuantities: [2] }, 12)).toBe("ambiguous");
  });

  it("Stripe between the ranges → ambiguous (mutation: call it stripe_under → FAILS)", () => {
    // missing = [10, 11], present = [15, 16]: 13 is in neither.
    expect(reconcileMeter({ settled: 10, inFlight: 1, heldQuantities: [5] }, 13)).toBe("ambiguous");
    // Outside both: under and over still say so.
    expect(reconcileMeter({ settled: 10, inFlight: 1, heldQuantities: [5] }, 9)).toBe("stripe_under");
    expect(reconcileMeter({ settled: 10, inFlight: 1, heldQuantities: [5] }, 17)).toBe("stripe_over");
  });

  it("a non-integer Stripe total → ambiguous (mutation: Math.round → FAILS)", () => {
    expect(reconcileMeter({ settled: 10, inFlight: 0, heldQuantities: [] }, 10.4)).toBe("ambiguous");
    expect(reconcileMeter({ settled: 10, inFlight: 0, heldQuantities: [5] }, 14.6)).toBe("ambiguous");
  });
});

describe("reconcileMeter with SEVERAL held rows (review item 2: a partial set at Stripe is not a whole one)", () => {
  // settled 10, in flight 0..5, held rows of 3 and 5 (8 in all). Every
  // subset of the held rows at Stripe gives a total in [10, 23].
  const bands = { settled: 10, inFlight: 5, heldQuantities: [3, 5] };

  it("total 18 could be ALL held rows (10 + 8) or only the 5 with 3 in flight: ambiguous, never held_at_stripe (mutation: present = in [lo + held, hi + held] alone → held_at_stripe, FAILS: the 3 would be stamped and never billed)", () => {
    expect(reconcileMeter(bands, 18)).toBe("ambiguous");
  });

  it("total 13 could be NO held row (10 + 3 in flight) or only the 3: ambiguous, never held_missing (mutation: missing = in [lo, hi] alone → held_missing, FAILS: the 3 would be sent twice)", () => {
    expect(reconcileMeter(bands, 13)).toBe("ambiguous");
  });

  it("past every partial set the answers stand: 21 or more is held_at_stripe, under 13 is held_missing, and the edges are judged by the SMALLEST held row (mutation: the largest held row instead of the smallest → 20 and 14 decided, FAILS)", () => {
    // 20 = 10 + 5 in flight + only the 5; 14 = 10 + 1 in flight + only the 3.
    expect(reconcileMeter(bands, 20)).toBe("ambiguous");
    expect(reconcileMeter(bands, 14)).toBe("ambiguous");
    expect(reconcileMeter(bands, 21)).toBe("held_at_stripe");
    expect(reconcileMeter(bands, 23)).toBe("held_at_stripe");
    expect(reconcileMeter(bands, 12)).toBe("held_missing");
    expect(reconcileMeter(bands, 10)).toBe("held_missing");
    expect(reconcileMeter(bands, 24)).toBe("stripe_over");
    expect(reconcileMeter(bands, 9)).toBe("stripe_under");
  });
});
