import { describe, it, expect } from "vitest";
import { bookingIcs, bookingUid, type BookingIcsInput } from "./ics";
import { zonedTimeToUtc } from "./slots";

/**
 * F-048's add-to-calendar file. The slot engine is the reference for every
 * instant below: a booking's `starts_at` IS a `zonedTimeToUtc` result, so the
 * file must carry exactly that instant, whatever the account's zone did that
 * day.
 */

const BASE: BookingIcsInput = {
  uid: bookingUid("2f6c1e0a-0000-4000-8000-000000000001"),
  sequence: 0,
  startsAt: new Date("2026-08-26T19:00:00Z"),
  endsAt: new Date("2026-08-26T20:00:00Z"),
  stampedAt: new Date("2026-08-20T12:34:56.789Z"),
  summary: "Appointment with Rio Roofing",
};

/** RFC 5545 §3.1: a folded line continues with CRLF + one space. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, "").split("\r\n");
}

function prop(ics: string, name: string): string[] {
  return unfold(ics).filter((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`))
    .map((l) => l.slice(l.indexOf(":") + 1));
}

/** "20260308T080000Z" back to an instant, by the RFC's own grammar. */
function utcOf(value: string): Date {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!m) throw new Error(`not a UTC DATE-TIME: ${value}`);
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
}

