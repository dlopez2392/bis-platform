import { describe, it, expect } from "vitest";
import { readLimitConfig, decideLimit, utcDayStart, type LimitConfig } from "./call-limits";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
const cfg: LimitConfig = { perNumberPerDay: 5, perAccountPerDay: 50 };

describe("readLimitConfig", () => {
  it("has sane defaults with no configuration", () => {
    const c = readLimitConfig(env({}));
    expect(c).toEqual({ perNumberPerDay: 5, perAccountPerDay: 50 });
  });
  it("reads overrides from env", () => {
    expect(readLimitConfig(env({
      PHONE_MAX_CALLS_PER_NUMBER_PER_DAY: "3", PHONE_MAX_CALLS_PER_ACCOUNT_PER_DAY: "20",
    }))).toEqual({ perNumberPerDay: 3, perAccountPerDay: 20 });
  });
  it("ignores junk overrides rather than disabling the cap", () => {
    const c = readLimitConfig(env({
      PHONE_MAX_CALLS_PER_NUMBER_PER_DAY: "-1", PHONE_MAX_CALLS_PER_ACCOUNT_PER_DAY: "abc",
    }));
    expect(c).toEqual(readLimitConfig(env({})));
  });
});

describe("decideLimit", () => {
  // Counts are PRIOR-call counts: the route reads them BEFORE `startCallRow`
  // writes a row for the call currently being decided (flow step 8, before
  // step 10), so they never include the current call. A `perNumberPerDay: 5`
  // config means "5 prior calls today are still fine" — the 5th call of the
  // day (which sees 4 priors) is allowed, and the 6th call (which sees 5
  // priors) is declined. That is a `>=` boundary on the prior-count, not the
  // demo's INCR-then-check `>` (which would have been correct only if the
  // count already included the call being decided).
  it("allows a caller comfortably under both caps", () => {
    expect(decideLimit({ forNumber: 1, forAccount: 1 }, cfg)).toEqual({ allowed: true });
  });
  it("4 priors for a number (the 5th call of the day) is still allowed", () => {
    expect(decideLimit({ forNumber: 4, forAccount: 10 }, cfg)).toEqual({ allowed: true });
  });
  it("5 priors for a number (the 6th call of the day) is declined", () => {
    expect(decideLimit({ forNumber: 5, forAccount: 10 }, cfg)).toEqual({ allowed: false, reason: "per-number" });
  });
  it("49 priors for an account (the 50th call of the day) is still allowed", () => {
    expect(decideLimit({ forNumber: 1, forAccount: 49 }, cfg)).toEqual({ allowed: true });
  });
  it("50 priors for an account (the 51st call of the day) is declined", () => {
    expect(decideLimit({ forNumber: 1, forAccount: 50 }, cfg)).toEqual({ allowed: false, reason: "per-account" });
  });
  it("per-number reason wins when both caps are exceeded", () => {
    expect(decideLimit({ forNumber: 99, forAccount: 99 }, cfg)).toEqual({ allowed: false, reason: "per-number" });
  });
});

describe("utcDayStart", () => {
  it("returns midnight UTC of the given instant, ISO-formatted", () => {
    expect(utcDayStart(new Date("2026-07-27T14:32:09.123Z"))).toBe("2026-07-27T00:00:00.000Z");
  });
  it("is stable within a day and changes across the UTC day boundary", () => {
    expect(utcDayStart(new Date("2026-07-27T00:00:01Z"))).toBe(utcDayStart(new Date("2026-07-27T23:59:59Z")));
    expect(utcDayStart(new Date("2026-07-27T23:59:59Z"))).not.toBe(utcDayStart(new Date("2026-07-28T00:00:00Z")));
  });
});
