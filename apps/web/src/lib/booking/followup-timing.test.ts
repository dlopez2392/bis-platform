import { describe, it, expect } from "vitest";
import {
  shouldSendFollowupNow, resolveAccountZone,
  FOLLOWUP_MORNING_START_HOUR, FOLLOWUP_MORNING_END_HOUR, FOLLOWUP_MAX_AGE_MS,
} from "./followup-timing";

/**
 * Every instant below was computed with `Intl.DateTimeFormat` before a single
 * assertion was written, never by hand — a hand-picked instant has been
 * miscomputed in this repo more than once, including by a reviewer.
 *
 * The zone-dependent tests never assert on ONE zone. Each pins ONE instant
 * against TWO zones with OPPOSITE expected verdicts, because a test whose
 * fixture zone happens to match the dev machine's zone cannot discriminate at
 * all: it passes identically whether the helper reads the zone it is handed or
 * silently formats in the system zone. With opposite verdicts on a single
 * instant, ANY implementation that ignores the `timezone` argument — system
 * zone, hardcoded UTC, anything — returns the same answer for both halves and
 * fails one of them. (This machine's zone is America/Chicago, which is why
 * Chicago appears below as one HALF of a pair and never on its own.)
 */

// 2026-09-09 is a Wednesday, well inside US DST: New_York = EDT (UTC-4),
// Chicago = CDT (UTC-5), Los_Angeles = PDT (UTC-7).
const NY = "America/New_York";
const LA = "America/Los_Angeles";
const CHI = "America/Chicago";

const HOUR = 60 * 60 * 1000;

describe("shouldSendFollowupNow — the morning window is read in the ACCOUNT's zone", () => {
  // One instant. New_York reads 10:00 (inside the morning band), Los_Angeles
  // reads 07:00 (before it). The meeting ended the previous local day in both,
  // so the ONLY thing that can differ is the zone.
  const NOW = new Date("2026-09-09T14:00:00Z");        // NY 10:00 · LA 07:00 · UTC 14:00
  const ENDED = new Date("2026-09-08T22:00:00Z");      // NY Tue 18:00 · LA Tue 15:00

  it("sends in a zone where it is mid-morning and holds in a zone where it is still dawn", () => {
    expect(shouldSendFollowupNow(NOW, ENDED, NY)).toBe(true);
    expect(shouldSendFollowupNow(NOW, ENDED, LA)).toBe(false);
  });

  it("flips both verdicts three hours later, on the same meeting", () => {
    // Same meeting, same everything but the instant: now NY has moved past
    // the band into the afternoon and LA has moved INTO it. A helper that
    // ignored the zone would have to answer these two identically.
    const LATER = new Date("2026-09-09T17:00:00Z");    // NY 13:00 · LA 10:00 · UTC 17:00
    expect(shouldSendFollowupNow(LATER, ENDED, NY)).toBe(false);
    expect(shouldSendFollowupNow(LATER, ENDED, LA)).toBe(true);
  });

  it("guards the fixtures: UTC's own verdict is false at BOTH instants", () => {
    // 14:00 and 17:00 UTC are both outside the morning band, so neither pair
    // above could be passing by accident through a hardcoded-UTC helper.
    expect(shouldSendFollowupNow(NOW, ENDED, "UTC")).toBe(false);
    expect(shouldSendFollowupNow(new Date("2026-09-09T17:00:00Z"), ENDED, "UTC")).toBe(false);
  });

  it("opens the band inclusively at 08:00 local and closes it exclusively at 11:00 local", () => {
    expect(FOLLOWUP_MORNING_START_HOUR).toBe(8);
    expect(FOLLOWUP_MORNING_END_HOUR).toBe(11);
    // NY = UTC-4 on this date, so local 07:59/08:00/10:59/11:00.
    expect(shouldSendFollowupNow(new Date("2026-09-09T11:59:00Z"), ENDED, NY)).toBe(false);
    expect(shouldSendFollowupNow(new Date("2026-09-09T12:00:00Z"), ENDED, NY)).toBe(true);
    expect(shouldSendFollowupNow(new Date("2026-09-09T14:59:00Z"), ENDED, NY)).toBe(true);
    expect(shouldSendFollowupNow(new Date("2026-09-09T15:00:00Z"), ENDED, NY)).toBe(false);
  });
});

