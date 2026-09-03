import { describe, it, expect } from "vitest";
import { formatWhen, safeZone } from "./time";

const INSTANT = new Date("2026-08-26T19:00:00Z"); // Wed, 2:00 PM in Chicago

describe("formatWhen", () => {
  it("formats in English by default, in the given zone", () => {
    const s = formatWhen(INSTANT, "America/Chicago");
    expect(s).toContain("Wed");
    expect(s).toContain("Aug 26");
    expect(s).toContain("2:00 PM");
    expect(s).toMatch(/CDT|GMT-5/);
  });

  it("formats in Spanish for a Spanish booker, same zone, same instant", () => {
    const s = formatWhen(INSTANT, "America/Chicago", "es");
    expect(s.toLowerCase()).toContain("mié");
    expect(s).toContain("26");
    expect(s.toLowerCase()).toContain("ago");
    expect(s).toContain("2:00");
    expect(s).not.toContain("Wed");
  });

  it("an unknown locale is English, never a thrown RangeError after a booking has committed", () => {
    expect(formatWhen(INSTANT, "America/Chicago", "fr" as never)).toContain("Wed");
  });
});

describe("safeZone", () => {
  it("keeps a real zone and falls back for anything Intl rejects", () => {
    expect(safeZone("America/New_York", "UTC")).toBe("America/New_York");
    expect(safeZone("Mars/Olympus", "UTC")).toBe("UTC");
    expect(safeZone(undefined, "America/Chicago")).toBe("America/Chicago");
    expect(safeZone("x".repeat(65), "UTC")).toBe("UTC");
  });
});
