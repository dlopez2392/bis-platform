import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

// "use server" actions and the client composer are not rendered here; only the task rows are read.
vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));

const { ActivityTimeline } = await import("./activity-timeline");

const task = (id: string, title: string, consent_event_id: string | null) =>
  ({ id, title, due_at: null, completed_at: null, created_at: "2026-10-05T10:00:00Z", consent_event_id });
const html = (holdOpenTaskIds: string[]) => renderToStaticMarkup(createElement(ActivityTimeline, {
  accountId: "a1", contactId: "c1", contactHasEmail: false, contactHasPhone: false,
  smsGate: { ok: false, reason: "a2p_not_approved" }, smsBlockedLine: null, emailNoticeLine: null,
  notes: [], tasks: [task("t_hold", "Ana may have asked to stop texts", "h1"), task("t_plain", "Call back", null)],
  holdOpenTaskIds, opportunities: [], submissions: [], messages: [],
  emailAction: async () => {}, smsAction: async () => {},
} as never));
const doneButtons = (markup: string) => (markup.match(new RegExp(`>${m["contact.done"]}<`, "g")) ?? []).length;

describe("the contact timeline and a hold's To-do (review R3-N1, G21)", () => {
  it("a To-do whose number is still on hold shows the timeline hint (\"Close this one from the To do page.\") INSTEAD of Done; a plain To-do keeps its Done (mutation: render Done for every open task → two Done buttons, FAILS)", () => {
    const out = html(["t_hold"]);
    expect(renderedText(out)).toContain(m["todo.consent.timelineHint"]);
    expect(doneButtons(out)).toBe(1);
  });

  it("once the hold is decided the same To-do offers Done again (the discriminator; mutation: hint for every linked task → FAILS)", () => {
    const out = html([]);
    expect(renderedText(out)).not.toContain(m["todo.consent.timelineHint"]);
    expect(doneButtons(out)).toBe(2);
  });
});
