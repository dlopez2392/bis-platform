import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { ConversationList } from "./conversation-list";

/**
 * D-019. The inbox list pages now (`listConversations`'s cursor), and
 * DESIGN.md's "Paged lists" rule is explicit: Older/Newer carrying
 * `?before=`, and exactly ONE pager. This is the one place it renders.
 */
function render(over: {
  olderHref?: string; newerHref?: string; before?: string;
  conversations?: unknown[]; timezone?: string;
} = {}): string {
  return renderToStaticMarkup(createElement(ConversationList, {
    conversations: [],
    base: "/dashboard/accounts/a1/conversations",
    activeId: undefined,
    timezone: "UTC",
    ...over,
  } as never));
}

const ROW = {
  id: "convo1", contactId: "contact1", contactFirstName: "Ada", contactLastName: "Lovelace",
  lastMessageAt: "2026-10-08T10:00:00Z", lastMessagePreview: "hi", unreadCount: 0,
};

describe("ConversationList's pager (D-019)", () => {
  it("renders no pager when neither href is given (a short, unpaged list)", () => {
    const html = render();
    expect(html).not.toContain(m["conversations.older"]);
    expect(html).not.toContain(m["conversations.newer"]);
  });

  it("renders exactly one Older link carrying the given href (mutation: drop the pager nav → FAILS)", () => {
    const html = render({ olderHref: "/dashboard/accounts/a1/conversations?before=xyz" });
    expect(html).toContain(m["conversations.older"]);
    expect(html).toContain('href="/dashboard/accounts/a1/conversations?before=xyz"');
    // Exactly one pager nav, not a second stacked below it.
    expect(html.match(/aria-label="Pages"/g)?.length).toBe(1);
  });

  it("renders a Newer link when given one", () => {
    const html = render({ newerHref: "/dashboard/accounts/a1/conversations" });
    expect(html).toContain(m["conversations.newer"]);
  });

  // DESIGN.md "Paged lists": "Selection survives a page change." A row's
  // link carried only `?c=<id>` — opening a thread from page 2 of the
  // inbox and then going Back (ConversationBack's own href) landed on
  // page one, silently losing the operator's place in the list.
  it("carries the current `before` cursor on every row link, so opening a thread does not lose the page (mutation: drop `before` from the row href → FAILS)", () => {
    const html = render({ conversations: [ROW], before: "CURSOR123" });
    expect(html).toContain('href="/dashboard/accounts/a1/conversations?before=CURSOR123&amp;c=convo1"');
  });

  it("falls back to the bare `?c=<id>` link when there is no cursor (page one)", () => {
    const html = render({ conversations: [ROW] });
    expect(html).toContain('href="/dashboard/accounts/a1/conversations?c=convo1"');
  });
});

/**
 * A row's own `lastMessageAt` rendered through `formatDateTime` — the
 * RUNTIME's zone (server or browser), never the account's — the same bug
 * D-010 fixed for the contacts list and the activity timeline.
 *
 * `process.env.TZ` stands in for "whichever zone the runtime happens to be
 * in", pinned to one that disagrees with the account's own zone so the test
 * fails the same way on any machine (or CI).
 */
describe("ConversationList's row timestamp renders in the ACCOUNT's zone, not the runtime's", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("a row's lastMessageAt follows the account's zone (Berlin), not the runtime's (Chicago)", () => {
    vi.stubEnv("TZ", "America/Chicago");
    // 05:00 UTC is 7:00 AM in Berlin but 12:00 AM (midnight) in Chicago.
    const html = render({
      conversations: [{ ...ROW, lastMessageAt: "2026-10-08T05:00:00.000Z" }],
      timezone: "Europe/Berlin",
    });
    const text = renderedText(html);
    expect(text).toContain("7:00 AM");
    expect(text).not.toContain("12:00 AM");
  });
});
