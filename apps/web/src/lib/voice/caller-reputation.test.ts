import { describe, it, expect } from "vitest";
import {
  readReputationConfig, decideReputation, windowStart, type ReputationConfig,
} from "./caller-reputation";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
const cfg: ReputationConfig = { threshold: 3, windowDays: 30 };

describe("readReputationConfig", () => {
  it("defaults to 3 calls over 30 days", () => {
    expect(readReputationConfig(env({}))).toEqual({ threshold: 3, windowDays: 30 });
  });
  it("reads overrides from env", () => {
    expect(readReputationConfig(env({
      PHONE_SPAM_BLOCK_THRESHOLD: "5", PHONE_SPAM_BLOCK_WINDOW_DAYS: "7",
    }))).toEqual({ threshold: 5, windowDays: 7 });
  });
  it("ignores junk rather than blocking on the first silent call", () => {
    expect(readReputationConfig(env({
      PHONE_SPAM_BLOCK_THRESHOLD: "0", PHONE_SPAM_BLOCK_WINDOW_DAYS: "-1",
    }))).toEqual(readReputationConfig(env({})));
    expect(readReputationConfig(env({ PHONE_SPAM_BLOCK_THRESHOLD: "abc" })).threshold).toBe(3);
  });
});

describe("decideReputation", () => {
  it("blocks a caller at the threshold with nothing but spam", () => {
    expect(decideReputation({ spamCalls: 3, otherCalls: 0 }, cfg))
      .toEqual({ blocked: true, reason: "repeat-spam" });
    expect(decideReputation({ spamCalls: 9, otherCalls: 0 }, cfg))
      .toEqual({ blocked: true, reason: "repeat-spam" });
  });

  it("allows a caller below the threshold", () => {
    expect(decideReputation({ spamCalls: 2, otherCalls: 0 }, cfg)).toEqual({ blocked: false });
  });

  it("ALLOWS the shape that actually exists in the database: 4 spam AND 13 good", () => {
    // This is not a hypothetical. +19562921696 is simultaneously the top spam
    // caller and the top booker in the live `calls` table. A rule that counted
    // spam without also requiring zero good outcomes would have blocked the
    // best customer on file. This test is that clause's reason for existing.
    expect(decideReputation({ spamCalls: 4, otherCalls: 13 }, cfg)).toEqual({ blocked: false });
  });

  it("a single good outcome of any kind clears the caller completely", () => {
    expect(decideReputation({ spamCalls: 50, otherCalls: 1 }, cfg)).toEqual({ blocked: false });
  });

  it("allows a caller with no history at all — a first-time caller is never a robot", () => {
    expect(decideReputation({ spamCalls: 0, otherCalls: 0 }, cfg)).toEqual({ blocked: false });
  });
});

describe("windowStart", () => {
  it("is windowDays before now, as an ISO instant", () => {
    const now = new Date("2026-09-15T12:00:00.000Z");
    expect(windowStart(now, 30)).toBe("2026-08-16T12:00:00.000Z");
  });
  it("a shorter window moves the floor forward", () => {
    const now = new Date("2026-09-15T12:00:00.000Z");
    expect(windowStart(now, 7)).toBe("2026-09-08T12:00:00.000Z");
  });
  it("is a rolling instant, not a calendar boundary — a block must expire on its own", () => {
    // Load-bearing: a refused call writes NO `calls` row (startCallRow is
    // step 10, after every gate), so a blocked caller can never produce the
    // good outcome that would clear them. Without the window sliding, the
    // block is permanent and unappealable.
    const a = windowStart(new Date("2026-09-15T12:00:00.000Z"), 30);
    const b = windowStart(new Date("2026-09-16T12:00:00.000Z"), 30);
    expect(b > a).toBe(true);
  });
});
