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
  conversations?: unknown[]; timezone?: string; locale?: "en" | "es";
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

  // F-085 follow-up (Task B): the pager, its aria-label and the unread
  // badge's own aria-label all read the `locale` prop the page already
  // threads through, instead of a bare English m[...] lookup.
  it("in Spanish: the pager and the unread badge read Spanish (mutation: hard-code m[key] instead of t(m, key, locale) → FAILS)", () => {
    const html = render({
      olderHref: "/dashboard/accounts/a1/conversations?before=xyz",
      newerHref: "/dashboard/accounts/a1/conversations",
      conversations: [{ ...ROW, unreadCount: 2 }],
      locale: "es",
    });
    expect(html).toContain(m["conversations.older.es"]);
    expect(html).toContain(m["conversations.newer.es"]);
    expect(html).toContain(`aria-label="${m["conversations.pagesLabel.es"]}"`);
    expect(html).toContain(`aria-label="2 ${m["conversations.unread.es"]}"`);
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
/**
 * S-47e Task 12 (spec 5.12.4): a shared number's holding thread names its number instead of "Caller" —
 * never the fixture's own "Caller" first name, which 0098 itself stores for the record. Each row also
 * gains a `data-conversation-row` hook for Task 16's e2e locator.
 */
describe("ConversationList names a shared number's holding thread (S-47e Task 12)", () => {
  const HOLDING_ROW = {
    id: "convoH", contactId: "ctH", contactFirstName: "Caller", contactLastName: null,
    lastMessageAt: "2026-10-08T10:00:00Z", lastMessagePreview: "hi", unreadCount: 0,
    holdsSharedNumber: true, sharedNumber: "+19565550142",
  };

  it("renders 'Shared number (956) 555-0142', never 'Caller' (mutation: fall back to contactDisplayName always -> FAILS)", () => {
    const html = render({ conversations: [HOLDING_ROW] });
    expect(html.replace(/<[^>]+>/g, "")).toContain("Shared number (956) 555-0142");
    expect(html).not.toContain("Caller");
  });

  it("in Spanish, marked Spanish (mutation: hard-code English -> FAILS; mutation: no lang on the row's name -> FAILS)", () => {
    const html = render({ conversations: [HOLDING_ROW], locale: "es" });
    expect(html).toContain('<span lang="es" class="min-w-0 truncate">Número compartido</span>');
  });

  it("the number is never cut: the words truncate, the formatted number keeps its width (T17 design review I-3; mutation: one truncated span -> FAILS)", () => {
    const html = render({ conversations: [HOLDING_ROW] });
    expect(html).toContain('<span lang="en" class="min-w-0 truncate">Shared number</span> <span class="shrink-0 tabular-nums">(956) 555-0142</span>');
  });

  it("an ordinary row still names the contact, and carries data-conversation-row (mutation: drop the hook -> FAILS)", () => {
    const html = render({ conversations: [ROW] });
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain(`data-conversation-row="${ROW.id}"`);
  });
});

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
