import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AutomationLogRow, AutomationLogWrite } from "@bis/db";

// A recording log: getAutomationLogEntry answers with the last row written,
// so writeHeld's "same held_until writes nothing" rule is exercised for real.
const log = vi.hoisted(() => ({ rows: [] as AutomationLogWrite[] }));
const dbMocks = vi.hoisted(() => ({
  recordAutomationLog: vi.fn(async (_db: unknown, w: AutomationLogWrite) => { log.rows.push(w); }),
  getAutomationLogEntry: vi.fn(async () => {
    const w = log.rows.at(-1);
    return w ? { status: w.status, held_until: w.heldUntil ?? null, reason: w.reason ?? "" } : null;
  }),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import { pauseHoldUntil, pauseHold, pauseHoldInForce } from "./pause-hold";
import { writeHeld, REASONS } from "./hold-or-send";
import { m } from "@/lib/messages";

const HOUR = 60 * 60 * 1000;
// 14:20:30.500 UTC: deliberately off every grid line (minute, second, ms).
const T = new Date("2026-10-26T14:20:30.500Z");
const NEXT = new Date("2026-10-26T15:00:00.000Z");

beforeEach(() => {
  log.rows = [];
  dbMocks.recordAutomationLog.mockClear();
  dbMocks.getAutomationLogEntry.mockClear();
});

describe("pauseHoldUntil: the next whole UTC hour (re-review I1)", () => {
  it("no deadline → held until the next whole UTC hour (mutation: now + 60 min → FAILS)", () => {
    expect(pauseHoldUntil(T)).toEqual(NEXT);
    expect(pauseHold(null, T)).toEqual({ kind: "held", until: NEXT });
    expect(pauseHold(undefined, T)).toEqual({ kind: "held", until: NEXT });
  });

  it("two holds 15 minutes apart in the same hour give the same instant, so writeHeld writes once (mutation: now + 60 min → FAILS: two writes)", async () => {
    const subject = { accountId: "acct_1", source: "review_request" as const, channel: "sms" as const, subjectKey: "booking:bk_1", contactId: "ct_1" };
    const later = new Date(T.getTime() + 15 * 60 * 1000);
    for (const now of [T, later]) {
      const v = pauseHold(null, now);
      if (v.kind !== "held") throw new Error("expected held");
      await writeHeld({ db: {} as never }, subject, v.until, "UTC", REASONS.heldBillingPaused);
    }
    expect(log.rows).toEqual([expect.objectContaining({ status: "held", heldUntil: NEXT.toISOString(), reason: REASONS.heldBillingPaused })]);
  });

  it("at exactly the hour → the NEXT hour, never now (mutation: ceil instead of floor + 1 h → FAILS: held until now, released at once)", () => {
    const onTheHour = new Date("2026-10-26T15:00:00.000Z");
    expect(pauseHoldUntil(onTheHour)).toEqual(new Date("2026-10-26T16:00:00.000Z"));
    expect(pauseHoldUntil(onTheHour).getTime() - onTheHour.getTime()).toBe(HOUR);
  });

  it("the grid is UTC's, whatever the process zone: a half-hour zone still lands on a whole UTC hour", () => {
    expect(pauseHoldUntil(T).getUTCMinutes()).toBe(0);
    expect(pauseHoldUntil(T).getUTCSeconds()).toBe(0);
    expect(pauseHoldUntil(T).getUTCMilliseconds()).toBe(0);
  });
});

describe("pauseHold: the subject's pause deadline (I6, re-review I2)", () => {
  it("a deadline before the next hour → held until the deadline (mutation: ignore the deadline → FAILS)", () => {
    const deadline = new Date("2026-10-26T14:40:00.000Z");
    expect(pauseHold(deadline, T)).toEqual({ kind: "held", until: deadline });
  });

  it("an unreadable deadline (Invalid Date) is no deadline: held to the next hour, never an Invalid Date hold or a skip (mutation: drop the finite check → FAILS: until is NaN)", () => {
    expect(pauseHold(new Date(Number.NaN), T)).toEqual({ kind: "held", until: NEXT });
  });

  it("a deadline after the next hour → the next hour", () => {
    expect(pauseHold(new Date("2026-10-26T18:00:00.000Z"), T)).toEqual({ kind: "held", until: NEXT });
  });

  it("a deadline at or before now → skipped (mutation: `<` instead of `<=` → FAILS at the exact instant)", () => {
    expect(pauseHold(T, T)).toEqual({ kind: "skipped" });
    expect(pauseHold(new Date(T.getTime() - 1), T)).toEqual({ kind: "skipped" });
    expect(pauseHold(new Date(T.getTime() + 1), T)).toEqual({ kind: "held", until: new Date(T.getTime() + 1) });
  });
});

describe("pauseHoldInForce: only OUR hold short-circuits the gate", () => {
  const row = (over: Partial<AutomationLogRow> = {}): AutomationLogRow => ({
    id: "l1", account_id: "acct_1", source: "review_request", channel: "sms", contact_id: "ct_1",
    subject_key: "booking:bk_1", status: "held", reason: m["automations.reason.heldBillingPaused"],
    held_until: NEXT.toISOString(), payload: {}, occurred_at: T.toISOString(), ...over,
  });

  it("held, the pause reason, held_until in the future → true; any other reason, a past held_until, or another status → false (mutation: ignore the reason → FAILS: a quiet-hours hold would skip the gate)", () => {
    expect(pauseHoldInForce(row(), T)).toBe(true);
    expect(pauseHoldInForce(row({ reason: "Held until 8:00 AM — quiet hours" }), T)).toBe(false);
    expect(pauseHoldInForce(row({ reason: m["automations.reason.heldStorm"] }), T)).toBe(false);
    expect(pauseHoldInForce(row({ held_until: T.toISOString() }), T)).toBe(false);
    expect(pauseHoldInForce(row({ held_until: new Date(T.getTime() - 1).toISOString() }), T)).toBe(false);
    expect(pauseHoldInForce(row({ held_until: null }), T)).toBe(false);
    expect(pauseHoldInForce(row({ status: "skipped" }), T)).toBe(false);
    expect(pauseHoldInForce(row({ status: "sent" }), T)).toBe(false);
    expect(pauseHoldInForce(null, T)).toBe(false);
  });

  it("the reason it matches is the catalogue's, with its Spanish twin", () => {
    expect(REASONS.heldBillingPaused).toBe(m["automations.reason.heldBillingPaused"]);
    expect(REASONS.skippedBillingPaused).toBe(m["automations.reason.skippedBillingPaused"]);
    expect(m["automations.reason.heldBillingPaused.es"]).toBeTruthy();
    expect(m["automations.reason.skippedBillingPaused.es"]).toBeTruthy();
  });
});
