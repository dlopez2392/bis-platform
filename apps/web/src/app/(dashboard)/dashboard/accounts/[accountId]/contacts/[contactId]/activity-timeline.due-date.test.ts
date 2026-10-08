import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import { zonedTimeToUtc } from "@/lib/booking/slots";

/** The SAME minute-by-minute search `actions.ts`'s own `firstValidInstant`
 *  uses, reproduced here rather than imported (that one is a private
 *  "use server" module helper) — a REAL computed instant, not a guessed
 *  ISO literal, since hand-computing a DST transition's exact UTC offset
 *  by hand is exactly the kind of arithmetic this whole fix exists to not
 *  trust. */
function firstValidInstant(y: number, mo: number, d: number, zone: string): string {
  for (let minutes = 0; minutes < 4 * 60; minutes++) {
    const at = zonedTimeToUtc(y, mo, d, Math.floor(minutes / 60), minutes % 60, zone);
    if (at) return at.toISOString();
  }
  throw new Error("no valid instant found in a 4-hour window");
}

vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));

const { ActivityTimeline } = await import("./activity-timeline");

const task = (dueAt: string | null) => ({
  id: "t1", title: "Follow up", due_at: dueAt, completed_at: null,
  created_at: "2026-10-05T10:00:00Z", consent_event_id: null,
});

const html = (dueAt: string, timezone: string) => renderToStaticMarkup(createElement(ActivityTimeline, {
  accountId: "a1", contactId: "c1", contactHasEmail: false, contactHasPhone: false,
  smsGate: { ok: false, reason: "a2p_not_approved" }, smsBlockedLine: null, emailNoticeLine: null,
  notes: [], tasks: [task(dueAt)], holdOpenTaskIds: [], opportunities: [], submissions: [], messages: [],
  emailAction: async () => {}, smsAction: async () => {},
  timezone,
} as never));

// Review: D-006's fix (actions.ts's dueAtInAccountZone) saves a task's
// dueAt as midnight in the ACCOUNT's own zone — this card used to render
// it with formatDateUTC, which only reads back the right day for a zone
// WEST of UTC (where the whole platform's accounts happen to live today).
// A zone EAST of UTC (Berlin, Tokyo) reads the PREVIOUS day instead, since
// midnight there is already yesterday in UTC.
describe("the timeline's task due date renders in the ACCOUNT's zone, not UTC (review)", () => {
  it("Chicago (west of UTC): midnight Oct 8 Chicago (05:00 UTC) reads back as Oct 8", () => {
    const out = renderedText(html("2026-10-08T05:00:00.000Z", "America/Chicago"));
    expect(out).toContain("Oct 8, 2026");
    expect(out).not.toContain("Oct 7, 2026");
  });

  it("Berlin (east of UTC): midnight Oct 8 Berlin (22:00 UTC Oct 7) reads back as Oct 8, not Oct 7 (mutation: render with formatDateUTC instead → FAILS)", () => {
    const out = renderedText(html("2026-10-07T22:00:00.000Z", "Europe/Berlin"));
    expect(out).toContain("Oct 8, 2026");
    expect(out).not.toContain("Oct 7, 2026");
  });

  it("Havana DST-gap day (2027-03-14): the first-valid-instant fallback still reads back as the 14th, not the 13th", () => {
    const at = firstValidInstant(2027, 3, 14, "America/Havana");
    const out = renderedText(html(at, "America/Havana"));
    expect(out).toContain("Mar 14, 2027");
    expect(out).not.toContain("Mar 13, 2027");
  });
});