describe("bookingIcs — the add-to-calendar file", () => {
  it("is one VEVENT inside a PUBLISH VCALENDAR, every line CRLF-terminated (mutation: join with \\n → FAILS)", () => {
    const ics = bookingIcs(BASE)!;
    expect(ics.endsWith("\r\n")).toBe(true);
    // No bare LF anywhere: every \n is preceded by \r.
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
    const lines = unfold(ics).filter(Boolean);
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines.at(-1)).toBe("END:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain("METHOD:PUBLISH");
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(lines.filter((l) => l === "END:VEVENT")).toHaveLength(1);
    expect(prop(ics, "PRODID")).toHaveLength(1);
  });

  it("carries the UID, SEQUENCE and SUMMARY it was given, and DTSTAMP in UTC to the second", () => {
    const ics = bookingIcs({ ...BASE, sequence: 2 })!;
    expect(prop(ics, "UID")).toEqual([BASE.uid]);
    expect(prop(ics, "SEQUENCE")).toEqual(["2"]);
    expect(prop(ics, "SUMMARY")).toEqual(["Appointment with Rio Roofing"]);
    expect(prop(ics, "DTSTAMP")).toEqual(["20260820T123456Z"]);
    expect(prop(ics, "STATUS")).toEqual(["CONFIRMED"]);
  });

  it("writes DTSTART and DTEND as UTC instants and never a TZID, so no calendar app's zone rules can move it (mutation: a TZID-qualified wall time → FAILS)", () => {
    const ics = bookingIcs(BASE)!;
    expect(prop(ics, "DTSTART")).toEqual(["20260826T190000Z"]);
    expect(prop(ics, "DTEND")).toEqual(["20260826T200000Z"]);
    // RFC 5545 §3.3.5: a TZID must name a VTIMEZONE in the same object. This
    // file defines none, so it must reference none.
    expect(ics).not.toContain("TZID");
    expect(ics).not.toContain("VTIMEZONE");
  });

  // Each row is a wall-clock time the slot engine made bookable, on a day the
  // zone's offset changed. The file must hold the instant the engine produced,
  // to the second (mutation: format the account-zone wall time with a Z → FAILS
  // on every row; mutation: drop the seconds/minutes field → FAILS on Kolkata).
  it.each([
    // America/Chicago spring-forward, 2026-03-08: 03:00 CDT is the first hour after the gap.
    ["America/Chicago", 2026, 3, 8, 3, 0, "20260308T080000Z"],
    // America/Chicago fall-back, 2026-11-01: 00:30 CDT, before the repeat.
    ["America/Chicago", 2026, 11, 1, 0, 30, "20261101T053000Z"],
    // America/Havana's transition is at midnight: the day starts at 01:00.
    ["America/Havana", 2026, 3, 8, 1, 0, "20260308T050000Z"],
    // America/Santiago, midnight-DST zone (southern hemisphere spring, 2026-09-06).
    ["America/Santiago", 2026, 9, 6, 9, 0, "20260906T120000Z"],
    // A half-hour zone with no DST at all.
    ["Asia/Kolkata", 2026, 8, 26, 9, 30, "20260826T040000Z"],
    // UTC+14: the date in the file is the PREVIOUS UTC day.
    ["Pacific/Kiritimati", 2026, 8, 26, 9, 0, "20260825T190000Z"],
  ] as const)("%s %i-%i-%i %i:%i local lands at %s", (zone, y, mo, d, hh, mi, expected) => {
    const startsAt = zonedTimeToUtc(y, mo, d, hh, mi, zone);
    expect(startsAt).not.toBeNull();
    const endsAt = new Date(startsAt!.getTime() + 60 * 60 * 1000);
    const ics = bookingIcs({ ...BASE, startsAt: startsAt!, endsAt })!;
    expect(prop(ics, "DTSTART")).toEqual([expected]);
    expect(utcOf(prop(ics, "DTSTART")[0]!).getTime()).toBe(startsAt!.getTime());
    expect(utcOf(prop(ics, "DTEND")[0]!).getTime()).toBe(endsAt.getTime());
  });

  it("tells the two 01:30s of a fall-back day apart: the repeated hour is two different instants an hour apart (mutation: format local wall time → both read 0130, FAILS)", () => {
    // America/Chicago, 2026-11-01: 01:30 CDT (06:30Z) and 01:30 CST (07:30Z).
    const first = bookingIcs({ ...BASE, startsAt: new Date("2026-11-01T06:30:00Z"), endsAt: new Date("2026-11-01T07:30:00Z") })!;
    const second = bookingIcs({ ...BASE, startsAt: new Date("2026-11-01T07:30:00Z"), endsAt: new Date("2026-11-01T08:30:00Z") })!;
    expect(prop(first, "DTSTART")).toEqual(["20261101T063000Z"]);
    expect(prop(second, "DTSTART")).toEqual(["20261101T073000Z"]);
  });

  it("escapes TEXT per RFC 5545 §3.3.11, so a business name cannot add a property (mutation: drop the newline escape → an injected ORGANIZER line appears, FAILS)", () => {
    const ics = bookingIcs({
      ...BASE,
      summary: "A, B; C\\D\nORGANIZER:mailto:evil@example.com",
      description: "line one\r\nline two",
    })!;
    expect(prop(ics, "SUMMARY")).toEqual(["A\\, B\\; C\\\\D\\nORGANIZER:mailto:evil@example.com"]);
    expect(prop(ics, "DESCRIPTION")).toEqual(["line one\\nline two"]);
    expect(unfold(ics).some((l) => l.startsWith("ORGANIZER"))).toBe(false);
  });

  it("folds every line at 75 octets without splitting a UTF-8 character, and unfolding gives the text back (mutation: fold at 75 characters, not octets → a line over 75 bytes, FAILS)", () => {
    const summary = "Cita con Peluquería Ñandú — ".repeat(6).trim();
    const ics = bookingIcs({ ...BASE, summary })!;
    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
      // A split multi-byte character would decode to U+FFFD.
      expect(Buffer.from(line, "utf8").toString("utf8")).not.toContain("�");
    }
    expect(prop(ics, "SUMMARY")).toEqual([summary.replace(/,/g, "\\,")]);
  });

  it("carries DESCRIPTION and URL only when given — never an empty property", () => {
    const bare = bookingIcs(BASE)!;
    expect(prop(bare, "DESCRIPTION")).toEqual([]);
    expect(prop(bare, "URL")).toEqual([]);
    const full = bookingIcs({ ...BASE, description: "Join: https://x.test/r", url: "https://x.test/b/abc/cancel/tok" })!;
    expect(prop(full, "DESCRIPTION")).toEqual(["Join: https://x.test/r"]);
    expect(prop(full, "URL")).toEqual(["https://x.test/b/abc/cancel/tok"]);
  });

  // Invalid input fails CLOSED: no file, never one at a wrong or NaN time.
  it.each([
    ["an invalid start", { startsAt: new Date("nope") }],
    ["an invalid end", { endsAt: new Date("nope") }],
    ["an end before the start", { endsAt: new Date("2026-08-26T18:00:00Z") }],
    ["an end equal to the start", { endsAt: new Date("2026-08-26T19:00:00Z") }],
    ["an invalid stamp", { stampedAt: new Date("nope") }],
    ["a negative sequence", { sequence: -1 }],
    ["a fractional sequence", { sequence: 1.5 }],
    ["a NaN sequence", { sequence: Number.NaN }],
    ["an empty uid", { uid: "" }],
  ] as const)("returns null for %s (mutation: drop the guard → a file comes back, FAILS)", (_label, patch) => {
    expect(bookingIcs({ ...BASE, ...patch })).toBeNull();
  });
});

describe("bookingUid", () => {
  it("is the same for the same booking and different for another, and is a valid RFC 5545 UID shape", () => {
    const a = bookingUid("2f6c1e0a-0000-4000-8000-000000000001");
    expect(bookingUid("2f6c1e0a-0000-4000-8000-000000000001")).toBe(a);
    expect(bookingUid("2f6c1e0a-0000-4000-8000-000000000002")).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f-]+@[a-z0-9.-]+$/);
  });
});
