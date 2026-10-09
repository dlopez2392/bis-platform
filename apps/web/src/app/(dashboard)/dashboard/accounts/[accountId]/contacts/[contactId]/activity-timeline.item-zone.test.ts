import { describe, it, expect, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";
import { renderedText } from "@/lib/rendered-text";

/**
 * D-010: every row's own timestamp (and the day separator grouping rows
 * under it) rendered through `formatDate`/`formatDateTime` — the RUNTIME's
 * zone (server or browser, whichever formats it), never the account's,
 * even though `taskDueDateText` right beside it already prints a due date
 * in the account's own zone (D-006). The fix threads the SAME `timezone`
 * prop into every row's own timestamp, not just a task's due date.
 *
 * `process.env.TZ` stands in for "whichever zone the runtime happens to be
 * in" — forced to a zone that disagrees with the account's own, so the test
 * fails the same way regardless of which machine (or CI) runs it.
 */
vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));

const { ActivityTimeline } = await import("./activity-timeline");

const note = (createdAt: string) => ({
  id: "n1", body: "Called back", pinned: false, author_id: "user_test", created_at: createdAt,
});

function html(createdAt: string, timezone: string): string {
  return renderToStaticMarkup(createElement(ActivityTimeline, {
    accountId: "a1", contactId: "c1", contactHasEmail: false, contactHasPhone: false,
    smsGate: { ok: false, reason: "a2p_not_approved" }, smsBlockedLine: null, emailNoticeLine: null,
    notes: [note(createdAt)], tasks: [], holdOpenTaskIds: [], opportunities: [], submissions: [], messages: [],
    emailAction: async () => {}, smsAction: async () => {},
    timezone,
  } as never));
}

describe("the timeline's own row timestamps render in the ACCOUNT's zone, not the runtime's (D-010)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("a note's clock time follows the account's zone (Berlin), not the runtime's (Chicago)", () => {
    vi.stubEnv("TZ", "America/Chicago");
    const out = renderedText(html("2026-10-08T05:00:00.000Z", "Europe/Berlin"));
    // 05:00 UTC is 7:00 AM in Berlin but 12:00 AM in Chicago — the runtime
    // zone this test pins so the assertion means the same thing anywhere.
    expect(out).toContain("7:00 AM");
    expect(out).not.toContain("12:00 AM");
  });

  it("the day separator groups a row under the account's calendar day, not the runtime's (mutation: group by the runtime zone instead → FAILS)", () => {
    vi.stubEnv("TZ", "America/Chicago");
    // 23:30 UTC on the 8th is still Oct 8 in Chicago, but already Oct 9 in
    // Berlin — the account's own day, which is what the separator must name.
    const out = renderedText(html("2026-10-08T23:30:00.000Z", "Europe/Berlin"));
    expect(out).toContain("Oct 9, 2026");
    expect(out).not.toContain("Oct 8, 2026");
  });
});
