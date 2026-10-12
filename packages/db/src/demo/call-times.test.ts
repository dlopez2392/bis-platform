import { describe, it, expect } from "vitest";
import { planDemoCalls, DEMO_CALL_COUNT, DASHBOARD_CALL_COUNT, AFTER_HOURS } from "./call-times";
import { DEMO_OPEN_HOURS, DEMO_TIMEZONE } from "./fiction";
import { DEMO_TRANSCRIPTS } from "./transcripts";

/**
 * The dashboard's after-hours tile, re-derived here independently of
 * call-times.ts: answered calls (not spam, not abandoned) whose LOCAL time is
 * outside that local weekday's opening hours, over the last 7 local days
 * (today and the 6 before) against the 7 before that. Same reading as
 * apps/web lib/dashboard/metrics.ts `localDayWindow` + `countAfterHours`.
 */
const OUTCOMES = Array.from({ length: DEMO_CALL_COUNT }, (_, i) => DEMO_TRANSCRIPTS[i % DEMO_TRANSCRIPTS.length]!.outcome);
const KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function local(ms: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: DEMO_TIMEZONE, hourCycle: "h23", weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday!.toLowerCase().slice(0, 3), minutes: Number(p.hour) * 60 + Number(p.minute) };
}

function dayKeysBack(now: number, n: number): string[] {
  const t = local(now).day.split("-").map(Number);
  return Array.from({ length: n }, (_, k) => new Date(Date.UTC(t[0]!, t[1]! - 1, t[2]! - k)).toISOString().slice(0, 10));
}

function dashboardReading(now: number) {
  const plan = planDemoCalls(now, DEMO_TIMEZONE, OUTCOMES);
  const keys14 = dayKeysBack(now, 14);
  const current = new Set(keys14.slice(0, 7));
  const prior = new Set(keys14.slice(7));
  const tally = { current: { answered: 0, afterHours: 0 }, prior: { answered: 0, afterHours: 0 } };
  plan.forEach((call, i) => {
    const l = local(call.startedAt);
    const window = current.has(l.day) ? "current" : prior.has(l.day) ? "prior" : null;
    // The first DASHBOARD_CALL_COUNT calls are the dashboard's 14 days; the
    // rest are older, for the Monday report's week before (and the dashboard
    // never sees them).
    if (i < DASHBOARD_CALL_COUNT) {
      expect(window, `call ${i} on ${l.day} is outside the 14 days the dashboard reads`).not.toBeNull();
    } else {
      expect(window, `call ${i} on ${l.day} is older than the dashboard's 14 days`).toBeNull();
      return;
    }
    if (OUTCOMES[i] === "spam" || OUTCOMES[i] === "abandoned") return;
    const hours = DEMO_OPEN_HOURS[l.weekday]?.[0];
    const inside = !!hours && (() => {
      const [a, b] = hours.map((h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3)));
      return l.minutes >= a! && l.minutes < b!;
    })();
    tally[window!].answered++;
    if (!inside) tally[window!].afterHours++;
  });
  return { plan, tally };
}

// 5 AM CDT on each day of one week, plus the two DST-change days and a
// midday run, since a capture is sometimes dispatched by hand at lunchtime.
const RUNS = [
  ...Array.from({ length: 7 }, (_, d) => Date.UTC(2026, 9, 10 + d, 10, 0)), // Sat Oct 10 .. Fri Oct 16, 05:00 CDT
  Date.UTC(2026, 10, 1, 11, 0),  // Sun Nov 1, the day CDT ends
  Date.UTC(2026, 2, 8, 11, 0),   // Sun Mar 8, the day CDT starts
  Date.UTC(2026, 9, 9, 16, 30),  // Fri Oct 9, 11:30 AM CDT
];

