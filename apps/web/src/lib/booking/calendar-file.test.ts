import { describe, it, expect } from "vitest";
import { calendarFileFor, calendarFileUrl, type CalendarFileInput } from "./calendar-file";

const BASE: CalendarFileInput = {
  booking: {
    id: "b-3", status: "booked", cancel_token: "tok123",
    starts_at: "2026-11-01T14:00:00Z", ends_at: "2026-11-01T15:00:00Z", meeting_url: null,
  },
  chain: { rootId: "b-1", depth: 2 },
  publicId: "pub1",
  brandName: "Rio Roofing",
  accountZone: "America/Chicago",
  locale: "en",
  origin: "https://app.bis-rgv.com",
  now: new Date("2026-10-09T18:00:00Z"),
};

const unfold = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n");
const prop = (ics: string, name: string) =>
  unfold(ics).filter((l) => l.startsWith(`${name}:`)).map((l) => l.slice(name.length + 1));

describe("calendarFileFor — what a booking's add-to-calendar file says", () => {
  it("takes its UID from the FIRST booking of the reschedule chain and its SEQUENCE from the moves, so a moved booking replaces the saved one (mutation: UID from the booking's own id → FAILS)", () => {
    const ics = calendarFileFor(BASE)!;
    expect(prop(ics, "UID")).toEqual(["b-1@bookings.bis-rgv.com"]);
    expect(prop(ics, "SEQUENCE")).toEqual(["2"]);
    const original = calendarFileFor({ ...BASE, booking: { ...BASE.booking, id: "b-1" }, chain: { rootId: "b-1", depth: 0 } })!;
    expect(prop(original, "UID")).toEqual(prop(ics, "UID"));
    expect(prop(original, "SEQUENCE")).toEqual(["0"]);
  });

  it("holds the booking's own instants, and the business's wall-clock time in words, in the account's zone (Chicago fall-back day: 14:00Z is 8:00 AM CST, after the repeated hour)", () => {
    const ics = calendarFileFor(BASE)!;
    expect(prop(ics, "DTSTART")).toEqual(["20261101T140000Z"]);
    expect(prop(ics, "DTEND")).toEqual(["20261101T150000Z"]);
    const description = prop(ics, "DESCRIPTION")[0]!;
    expect(description).toContain("8:00 AM");
    expect(description).toMatch(/CST|GMT-6/);
    expect(description).toContain("for us");
  });

  it("names the business by its brand name, and says only 'Appointment' when there is none — never an internal account label", () => {
    expect(prop(calendarFileFor(BASE)!, "SUMMARY")).toEqual(["Appointment with Rio Roofing"]);
    expect(prop(calendarFileFor({ ...BASE, brandName: "" })!, "SUMMARY")).toEqual(["Appointment"]);
  });

  it("speaks Spanish for a Spanish booker, title and time alike (mutation: ignore locale → FAILS)", () => {
    const ics = calendarFileFor({ ...BASE, locale: "es" })!;
    expect(prop(ics, "SUMMARY")).toEqual(["Cita con Rio Roofing"]);
    const description = prop(ics, "DESCRIPTION")[0]!;
    expect(description).toContain("para nosotros");
    expect(description).toContain("?locale=es");
  });

  it("carries the cancel link built on the CALENDAR's own public id, and the video link only when a room exists", () => {
    const plain = prop(calendarFileFor(BASE)!, "DESCRIPTION")[0]!;
    expect(plain).toContain("https://app.bis-rgv.com/b/pub1/cancel/tok123");
    expect(plain).not.toContain("video");
    const video = prop(calendarFileFor({ ...BASE, booking: { ...BASE.booking, meeting_url: "https://x.daily.co/room" } })!, "DESCRIPTION")[0]!;
    expect(video).toContain("Join your video meeting: https://x.daily.co/room");
  });

  it("leaves the cancel line out when there is no origin to build it on, rather than a relative link", () => {
    const description = prop(calendarFileFor({ ...BASE, origin: null })!, "DESCRIPTION")[0]!;
    expect(description).not.toContain("/cancel/");
    expect(description).not.toContain("null");
  });

  // Only a live booking gets a file: a cancelled one must not be put back on
  // anyone's phone by an old link (mutation: drop the status check → FAILS).
  it.each(["cancelled", "completed", "no_show"] as const)("offers no file for a %s booking", (status) => {
    expect(calendarFileFor({ ...BASE, booking: { ...BASE.booking, status } })).toBeNull();
  });

  it("fails closed on a row whose times do not parse", () => {
    expect(calendarFileFor({ ...BASE, booking: { ...BASE.booking, starts_at: "garbage" } })).toBeNull();
  });

  it("falls back to UTC words, never a throw, for a zone Intl cannot use", () => {
    const ics = calendarFileFor({ ...BASE, accountZone: "Not/AZone" })!;
    expect(prop(ics, "DTSTART")).toEqual(["20261101T140000Z"]);
    expect(prop(ics, "DESCRIPTION")[0]).toMatch(/UTC/);
  });
});

describe("calendarFileUrl", () => {
  it("is the token's file under the calendar's public id, Spanish carrying ?locale=es, and nothing without an origin", () => {
    expect(calendarFileUrl("https://app.bis-rgv.com", "pub1", "tok123", "en")).toBe("https://app.bis-rgv.com/b/pub1/ics/tok123");
    expect(calendarFileUrl("https://app.bis-rgv.com", "pub1", "tok123", "es")).toBe("https://app.bis-rgv.com/b/pub1/ics/tok123?locale=es");
    expect(calendarFileUrl(null, "pub1", "tok123", "en")).toBe("");
  });
});
