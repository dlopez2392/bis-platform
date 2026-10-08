import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));

const { ActivityTimeline } = await import("./activity-timeline");

const message = (status: string) => ({
  id: "msg1", created_at: "2026-10-05T10:00:00Z", direction: "outbound",
  subject: null, body: "Hi there", status, channel: "sms",
});

const html = (status: string) => renderToStaticMarkup(createElement(ActivityTimeline, {
  accountId: "a1", contactId: "c1", contactHasEmail: false, contactHasPhone: false,
  smsGate: { ok: false, reason: "a2p_not_approved" }, smsBlockedLine: null, emailNoticeLine: null,
  notes: [], tasks: [], holdOpenTaskIds: [], opportunities: [], submissions: [],
  messages: [message(status)],
  emailAction: async () => {}, smsAction: async () => {},
} as never));

// D-014: the timeline printed the RAW `status` column ("failed", "sent")
// instead of its label — exactly the dot-and-word-style defect DESIGN.md
// rule 3 names for colour, applied here to plain text: a column value is
// never shown to an operator as itself when a label for it already exists
// (lib/labels.ts's own MESSAGE_STATUS_LABEL, the SAME map conversations.spec
// and the opportunity row two lines below it already use).
describe("the timeline's message status (D-014)", () => {
  it("shows the label, not the raw column value, for every known status (mutation: print item.status directly → FAILS)", () => {
    expect(renderedText(html("failed"))).toContain(m["conversations.status.failed"]);
    expect(renderedText(html("failed"))).not.toContain(" · failed");
    expect(renderedText(html("sent"))).toContain(m["conversations.status.sent"]);
    expect(renderedText(html("sent"))).not.toContain(" · sent");
  });

  it("falls back to the raw value for an unknown status rather than rendering nothing", () => {
    expect(renderedText(html("brand_new_status"))).toContain("brand_new_status");
  });
});