describe("planDemoCalls", () => {
  it.each(RUNS.map((ms) => [new Date(ms).toISOString(), ms] as const))(
    "after-hours on a run at %s: the planned current and prior counts, never a decline",
    (_label, now) => {
      const { tally } = dashboardReading(now);
      expect(tally.current.afterHours).toBe(AFTER_HOURS.current);
      expect(tally.prior.afterHours).toBe(AFTER_HOURS.prior);
      // Calls answered grows too.
      expect(tally.current.answered).toBeGreaterThan(tally.prior.answered);
    },
  );

  it("puts every call in the past, none today, and no two at the same instant", () => {
    for (const now of RUNS) {
      const { plan } = dashboardReading(now);
      const today = local(now).day;
      expect(plan.every((c) => c.startedAt < now)).toBe(true);
      expect(plan.some((c) => local(c.startedAt).day === today)).toBe(false);
      expect(new Set(plan.map((c) => c.startedAt)).size).toBe(plan.length);
    }
  });

  it("keeps evening calls in the evening, not in the small hours", () => {
    for (const now of RUNS) {
      for (const c of dashboardReading(now).plan) {
        const { minutes } = local(c.startedAt);
        expect(minutes).toBeGreaterThanOrEqual(8 * 60);
        expect(minutes).toBeLessThan(21 * 60);
      }
    }
  });

  it("flags after-hours exactly as the dashboard would judge it", () => {
    const { plan } = dashboardReading(RUNS[0]!);
    for (const c of plan) {
      const l = local(c.startedAt);
      const hours = DEMO_OPEN_HOURS[l.weekday]?.[0];
      const [a, b] = hours ? hours.map((h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3))) : [0, 0];
      expect(c.afterHours, `${l.day} ${l.minutes}`).toBe(!hours || l.minutes < a! || l.minutes >= b!);
    }
    expect(KEYS).toContain(local(plan[0]!.startedAt).weekday);
  });

  // The call-detail screenshot is the latest booked Spanish call; pinned, it
  // is an evening call on every run, and the window totals still hold.
  it("lands a pinned call outside hours without moving the totals (mutation: ignore pinAfterHours -> FAILS)", () => {
    const pin = OUTCOMES.findIndex((_, i) => DEMO_TRANSCRIPTS[i % DEMO_TRANSCRIPTS.length]!.lang === "es" && OUTCOMES[i] === "booked");
    for (const now of RUNS) {
      const plan = planDemoCalls(now, DEMO_TIMEZONE, OUTCOMES, [pin]);
      expect(plan[pin]!.afterHours, new Date(now).toISOString()).toBe(true);
      const keys = new Set(dayKeysBack(now, 7));
      const current = plan.filter((c, i) => keys.has(local(c.startedAt).day) && c.afterHours
        && OUTCOMES[i] !== "spam" && OUTCOMES[i] !== "abandoned").length;
      expect(current).toBe(AFTER_HOURS.current);
    }
  });

  /**
   * The Monday report compares the last full Monday-Sunday week with the one
   * before it (apps/web lib/reports/weekly-window.ts `lastWeekMonday`), which
   * reaches up to 20 local days back. The 2026-10-12 capture, from a Sunday
   * seed, read "10 more than the week before" because that week had no calls
   * at all. Every day of both report weeks must have calls, on any weekday
   * the seed runs (mutation: drop the k=14..20 rows -> FAILS).
   */
  it("fills both of the Monday report's weeks, whatever weekday the seed runs", () => {
    for (const now of RUNS) {
      const plan = planDemoCalls(now, DEMO_TIMEZONE, OUTCOMES);
      const days = new Set(plan.map((c) => local(c.startedAt).day));
      const weekday = local(now).weekday;
      const sinceMonday = (KEYS.indexOf(weekday) + 6) % 7; // mon=0 .. sun=6
      const back = dayKeysBack(now, sinceMonday + 15);
      // k = sinceMonday+1 .. sinceMonday+14: last week, then the week before.
      for (const day of back.slice(sinceMonday + 1)) {
        expect(days.has(day), `${new Date(now).toISOString()}: no calls on ${day}`).toBe(true);
      }
    }
  });

  it("refuses an outcome list of the wrong length", () => {
    expect(() => planDemoCalls(RUNS[0]!, DEMO_TIMEZONE, OUTCOMES.slice(1))).toThrow(new RegExp(`expected ${DEMO_CALL_COUNT}`));
  });
});
