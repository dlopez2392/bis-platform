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
  it("allows a caller comfortably under both caps", () => {
    expect(decideLimit({ forNumber: 1, forAccount: 1 }, cfg)).toEqual({ allowed: true });
  });
  it("strictly-greater-than: the 5th call for a number is still allowed", () => {
    expect(decideLimit({ forNumber: 5, forAccount: 10 }, cfg)).toEqual({ allowed: true });
  });
  it("strictly-greater-than: the 6th call for a number is declined", () => {
    expect(decideLimit({ forNumber: 6, forAccount: 10 }, cfg)).toEqual({ allowed: false, reason: "per-number" });
  });
  it("the 50th call for an account is still allowed", () => {
    expect(decideLimit({ forNumber: 1, forAccount: 50 }, cfg)).toEqual({ allowed: true });
  });
  it("the 51st call for an account is declined", () => {
    expect(decideLimit({ forNumber: 1, forAccount: 51 }, cfg)).toEqual({ allowed: false, reason: "per-account" });
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