describe("shouldSendFollowupNow — a follow-up reads as next-day, never same-session", () => {
  /**
   * The subtle one, and zone-discriminating in its own right. ONE instant, ONE
   * meeting end, two zones one hour apart — and that hour is enough to move
   * the meeting across local midnight:
   *   New_York : meeting ended 00:30 TODAY   → same local day  → hold
   *   Chicago  : meeting ended 23:30 YESTERDAY → previous day  → send
   * It is mid-morning in both (10:00 and 09:00), so the band rule cannot be
   * what separates them; only the local calendar date can.
   */
  const NOW = new Date("2026-09-09T14:00:00Z");        // NY 10:00 Wed · CHI 09:00 Wed
  const ENDED = new Date("2026-09-09T04:30:00Z");      // NY 00:30 Wed · CHI 23:30 Tue

  it("holds a meeting that ended after local midnight, sends the identical one that ended before it", () => {
    expect(shouldSendFollowupNow(NOW, ENDED, NY)).toBe(false);
    expect(shouldSendFollowupNow(NOW, ENDED, CHI)).toBe(true);
  });

  it("never follows up a meeting that ended earlier the SAME morning, an hour later", () => {
    // The 09:00 appointment, chased at 10:00 the same day. This is the exact
    // failure the daily cron hid: at 96 ticks a day the customer is still in
    // the parking lot.
    const endedThisMorning = new Date("2026-09-09T13:00:00Z");  // NY 09:00 Wed
    expect(shouldSendFollowupNow(NOW, endedThisMorning, NY)).toBe(false);
    // The very same booking, one local day later, does send.
    expect(shouldSendFollowupNow(new Date("2026-09-10T13:00:00Z"), endedThisMorning, NY)).toBe(true);
  });

  it("never follows up a meeting that has not ended yet", () => {
    expect(shouldSendFollowupNow(NOW, new Date("2026-09-09T18:00:00Z"), NY)).toBe(false);
  });
});

describe("shouldSendFollowupNow — the staleness cap", () => {
  const NY_MORNING = new Date("2026-09-09T14:00:00Z");  // NY 10:00 Wed, mid-band

  it("refuses a week-old meeting that satisfies every other rule", () => {
    // Band: yes. Strictly-earlier local day: yes. The cap is the only thing
    // saying no — which is the point: a multi-day outage must not come back up
    // and mail someone about a meeting they have forgotten.
    const lastWeek = new Date("2026-09-02T22:00:00Z");
    expect(shouldSendFollowupNow(NY_MORNING, lastWeek, NY)).toBe(false);
  });

  it("is 37 hours, and treats the boundary as still-sendable", () => {
    expect(FOLLOWUP_MAX_AGE_MS).toBe(37 * HOUR);
    // UTC keeps this arithmetic honest: 09:30 UTC is inside the band and the
    // meeting end lands on a strictly earlier UTC day at both offsets tested.
    const now = new Date("2026-09-09T09:30:00Z");
    const exactlyAtCap = new Date(now.getTime() - FOLLOWUP_MAX_AGE_MS);
    const oneMsPastCap = new Date(now.getTime() - FOLLOWUP_MAX_AGE_MS - 1);
    expect(shouldSendFollowupNow(now, exactlyAtCap, "UTC")).toBe(true);
    expect(shouldSendFollowupNow(now, oneMsPastCap, "UTC")).toBe(false);
  });

  /**
   * The cap is not a round number — it is the worst-case gap between a meeting
   * ending and the LAST tick of its qualifying morning, and the query window in
   * `listDueFollowups` is sized to the same figure. Derivation:
   *
   *   32h  a meeting ending at 00:00:00 local on day D waits out the rest of D
   *        (24h) and then until 08:00 on D+1 (8h) — the latest the band can OPEN.
   *   + 3h  the band stays open until 11:00 local, so the last qualifying tick
   *        is 3h after it opened. Covering the whole band, not just its first
   *        instant, is what lets any tick in it fire rather than exactly one.
   *   + 2h  the largest scheduled backward clock shift in the IANA database
   *        (Antarctica/Troll swings UTC+2 → UTC+0), which stretches local day D
   *        to 26 real hours.
   *   = 37h
   *
   * Both bounds are pinned against real zones below rather than asserted as
   * arithmetic, so a tzdata change that invalidated them would surface here.
   */
  it("covers the true worst case: a 26-hour local day ending at local midnight", () => {
    // Antarctica/Troll falls back 2 hours on 2026-10-25, making that local day
    // 26 hours long. A meeting ending at 00:00 local that day is the worst case
    // the whole derivation is built on.
    const endedAtLocalMidnight = new Date("2026-10-24T22:00:00Z");  // Troll 00:00 Sun Oct 25
    const bandOpens = new Date("2026-10-26T08:00:00Z");             // Troll 08:00 Mon Oct 26
    const bandCloses = new Date("2026-10-26T11:00:00Z");            // Troll 11:00 Mon Oct 26

    // 34h to the band opening — 32h wall clock plus the 2h fall-back.
    expect(bandOpens.getTime() - endedAtLocalMidnight.getTime()).toBe(34 * HOUR);
    expect(shouldSendFollowupNow(bandOpens, endedAtLocalMidnight, "Antarctica/Troll")).toBe(true);

    // 37h to the band closing — exactly the cap, and the band's own exclusive
    // upper edge is what stops it, not the cap.
    expect(bandCloses.getTime() - endedAtLocalMidnight.getTime()).toBe(FOLLOWUP_MAX_AGE_MS);
    expect(shouldSendFollowupNow(bandCloses, endedAtLocalMidnight, "Antarctica/Troll")).toBe(false);
    const justInsideTheBand = new Date(bandCloses.getTime() - 60 * 1000);
    expect(shouldSendFollowupNow(justInsideTheBand, endedAtLocalMidnight, "Antarctica/Troll")).toBe(true);
  });

  it("covers the ordinary US fall-back worst case too, at 33 hours", () => {
    // America/New_York falls back 1 hour on 2026-11-01, so a meeting ending at
    // 00:00 EDT that day waits 33h for the next morning's band to open.
    const endedAtLocalMidnight = new Date("2026-11-01T04:00:00Z");  // NY 00:00 EDT Sun
    const nextMorning = new Date("2026-11-02T13:00:00Z");           // NY 08:00 EST Mon
    expect(nextMorning.getTime() - endedAtLocalMidnight.getTime()).toBe(33 * HOUR);
    expect(nextMorning.getTime() - endedAtLocalMidnight.getTime()).toBeLessThan(FOLLOWUP_MAX_AGE_MS);
    expect(shouldSendFollowupNow(nextMorning, endedAtLocalMidnight, NY)).toBe(true);
  });
});

