import { describe, expect, it } from "vitest";
import { addLocalDays, firstInstantOfLocalDay, localDateKey } from "./local-day";

// Values read with node 24 on 2026-10-19 and typed out (Intl's own zone data, not computed here).
describe("firstInstantOfLocalDay", () => {
  it("on a fall-back day whose midnight happens twice, takes the earlier (Havana, 1 Nov 2026: 00:59 -> 00:00 at 05:00Z)", () => {
    // Mutation: take the LAST matching hour in the scan -> 05:00Z, FAILS.
    expect(firstInstantOfLocalDay("2026-11-01", "America/Havana")).toBe("2026-11-01T04:00:00.000Z");
  });

  it("on a spring-forward day with no midnight, takes 01:00, the first minute that exists (Havana, 14 Mar 2027)", () => {
    // Mutation: Date.UTC(y,m,d) - offsetAtNoon -> 04:00Z, which reads 23:00 on the 13th, FAILS.
    expect(firstInstantOfLocalDay("2027-03-14", "America/Havana")).toBe("2027-03-14T05:00:00.000Z");
  });

  it("is local midnight on an ordinary day, west and east of UTC", () => {
    expect(firstInstantOfLocalDay("2026-10-21", "America/Chicago")).toBe("2026-10-21T05:00:00.000Z");
    expect(firstInstantOfLocalDay("2026-10-20", "Asia/Beirut")).toBe("2026-10-19T21:00:00.000Z");
  });
});

describe("localDateKey", () => {
  it("is the zone's day, not the UTC day: late evening in Chicago while UTC is already the 20th", () => {
    expect(localDateKey(new Date("2026-10-20T04:30:00Z"), "America/Chicago")).toBe("2026-10-19");
  });

  it("is the zone's day, not the UTC day: early morning in Beirut while UTC is still the 19th", () => {
    expect(localDateKey(new Date("2026-10-19T22:30:00Z"), "Asia/Beirut")).toBe("2026-10-20");
  });
});

describe("addLocalDays", () => {
  it("crosses a year end and adds a whole year of days as calendar arithmetic", () => {
    expect(addLocalDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addLocalDays("2026-10-19", 365)).toBe("2027-10-19");
  });
});
