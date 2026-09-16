import { describe, it, expect } from "vitest";
import {
  readReputationConfig, decideReputation, windowStart, type ReputationConfig,
} from "./caller-reputation";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
const cfg: ReputationConfig = { threshold: 3, windowDays: 30, exempt: [] };

describe("readReputationConfig", () => {
  it("defaults to 3 calls over 30 days", () => {
    expect(readReputationConfig(env({}))).toEqual({ threshold: 3, windowDays: 30, exempt: [] });
  });
  it("reads overrides from env", () => {
    expect(readReputationConfig(env({
      PHONE_SPAM_BLOCK_THRESHOLD: "5", PHONE_SPAM_BLOCK_WINDOW_DAYS: "7",
    }))).toEqual({ threshold: 5, windowDays: 7, exempt: [] });
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
    // The pair above is a DAY apart, so a floor quantised to the UTC day
    // satisfies it too — "rolling" would still be unproven. These two are 23
    // hours apart INSIDE one UTC day, which only a true instant can separate:
    // a day-quantised floor returns the same string for both.
    const earlyInTheDay = windowStart(new Date("2026-09-15T00:30:00.000Z"), 30);
    const lateInTheDay = windowStart(new Date("2026-09-15T23:30:00.000Z"), 30);
    expect(lateInTheDay > earlyInTheDay).toBe(true);
  });
});

describe("exempt callers", () => {
  const blockedHistory = { spamCalls: 5, otherCalls: 0 };

  it("never blocks an exempt caller, however bad the history", () => {
    const cfg: ReputationConfig = { threshold: 3, windowDays: 30, exempt: ["+19562921696"] };
    expect(decideReputation(blockedHistory, cfg, "+19562921696")).toEqual({ blocked: false });
  });

  it("still blocks a caller who is not on the list", () => {
    // Mutation: exempt everyone — this fails, and the guard would be off.
    const cfg: ReputationConfig = { threshold: 3, windowDays: 30, exempt: ["+19562921696"] };
    expect(decideReputation(blockedHistory, cfg, "+15550001111"))
      .toEqual({ blocked: true, reason: "repeat-spam" });
  });

  it("blocks as before when nothing is exempt", () => {
    const cfg: ReputationConfig = { threshold: 3, windowDays: 30, exempt: [] };
    expect(decideReputation(blockedHistory, cfg, "+19562921696"))
      .toEqual({ blocked: true, reason: "repeat-spam" });
  });

  it("does not exempt a missing caller number", () => {
    // An anonymous/withheld caller must not slip through by having no number
    // to compare — `undefined` and `null` are not a match for anything.
    const cfg: ReputationConfig = { threshold: 3, windowDays: 30, exempt: ["+19562921696"] };
    expect(decideReputation(blockedHistory, cfg, null)).toEqual({ blocked: true, reason: "repeat-spam" });
    expect(decideReputation(blockedHistory, cfg)).toEqual({ blocked: true, reason: "repeat-spam" });
  });

  it("matches the WHOLE number, never a substring of one", () => {
    // A caller whose number merely contains an exempt one, or is contained by
    // it, is a different person.
    const cfg: ReputationConfig = { threshold: 3, windowDays: 30, exempt: ["+19562921696"] };
    expect(decideReputation(blockedHistory, cfg, "+1956292169")).toMatchObject({ blocked: true });
    expect(decideReputation(blockedHistory, cfg, "+195629216960")).toMatchObject({ blocked: true });
  });
});

describe("readReputationConfig exempt parsing", () => {
  it("reads one number", () => {
    expect(readReputationConfig(env({ PHONE_SPAM_EXEMPT_CALLERS: "+19562921696" })).exempt)
      .toEqual(["+19562921696"]);
  });

  it("reads several, trimming the spaces an operator will type", () => {
    expect(readReputationConfig(env({
      PHONE_SPAM_EXEMPT_CALLERS: "+19562921696, +19565550123 ,+19565550124",
    })).exempt).toEqual(["+19562921696", "+19565550123", "+19565550124"]);
  });

  /**
   * The safe direction, and the opposite polarity to the numeric knobs: junk
   * here exempts NOBODY, leaving the guard fully armed. A parse that fell back
   * to "exempt everything" would disarm spam screening platform-wide from a
   * stray character.
   */
  it("exempts nobody when unset, empty or only separators", () => {
    // `env({})` covers the unset case; the rest are values an operator can
    // actually leave behind after deleting the list.
    expect(readReputationConfig(env({})).exempt).toEqual([]);
    for (const raw of ["", "   ", ",", " , , "]) {
      expect(readReputationConfig(env({ PHONE_SPAM_EXEMPT_CALLERS: raw })).exempt).toEqual([]);
    }
  });
});
