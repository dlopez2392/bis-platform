import { describe, it, expect, vi, beforeEach } from "vitest";
import { feedFirstName, feedEvents, feedIcsFor, type FeedContentRow } from "./feed-content";
import { bookingUid } from "./ics";

const row = (over: Partial<FeedContentRow> = {}): FeedContentRow => ({
  id: "b-1", status: "booked", starts_at: "2026-11-03T15:00:00Z", ends_at: "2026-11-03T16:00:00Z",
  updated_at: "2026-11-01T12:00:00Z", created_at: "2026-11-01T12:00:00Z", first_name: "Maria Lopez",
  rootId: "root-1", depth: 0, meeting_type: null, ...over,
});
const O = { locale: "en" as const, meetingType: "in_person" as const, origin: "https://app.bis-rgv.com", accountId: "acc-1" };
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("feedFirstName — first name only", () => {
  it.each([
    ["Maria Lopez", "Maria"], ["  José  Ángel ", "José"], ["956-555-0100", "Customer"], ["a@b.co", "Customer"],
    ["", "Customer"], [null, "Customer"], ["Unknown", "Customer"], ["Desconocido", "Customer"],
  ])("%s → %s (mutation: return raw.trim() → FAILS)", (raw, want) => {
    expect(feedFirstName(raw as string | null, "en")).toBe(want);
  });
  it("is Cliente in Spanish and never longer than 40 characters", () => {
    expect(feedFirstName(null, "es")).toBe("Cliente");
    expect(Array.from(feedFirstName("Ñ".repeat(60), "en"))).toHaveLength(40);
  });
});

describe("feedEvents", () => {
  it("one event per appointment: UID from the chain's root, SEQUENCE its depth, DTSTAMP the row's updated_at (mutation: uid from row.id → FAILS)", () => {
    const [e] = feedEvents([row({ id: "b-3", rootId: "root-1", depth: 2 })], O);
    expect(e!.uid).toBe(bookingUid("root-1"));
    expect(e!.sequence).toBe(2);
    expect(e!.stampedAt.toISOString()).toBe("2026-11-01T12:00:00.000Z");
  });
  it("two live rows of one chain become ONE event, the deeper row (mutation: drop the dedupe → FAILS)", () => {
    const events = feedEvents([row({ id: "b-1", depth: 0, starts_at: "2026-11-03T15:00:00Z" }), row({ id: "b-2", depth: 1, starts_at: "2026-11-04T15:00:00Z", ends_at: "2026-11-04T16:00:00Z" })], O);
    expect(events).toHaveLength(1);
    expect(events[0]!.startsAt.toISOString()).toBe("2026-11-04T15:00:00.000Z");
  });
  it("names the kind from the meeting type and marks a no-show", () => {
    expect(feedEvents([row()], { ...O, meetingType: "phone" })[0]!.summary).toBe("Phone call: Maria");
    expect(feedEvents([row({ status: "no_show" })], { ...O, locale: "es" })[0]!.summary).toBe("No se presentó · Cita: Maria");
  });
  // F-046 part 1 (plan Task 7): a booking's own meeting type (0107) decides its kind; NULL is the calendar's.
  it("a row's own meeting type names its kind, over the calendar's (mutation: read o.meetingType only → FAILS)", () => {
    const [video, phone] = feedEvents([
      row({ id: "b-v", rootId: "root-v", meeting_type: "video" }),
      row({ id: "b-p", rootId: "root-p", meeting_type: "phone", starts_at: "2026-11-04T15:00:00Z", ends_at: "2026-11-04T16:00:00Z" }),
    ], { ...O, meetingType: "in_person" });
    expect(video!.summary).toBe("Video call: Maria");
    expect(phone!.summary).toBe("Phone call: Maria");
  });
  it("a row with no meeting type of its own reads the calendar's (mutation: default a null row to in_person → FAILS)", () => {
    expect(feedEvents([row({ meeting_type: null })], { ...O, meetingType: "phone" })[0]!.summary).toBe("Phone call: Maria");
  });
  it("each event's link opens that booking's drawer, ?job=<row id> (mutation: the old page link → FAILS)", () => {
    const events = feedEvents([
      row({ id: "b-1", rootId: "root-1" }),
      row({ id: "b-9", rootId: "root-9", starts_at: "2026-11-04T15:00:00Z", ends_at: "2026-11-04T16:00:00Z" }),
    ], O);
    expect(events.map((e) => e.description)).toEqual([
      "Open in BIS: https://app.bis-rgv.com/dashboard/accounts/acc-1/calendar?job=b-1",
      "Open in BIS: https://app.bis-rgv.com/dashboard/accounts/acc-1/calendar?job=b-9",
    ]);
  });
  it("a name holding $& is printed as typed, never expanded by String.replace (mutation: replace with a string, not a function → FAILS)", () => {
    expect(feedEvents([row({ first_name: "$&x" })], O)[0]!.summary).toBe("Appointment: $&x");
  });
});

/** RFC 5545 §3.1: a folded line continues with CRLF + one space (same unfolding as ics.test.ts). */
const unfold = (s: string) => s.replace(/\r\n /g, "");

describe("feedIcsFor — data minimisation and language", () => {
  it("carries nothing but the time, the kind, the first name and the dashboard link (mutation: put the last name in SUMMARY → FAILS)", () => {
    const ics = feedIcsFor({ ...O, brandName: "Rio Roofing", rows: [row({ first_name: "Maria Lopez" })] });
    expect(ics).not.toMatch(/Lopez|ORGANIZER|ATTENDEE|LOCATION|URL:/);
    expect(ics).toContain("SUMMARY:Appointment: Maria");
    // The dashboard-link line is past 75 octets and so is RFC-5545-folded (ics.ts's `fold`,
    // pinned by ics.test.ts's own 75-octet test); unfold before the plain containment check.
    // F-046 part 1: the link opens this booking's drawer, and the line ENDS there.
    expect(unfold(ics)).toContain("DESCRIPTION:Open in BIS: https://app.bis-rgv.com/dashboard/accounts/acc-1/calendar?job=b-1\r\n");
    expect(ics).toContain("NAME:Rio Roofing bookings");
  });
  it("is Spanish end to end for es, and names the calendar Citas with no brand", () => {
    const ics = feedIcsFor({ ...O, locale: "es", brandName: "", rows: [row()] });
    expect(ics).toContain("NAME:Citas\r\n");
    expect(ics).toContain("SUMMARY:Cita: Maria");
    expect(ics).toContain("DESCRIPTION:Ver en BIS:");
    // "bookings" alone would also match every event's UID domain (ics.ts's UID_DOMAIN,
    // "bookings.bis-rgv.com", fixed and locale-independent by design); the English-leak
    // signal this guards is the capitalised, standalone calendar-name word "Bookings".
    expect(ics).not.toMatch(/Appointment|Open in BIS|\bBookings\b/);
  });
});
