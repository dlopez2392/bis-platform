import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { ConversationList } from "./conversation-list";

/**
 * D-019. The inbox list pages now (`listConversations`'s cursor), and
 * DESIGN.md's "Paged lists" rule is explicit: Older/Newer carrying
 * `?before=`, and exactly ONE pager. This is the one place it renders.
 */
function render(over: { olderHref?: string; newerHref?: string } = {}): string {
  return renderToStaticMarkup(createElement(ConversationList, {
    conversations: [],
    base: "/dashboard/accounts/a1/conversations",
    activeId: undefined,
    ...over,
  } as never));
}

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
});
