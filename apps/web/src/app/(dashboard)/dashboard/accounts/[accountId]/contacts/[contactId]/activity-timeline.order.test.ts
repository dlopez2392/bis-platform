import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => createElement("div", { "data-composer-stub": "" }) }));
const { ActivityTimeline } = await import("./activity-timeline");
const { legacyTimeline } = await import("./activity-timeline.fixture");

const html = renderToStaticMarkup(createElement(ActivityTimeline, legacyTimeline({
  accountId: "a1", contactId: "c1", contactHasEmail: true, contactHasPhone: false, smsGate: null,
  smsBlockedLine: null, emailNoticeLine: null,
  notes: [{ id: "n1", created_at: "2026-10-05T10:00:00Z", body: "first note" }],
  tasks: [], holdOpenTaskIds: [], opportunities: [], submissions: [], messages: [],
  emailAction: async () => {}, smsAction: async () => {}, timezone: "America/Chicago",
}) as never));

describe("the timeline in its record card (S-03 part 1, spec §9.4)", () => {
  it("the composer comes first, then the add-To-do row, then the rows (mutation: move the composer back to the foot -> FAILS)", () => {
    const composer = html.indexOf("data-composer-stub");
    const todo = html.indexOf('id="record-add-todo"');
    const row = html.indexOf("first note");
    expect(composer).toBeGreaterThan(-1);
    expect(composer).toBeLessThan(todo);
    expect(todo).toBeLessThan(row);
  });
  it("carries no card chrome or title of its own: RecordCard's 'Activity' is the one seen (mutation: keep the Card -> FAILS)", () => {
    expect(html).not.toContain('data-slot="card"');
    // S-10 T0 dead-key sweep missed this one: "contact.activity" (the OLD title this component used to
    // render itself) named no live reference by the AST scan except this negative check, so it is
    // deleted here (S-10 T3) rather than translated — checked against the literal English it used to
    // read, which is exactly what "no title of its own" means regardless of locale.
    expect(html).not.toContain(">Activity<");
  });
});
