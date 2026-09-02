import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EventRow } from "@bis/db";
import { ActivityCard } from "./activity-card";

// Same shape as calls-chart-card.test.ts: a server component with no client
// state is just a function of its props, so `renderToStaticMarkup` pins the
// served output directly.

const NOW = new Date("2027-01-04T12:00:00.000Z");

function row(overrides: Partial<EventRow>): EventRow {
  return {
    id: "e1", type: "booking.created", actorType: "system", payload: {},
    createdAt: "2027-01-04T11:50:00.000Z", // 10m before NOW
    ...overrides,
  };
}

function render(events: EventRow[], now: Date = NOW) {
  return renderToStaticMarkup(createElement(ActivityCard, { accountId: "acct1", events, now }));
}

describe("ActivityCard", () => {
  it("booking.created renders the curated line, a relative time, and never the raw type string", () => {
    const html = render([row({ id: "e1", type: "booking.created" })]);
    expect(html).toContain("A new appointment was booked.");
    expect(html).toContain("10m");
    expect(html).not.toContain("booking.created");
  });

  it("booking.cancelled (public cancel-link path) and booking.status_changed→cancelled (operator/reschedule path) fold into the SAME line", () => {
    const html = render([
      row({ id: "e1", type: "booking.cancelled" }),
      row({ id: "e2", type: "booking.status_changed", payload: { status: "cancelled" } }),
    ]);
    const matches = html.match(/An appointment was cancelled\./g) ?? [];
    expect(matches).toHaveLength(2);
    expect(html).not.toContain("booking.status_changed");
  });

  it("booking.status_changed→completed and →no_show render their own distinct lines", () => {
    const html = render([
      row({ id: "e1", type: "booking.status_changed", payload: { status: "completed" } }),
      row({ id: "e2", type: "booking.status_changed", payload: { status: "no_show" } }),
    ]);
    expect(html).toContain("An appointment was completed.");
    expect(html).toContain("An appointment was marked as a no-show.");
  });

  it("an unrecognized booking.status_changed status renders nothing for that row (silent skip, not a fabricated line)", () => {
    const html = render([row({ id: "e1", type: "booking.status_changed", payload: { status: "booked" } })]);
    expect(html).toContain(m_activityEmpty());
  });

  it("form.submitted renders the curated lead line", () => {
    const html = render([row({ id: "e1", type: "form.submitted", payload: { formId: "f1" } })]);
    expect(html).toContain("A new lead came in through your form.");
    expect(html).not.toContain("form.submitted");
  });

  it("call.recorded resolves payload.outcome through the calls list's OWN OUTCOMES labels — never the raw enum value", () => {
    const html = render([row({ id: "e1", type: "call.recorded", payload: { callId: "c1", outcome: "booked" } })]);
    expect(html).toContain("Call outcome: Booked.");
    expect(html).not.toContain("call.recorded");
  });

  it("an unrecognized call outcome is skipped silently, never rendered raw", () => {
    const html = render([
      row({ id: "e1", type: "call.recorded", payload: { callId: "c1", outcome: "some-future-outcome" } }),
    ]);
    expect(html).toContain(m_activityEmpty());
    expect(html).not.toContain("some-future-outcome");
  });

  it("unknown/uncurated event types (real ledger types outside this task's curated set) are skipped silently", () => {
    const html = render([
      row({ id: "e1", type: "opportunity.created", payload: { value: 500 } }),
      row({ id: "e2", type: "contact.created", payload: {} }),
      row({ id: "e3", type: "account.created", payload: {} }),
    ]);
    expect(html).toContain(m_activityEmpty()); // nothing curated → the empty state shows
    expect(html).not.toContain("opportunity.created");
    expect(html).not.toContain("contact.created");
    expect(html).not.toContain("account.created");
  });

  it("mixed feed: curated rows render in the order given (already newest-first from the DB), skipped types vanish without a gap", () => {
    const html = render([
      row({ id: "e1", type: "call.recorded", payload: { outcome: "spam" } }),
      row({ id: "e2", type: "note.created" }), // skipped
      row({ id: "e3", type: "booking.created" }),
    ]);
    const callIdx = html.indexOf("Call outcome: Spam.");
    const bookingIdx = html.indexOf("A new appointment was booked.");
    expect(callIdx).toBeGreaterThan(-1);
    expect(bookingIdx).toBeGreaterThan(callIdx);
  });

  it("empty state: no events at all", () => {
    const html = render([]);
    expect(html).toContain(m_activityEmpty());
  });

  it("the footer's Add-opportunity link renders in every state — populated AND empty — and points at the pipeline page", () => {
    const populated = render([row({ id: "e1" })]);
    const empty = render([]);
    expect(populated).toContain("Add opportunity");
    expect(populated).toContain("/dashboard/accounts/acct1/pipeline");
    expect(empty).toContain("Add opportunity");
    expect(empty).toContain("/dashboard/accounts/acct1/pipeline");
  });
});

function m_activityEmpty(): string {
  return "Bookings, form leads, and call outcomes appear here as they happen.";
}
