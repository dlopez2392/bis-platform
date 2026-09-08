import { describe, it, expect } from "vitest";
import type { TrafficDay, TrafficBreakdownRow } from "@bis/db";
import { buildWebsiteView, windowDayKeys, pageTitle, parsePeriod, STALE_AFTER_DAYS } from "./view-model";

// 2026-09-07T15:00Z = 10:00 in Chicago. Yesterday there is 09-06.
const NOW = new Date("2026-09-07T15:00:00.000Z");
const TZ = "America/Chicago";

function day(d: string, visitors: number, pageviews = visitors * 2): TrafficDay { return { day: d, visitors, pageviews }; }
function bd(d: string, dimension: TrafficBreakdownRow["dimension"], value: string, visitors: number): TrafficBreakdownRow {
  return { day: d, dimension, value, visitors, pageviews: visitors * 2 };
}

describe("windowDayKeys", () => {
  // Mutation: end the window at today instead of yesterday — current[6] becomes 09-07.
  it("both windows end at local yesterday and the prior window abuts the current one", () => {
    const { current, prior } = windowDayKeys(NOW, TZ, 7);
    expect(current).toEqual(["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]);
    expect(prior).toEqual(["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"]);
  });
});

describe("parsePeriod / pageTitle", () => {
  it("accepts 7, 14, 30 and defaults everything else to 14", () => {
    expect(parsePeriod("7")).toBe(7); expect(parsePeriod("30")).toBe(30);
    expect(parsePeriod("90")).toBe(14); expect(parsePeriod(undefined)).toBe(14); expect(parsePeriod("abc")).toBe(14);
  });
  it("turns a path into a title a business owner recognises", () => {
    expect(pageTitle("/")).toBe("Home");
    expect(pageTitle("/services")).toBe("Services");
    expect(pageTitle("/free-estimate/")).toBe("Free estimate");
    expect(pageTitle("/blog/how-to-fix-a-leak")).toBe("How to fix a leak");
  });
});

describe("buildWebsiteView", () => {
  const daily = [
    ...["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"].map((d) => day(d, 10)),
    day("2026-08-31", 20), day("2026-09-01", 20), day("2026-09-02", 20), day("2026-09-03", 20), day("2026-09-04", 20),
    // 09-05 (Sat) missing on purpose → zero-filled; 09-06 (Sun) present
    day("2026-09-06", 20),
  ];
  const breakdown = [
    bd("2026-09-01", "page", "/", 50), bd("2026-09-02", "page", "/services", 60),
    bd("2026-09-01", "source", "google.com", 60), bd("2026-09-02", "source", "www.google.com", 10), bd("2026-09-02", "source", "", 30),
    bd("2026-08-25", "source", "google.com", 5), bd("2026-08-25", "source", "", 15),   // prior window: 5/70 google
    bd("2026-09-03", "place", "US", 70), bd("2026-09-03", "device", "mobile", 80), bd("2026-09-03", "device", "desktop", 20),
  ];
  const view = buildWebsiteView({ now: NOW, timezone: TZ, period: 7, daily, breakdown, lastSyncedDay: "2026-09-06" });

  it("zero-fills missing days, flags weekends, and sums the window", () => {
    expect(view.days.map((d) => d.visitors)).toEqual([20, 20, 20, 20, 20, 0, 20]);
    expect(view.days.map((d) => d.isWeekend)).toEqual([false, false, false, false, false, true, true]);
    expect(view.totals).toEqual({ visitors: 120, pageviews: 240 });
    expect(view.prior).toEqual({ visitors: 70, pageviews: 140 });
    expect(view.visitorsDelta).toEqual({ direction: "up", label: "71%" });
  });
  // Mutation: group sources by raw hostname instead of channelOf — Google splits into two rows.
  it("groups sources by channel, ranks by visitors, computes shares of the window's visitors", () => {
    expect(view.sources.map((s) => [s.name, s.visitors])).toEqual([["Google", 70], ["Direct", 30]]);
    expect(view.sources[0]!.share).toBeCloseTo(70 / 120);
    expect(view.fromGoogle.share).toBeCloseTo(70 / 120);
    expect(view.fromGoogle.priorShare).toBeCloseTo(5 / 70);
  });
  it("titles pages and picks the top one", () => {
    expect(view.pages.map((p) => p.name)).toEqual(["Services", "Home"]);
    expect(view.topPage).toEqual({ name: "Services", visitors: 60, share: 0.5 });
  });
  it("flags stale when the last synced day is more than STALE_AFTER_DAYS behind local today", () => {
    expect(STALE_AFTER_DAYS).toBe(2);
    expect(view.stale).toBe(false);
    expect(buildWebsiteView({ now: NOW, timezone: TZ, period: 7, daily, breakdown, lastSyncedDay: "2026-09-04" }).stale).toBe(true);
    expect(buildWebsiteView({ now: NOW, timezone: TZ, period: 7, daily, breakdown, lastSyncedDay: null }).stale).toBe(true);
  });
  it("hands the sentence the same numbers the tiles show", () => {
    expect(view.sentence.map((s) => s.text).join("")).toMatch(/^120 people visited your website, 71% more than the week before\./);
  });
});