describe("shouldSendFollowupNow — an unparseable account timezone FAILS CLOSED", () => {
  /**
   * `accounts.timezone` is free text at creation — a recorded, still-open
   * follow-up in this repo. The gate must still never throw: it runs inside a
   * cron with no user watching, and a RangeError here would take out the whole
   * tick, including the reminder pass that already mailed people.
   *
   * But "never throws" is not the same as "sends anyway". This gate used to
   * launder the zone through `safeZone(tz, "UTC")` the way every render path
   * does, and then read the morning band in that substituted UTC. For a
   * business in the Rio Grande Valley the 08:00-11:00 UTC band is 03:00-06:00
   * local — the follow-up lands on a customer's phone in the middle of the
   * night, and nothing anywhere says why. Under the old daily 14:00 UTC tick
   * the same broken account still got a civilised hour by accident, so this is
   * a regression the 15-minute cadence introduced.
   *
   * So: no resolvable zone, no send. There is no hour we can defend picking,
   * and the staleness cap ages the booking out on its own — an operator can
   * fix `accounts.timezone` and the next booking works, which is strictly
   * better than an automated email at an unknown hour.
   */
  const ENDED = new Date("2026-09-08T22:00:00Z");
  const JUNK_ZONES = ["Mars/Olympus", "", "  ", "x".repeat(65), "America/Nowhere"];

  it("holds a follow-up an explicitly-UTC account would have sent at the very same instant", () => {
    // THE PAIR THAT PROVES THE REGRESSION IS GONE. One instant, two zones,
    // opposite verdicts — and the two zones are chosen so the OLD
    // implementation had to answer them identically: it substituted "UTC" for
    // the junk, so junk and "UTC" were the same input by the time the band was
    // read. 09:30 UTC is inside the band, so the old code sent BOTH.
    const utcMorning = new Date("2026-09-09T09:30:00Z");
    expect(shouldSendFollowupNow(utcMorning, ENDED, "UTC")).toBe(true);
    for (const junk of JUNK_ZONES) {
      expect(shouldSendFollowupNow(utcMorning, ENDED, junk)).toBe(false);
    }
  });

  it("does not fall back to the system zone either, and never throws on any junk shape", () => {
    // Second pair, different discriminator: 14:00 UTC is outside the band but
    // the SAME instant is 09:00 in this machine's own zone (America/Chicago),
    // squarely inside it. A helper that quietly formatted in the system zone
    // would answer true for the junk here.
    const notUtcMorning = new Date("2026-09-09T14:00:00Z");
    expect(shouldSendFollowupNow(notUtcMorning, ENDED, CHI)).toBe(true);   // guards the fixture
    for (const junk of JUNK_ZONES) {
      expect(shouldSendFollowupNow(notUtcMorning, ENDED, junk)).toBe(false);
    }
  });

  it("still sends for an account whose timezone genuinely IS UTC", () => {
    // Fail-closed must not become fail-on-everything. "UTC" is a real IANA
    // zone and a deliberate configuration, not a broken one — this is the
    // case a naive `zone === "UTC" means broken` check would silently break,
    // which is why resolvability is detected rather than inferred from the
    // fallback's VALUE.
    expect(shouldSendFollowupNow(new Date("2026-09-09T09:30:00Z"), ENDED, "UTC")).toBe(true);
    expect(shouldSendFollowupNow(new Date("2026-09-09T14:00:00Z"), ENDED, "UTC")).toBe(false);
  });

  it("refuses rather than throws on an unparseable instant", () => {
    expect(shouldSendFollowupNow(new Date("2026-09-09T14:00:00Z"), new Date("not a date"), NY))
      .toBe(false);
    expect(shouldSendFollowupNow(new Date("not a date"), ENDED, NY)).toBe(false);
  });
});

