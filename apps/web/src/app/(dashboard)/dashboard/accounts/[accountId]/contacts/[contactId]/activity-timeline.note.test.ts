import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));

const { ActivityTimeline } = await import("./activity-timeline");

const html = (body: string) => renderToStaticMarkup(createElement(ActivityTimeline, {
  accountId: "a1", contactId: "c1", contactHasEmail: false, contactHasPhone: false,
  smsGate: { ok: false, reason: "a2p_not_approved" }, smsBlockedLine: null, emailNoticeLine: null,
  notes: [{ id: "n1", created_at: "2026-10-05T10:00:00Z", body }],
  tasks: [], holdOpenTaskIds: [], opportunities: [], submissions: [],
  messages: [],
  emailAction: async () => {}, smsAction: async () => {},
} as never));

/**
 * (Review fix, review-9f383e51.) A note typed with paragraph breaks lost
 * them on this screen — the `<p>` rendering it carried neither
 * `whitespace-pre-wrap` (so a `\n` collapsed to a space, same CSS default
 * that motivated D-015's textarea fix) nor `break-words` (so one long
 * unbroken word could push the card wider than its column). The message
 * bubble two cases below (`:333`) already carries both; this is the same
 * fix for the one other place a person's own multi-line text renders.
 */
describe("the timeline's note body (review fix)", () => {
  it("carries whitespace-pre-wrap and break-words, matching the message bubble's own class (mutation: drop whitespace-pre-wrap → FAILS)", () => {
    const markup = html("line one\nline two");
    expect(markup).toMatch(/class="[^"]*\bwhitespace-pre-wrap\b[^"]*"[^>]*>line one\nline two/);
    expect(markup).toMatch(/class="[^"]*\bbreak-words\b/);
  });
});
