import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { COMPLAINT_ERROR_MARKER } from "@/lib/email/failure-reason";

vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));

const { ActivityTimeline } = await import("./activity-timeline");

const message = (status: string, error: string | null) => ({
  id: "msg1", created_at: "2026-10-05T10:00:00Z", direction: "outbound",
  subject: null, body: "Hi there", status, channel: "sms", error,
});

const html = (status: string, error: string | null) => renderToStaticMarkup(createElement(ActivityTimeline, {
  accountId: "a1", contactId: "c1", contactHasEmail: false, contactHasPhone: false,
  smsGate: { ok: false, reason: "a2p_not_approved" }, smsBlockedLine: null, emailNoticeLine: null,
  notes: [], tasks: [], holdOpenTaskIds: [], opportunities: [], submissions: [],
  messages: [message(status, error)],
  emailAction: async () => {}, smsAction: async () => {},
} as never));

/**
 * D-017's contact-timeline half — same defect `message-thread.test.ts`
 * pins for the Conversations thread: the stored failure reason
 * (`messages.error`) was never shown here either.
 */
describe("the timeline's message failure reason (D-017)", () => {
  it("shows the plain-language complaint reason for a bounce carrying the complaint marker (mutation: drop the failure-reason paragraph → FAILS)", () => {
    expect(renderedText(html("bounced", COMPLAINT_ERROR_MARKER)))
      .toContain(m["conversations.failureReason.complained"]);
  });

  it("shows the generic failed reason and never the raw provider string", () => {
    const raw = "550 5.1.1 mailbox unavailable (Google)";
    const text = renderedText(html("failed", raw));
    expect(text).toContain(m["conversations.failureReason.failed"]);
    expect(text).not.toContain(raw);
  });

  it("shows no failure reason for a message that sent cleanly", () => {
    const text = renderedText(html("sent", null));
    expect(text).not.toContain(m["conversations.failureReason.failed"]);
    expect(text).not.toContain(m["conversations.failureReason.bounced"]);
  });
});
