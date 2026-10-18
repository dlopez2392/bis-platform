import { describe, it, expect } from "vitest";
import { dayKeyInZone } from "@/lib/booking/availability";
import { inExpiryWindow, expiryDueAt, expiryTaskTitle } from "./expiry-task";

/** S-07 3a (spec 3.2): the account's own day (dayKeyInZone), the 30-day window, the due instant (owner choice: expiry - 7 days at 09:00 in the zone), the title. */
const NOW = new Date("2026-11-01T03:00:00Z");   // 22:00 on Oct 31 in Chicago (CDT), 04:00 on Nov 1 in Berlin

describe("the pass's day is the account's calendar day (dayKeyInZone), not UTC's", () => {
  it("is Oct 31 in Chicago and Nov 1 in Berlin at the same instant", () => {
    expect(dayKeyInZone(NOW, "America/Chicago")).toBe("2026-10-31");
    expect(dayKeyInZone(NOW, "Europe/Berlin")).toBe("2026-11-01");
  });
  // Review M8: Havana springs forward AT MIDNIGHT (second Sunday of March: 00:00 CST becomes 01:00 CDT), so there is no
  // 00:00 on 2026-03-08. 04:30Z is 23:30 on Mar 7; 05:30Z is 01:30 on Mar 8.
  it("crosses a midnight DST change on the right side (America/Havana, 2026-03-08)", () => {
    expect(dayKeyInZone(new Date("2026-03-08T04:30:00Z"), "America/Havana")).toBe("2026-03-07");
    expect(dayKeyInZone(new Date("2026-03-08T05:30:00Z"), "America/Havana")).toBe("2026-03-08");
  });
});

describe("inExpiryWindow: today through today + 30, never a past date", () => {
  it.each([
    ["2026-10-31", true], ["2026-11-30", true], ["2026-12-01", false], ["2026-10-30", false],
  ])("%s on 2026-10-31 -> %s (mutations: < 30, a past day allowed, or <= 31 -> FAILS)", (expiresOn, want) => {
    expect(inExpiryWindow(expiresOn, "2026-10-31")).toBe(want);
  });
});

describe("expiryDueAt: the expiry date minus 7 calendar days, at 09:00 in the zone", () => {
  it.each([
    ["2026-11-16", "America/Chicago", "2026-11-09T15:00:00.000Z"],
    ["2026-11-16", "Europe/Berlin", "2026-11-09T08:00:00.000Z"],
    // Across the US fall-back (Nov 1 2026): 09:00 CDT on Oct 29. 7 x 24 h back from 09:00 CST on Nov 5 would be 10:00 CDT.
    ["2026-11-05", "America/Chicago", "2026-10-29T14:00:00.000Z"],
    // Review M8: the due DAY is Havana's midnight-DST day; 09:00 that day is CDT (UTC-4).
    ["2026-03-15", "America/Havana", "2026-03-08T13:00:00.000Z"],
  ])("%s in %s -> %s (mutation: subtract 7 x 86_400_000 ms from the expiry day's 09:00 -> the Chicago DST case FAILS)", (expiresOn, zone, want) => {
    expect(expiryDueAt(expiresOn, zone)).toBe(want);
  });
});

describe("expiryTaskTitle: the account's language, the customer's or household's name, the file title for Other", () => {
  it("reads as the spec's example in English and Spanish (mutation: ignore lang -> the Spanish FAILS)", () => {
    expect(expiryTaskTitle({ category: "insurance", title: "Póliza", name: "Ana García", expiresOn: "2026-11-16" }, "en")).toBe("Ana García's insurance expires on Nov 16");
    expect(expiryTaskTitle({ category: "insurance", title: "Póliza", name: "Ana García", expiresOn: "2026-11-16" }, "es")).toBe("El seguro de Ana García vence el 16 nov");
  });
  it("Other names the file; no name reads as a customer (mutation: drop the noName fallback -> FAILS)", () => {
    expect(expiryTaskTitle({ category: "other", title: "Pool permit", name: "Bo", expiresOn: "2026-11-16" }, "en")).toBe("Bo's \"Pool permit\" expires on Nov 16");
    expect(expiryTaskTitle({ category: "insurance", title: "x", name: "  ", expiresOn: "2026-11-16" }, "en")).toBe("A customer's insurance expires on Nov 16");
    expect(expiryTaskTitle({ category: "insurance", title: "x", name: "", expiresOn: "2026-11-16" }, "es")).toBe("El seguro de un cliente vence el 16 nov");
  });
  it("the date is the expiry DAY whatever the server's zone (mutation: format without timeZone 'UTC' -> FAILS on a runner west of UTC)", () => {
    expect(expiryTaskTitle({ category: "permit", title: "x", name: "Bo", expiresOn: "2026-01-01" }, "en")).toBe("Bo's permit expires on Jan 1");
  });
});