/**
 * THE RELEASE PATH. `skipBand` skips the morning BAND and NOTHING ELSE — the
 * release contract (part B's spec, line 16, and amendment B16), and the shape
 * `shouldSendReferralAskNow` already carries. A held row passed the band once,
 * at the hour it was held, and comes back at the quiet window's end, which is
 * by definition not a band hour; re-applying the band would park every
 * overnight hold for a whole extra day. Every OTHER rule IS re-applied,
 * because on that path the 37h cap and the strictly-earlier-local-day rule
 * live nowhere else.
 *
 * Mutation for this block: hoist `if (opts.skipBand) return true;` to the top
 * of `shouldSendFollowupNow` → every case below but the control reds.
 */
describe("shouldSendFollowupNow — the release path skips the band ALONE", () => {
  // 12:00 EDT Wed Sept 9 — outside the 08:00-11:00 band, and the hour a
  // 21:00 → 12:00 quiet window hands a held row back at.
  const NOON_NY = new Date("2026-09-09T16:00:00Z");   // NY Wed 12:00 · LA Wed 09:00
  const ENDED = new Date("2026-09-08T22:00:00Z");     // NY Tue 18:00 · LA Tue 15:00

  it("sends at noon when the band was the only rule refusing — the control for the three below", () => {
    // Without this pair the refusals below would all be satisfied by a gate
    // that had simply stopped answering true at all.
    expect(shouldSendFollowupNow(NOON_NY, ENDED, NY)).toBe(false);
    expect(shouldSendFollowupNow(NOON_NY, ENDED, NY, { skipBand: true })).toBe(true);
  });

  it("re-applies the 37h cap on release: at the bound it goes, one millisecond past it does not", () => {
    const at = new Date(NOON_NY.getTime() - FOLLOWUP_MAX_AGE_MS);   // NY Mon 23:00, a strictly earlier local day
    const past = new Date(at.getTime() - 1);
    expect(shouldSendFollowupNow(NOON_NY, at, NY, { skipBand: true })).toBe(true);
    expect(shouldSendFollowupNow(NOON_NY, past, NY, { skipBand: true })).toBe(false);
  });

  it("re-applies the strictly-earlier-local-day rule on release — one instant, two zones, opposite verdicts", () => {
    // The booking whose meeting end moved during the hold: the releaser
    // re-reads the row, so the pass is handed the NEW anchor and a gate that
    // was skipped whole would mail someone about this morning's job.
    const ENDED_OVERNIGHT = new Date("2026-09-09T05:30:00Z");   // NY Wed 01:30 (today) · LA Tue 22:30 (yesterday)
    expect(shouldSendFollowupNow(NOON_NY, ENDED_OVERNIGHT, NY, { skipBand: true })).toBe(false);
    expect(shouldSendFollowupNow(NOON_NY, ENDED_OVERNIGHT, LA, { skipBand: true })).toBe(true);
  });

  it("still fails closed on an unresolvable zone: a release with no zone is still no hour", () => {
    for (const junk of ["Mars/Olympus", "", "  ", "America/Nowhere"]) {
      expect(shouldSendFollowupNow(NOON_NY, ENDED, junk, { skipBand: true })).toBe(false);
    }
  });
});

describe("resolveAccountZone", () => {
  it("returns real zones verbatim and null for anything Intl cannot resolve", () => {
    for (const good of [NY, LA, CHI, "UTC", "Antarctica/Troll", "Europe/Madrid"]) {
      expect(resolveAccountZone(good)).toBe(good);
    }
    for (const junk of ["Mars/Olympus", "", "  ", "x".repeat(65), "America/Nowhere"]) {
      expect(resolveAccountZone(junk)).toBeNull();
    }
  });

  it("treats a null or missing timezone as unresolvable, not as a default", () => {
    expect(resolveAccountZone(null)).toBeNull();
    expect(resolveAccountZone(undefined)).toBeNull();
  });

  it("answers correctly even for the sentinel value it uses internally", () => {
    // The one input that could in principle collide with the detection
    // mechanism. It cannot: the sentinel is not a legal zone, so it fails the
    // probe like any other junk and gets the answer it deserves.
    expect(resolveAccountZone("!unresolvable")).toBeNull();
  });
});
