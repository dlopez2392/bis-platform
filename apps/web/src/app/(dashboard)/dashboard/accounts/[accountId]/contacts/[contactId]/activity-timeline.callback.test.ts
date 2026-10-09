import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// "use server" actions and the client composer are not rendered here; only the task rows are read.
vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));

const { ActivityTimeline } = await import("./activity-timeline");

const task = (id: string, title: string, call_id: string | null) =>
  ({ id, title, due_at: null, completed_at: null, created_at: "2026-10-09T17:00:00Z", consent_event_id: null, call_id });

describe("a callback To do on the contact's timeline (F-033; DESIGN.md provenance)", () => {
  it("the To do a call left carries the receptionist's author mark; one a person typed does not (mutation: mark every task → FAILS; mark none → FAILS)", () => {
    const out = renderToStaticMarkup(createElement(ActivityTimeline, {
      accountId: "a1", contactId: "c1", contactHasEmail: false, contactHasPhone: false,
      smsGate: { ok: false, reason: "a2p_not_approved" }, smsBlockedLine: null, emailNoticeLine: null,
      notes: [], tasks: [task("t1", "Call back at 9565061545: Roof leak", "call1"), task("t2", "Order shingles", null)],
      holdOpenTaskIds: [], opportunities: [], submissions: [], messages: [],
      emailAction: async () => {}, smsAction: async () => {}, timezone: "America/Chicago",
    } as never));
    const rows = out.split("<li").slice(1);
    expect(rows.find((r) => r.includes("Roof leak"))).toContain("Sofía · AI");
    expect(rows.find((r) => r.includes("Order shingles"))).not.toContain("· AI");
  });
});
