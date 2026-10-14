import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { expiryView, expiryText, purgeDaysLeft, purgeText, dayDiff } from "./expiry";

describe("expiry in words (spec 4.1), each band in both languages", () => {
  const TODAY = "2026-10-13";
  it("dayDiff is calendar days, across a month end and the spring-forward night, in a zone that HAS one (mutation: Math.floor of the local-midnight difference -> FAILS on 2026-03-09)", () => {
    // Pinned here, not inherited: vitest's TZ may be UTC, where no local-time mutation can fail.
    const tz = process.env.TZ;
    process.env.TZ = "America/Chicago";
    try {
      expect(dayDiff("2026-03-07", "2026-03-09")).toBe(2);   // 47 local hours
      expect(dayDiff("2026-10-31", "2026-11-02")).toBe(2);
    } finally {
      process.env.TZ = tz;
    }
    expect(dayDiff("2026-10-13", "2026-10-25")).toBe(12);
    expect(dayDiff("2026-10-13", "2026-10-10")).toBe(-3);
  });
  it("future, 31 days out: not soon (no dot); 30 days: soon (mutation: soon = days < 30 -> FAILS)", () => {
    expect(expiryView("2026-11-13", TODAY)).toEqual({ band: "future", days: 31, soon: false });
    expect(expiryView("2026-11-12", TODAY)).toEqual({ band: "future", days: 30, soon: true });
  });
  it("words: in 12 days, in 1 day, today, 3 days ago, 1 day ago (mutation: swap the One forms -> FAILS)", () => {
    const en = (d: string) => expiryText(expiryView(d, TODAY)!, "en");
    const es = (d: string) => expiryText(expiryView(d, TODAY)!, "es");
    expect(en("2026-10-25")).toBe("Expires in 12 days");
    expect(en("2026-10-14")).toBe("Expires in 1 day");
    expect(en("2026-10-13")).toBe("Expires today");
    expect(en("2026-10-10")).toBe("Expired 3 days ago");
    expect(en("2026-10-12")).toBe("Expired 1 day ago");
    expect(es("2026-10-25")).toBe(m["documents.expires.in.es"].replace("{count}", "12"));
    expect(es("2026-10-13")).toBe(m["documents.expires.today.es"]);
    expect(es("2026-10-10")).toBe(m["documents.expires.ago.es"].replace("{count}", "3"));
    expect(expiryView("2026-10-10", TODAY)).toMatchObject({ band: "past", soon: true });
    expect(expiryView(null, TODAY)).toBeNull();
  });
  it("purge: trashed 3 days ago has 27 days left; past the 30 days reads today (mutation: Math.floor -> FAILS)", () => {
    expect(purgeDaysLeft("2026-10-10T12:00:00.000Z", "2026-10-13T11:00:00.000Z")).toBe(28);
    expect(purgeDaysLeft("2026-10-10T12:00:00.000Z", "2026-10-13T12:00:00.000Z")).toBe(27);
    expect(purgeDaysLeft("2026-09-01T00:00:00.000Z", "2026-10-13T00:00:00.000Z")).toBe(0);
    expect(purgeText(27, "en")).toBe("Deleted for good in 27 days");
    expect(purgeText(1, "es")).toBe(m["documents.purgeInOne.es"].replace("{count}", "1"));
    expect(purgeText(0, "en")).toBe("Deleted for good today");
  });
});
