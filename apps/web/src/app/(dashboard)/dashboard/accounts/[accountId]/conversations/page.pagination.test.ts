import { describe, it, expect, vi, beforeEach } from "vitest";
import { encodeCursor } from "@/lib/cursor";

/**
 * D-019. The inbox list was unpaged (`listConversations` returned every
 * conversation the account had). Same mocking shape as
 * `page.test.ts`/`calls/page.test.ts`: the server component's own DB entry
 * points, not Clerk/Supabase, for a "which branch renders, with what
 * request" question.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => ({}) }));

const listConversationsMock = vi.fn();
const getConversationSummaryMock = vi.fn();
vi.mock("@bis/db", () => ({
  listConversations: (...args: unknown[]) => listConversationsMock(...args),
  getConversationSummary: (...args: unknown[]) => getConversationSummaryMock(...args),
  listMessages: async () => [],
}));

const { default: ConversationsPage } = await import("./page");
const { renderToStaticMarkup } = await import("react-dom/server");

function route(params: { c?: string; before?: string }) {
  return {
    params: Promise.resolve({ accountId: "acct1" }),
    searchParams: Promise.resolve(params),
  };
}

function row(i: number) {
  return {
    id: `convo${i}`, contactId: `contact${i}`, contactFirstName: `C${i}`, contactLastName: null,
    lastMessageAt: `2026-10-0${1 + (i % 8)}T10:00:00Z`, lastMessagePreview: `msg ${i}`, unreadCount: 0,
  };
}

async function markup(params: { c?: string; before?: string }) {
  const html = (await ConversationsPage(route(params))) as React.ReactElement;
  return renderToStaticMarkup(html);
}

describe("ConversationsPage's pagination (D-019)", () => {
  beforeEach(() => {
    listConversationsMock.mockReset();
    getConversationSummaryMock.mockReset();
  });

  it("renders an Older link only when a FULL page came back, built from the last row's own cursor (mutation: always build it → FAILS)", async () => {
    const full = Array.from({ length: 50 }, (_, i) => row(i));
    listConversationsMock.mockResolvedValueOnce(full);
    const html = await markup({});
    const expectedCursor = encodeCursor({ v: full[49]!.lastMessageAt, id: full[49]!.id });
    expect(html).toContain(`href="/dashboard/accounts/acct1/conversations?before=${expectedCursor}"`);
  });

  it("renders no Older link for a short (non-full) page", async () => {
    listConversationsMock.mockResolvedValueOnce([row(0), row(1)]);
    const html = await markup({});
    expect(html).not.toContain("before=");
  });

  it("renders a Newer link back to page one when a `before` cursor is in effect, never otherwise", async () => {
    listConversationsMock.mockResolvedValueOnce([row(0)]);
    const withCursor = await markup({ before: encodeCursor({ v: "2026-10-01T00:00:00Z", id: "00000000-0000-0000-0000-000000000000" }) });
    expect(withCursor).toContain('href="/dashboard/accounts/acct1/conversations"');

    listConversationsMock.mockResolvedValueOnce([row(0)]);
    const noCursor = await markup({});
    // No bare link back to the base path when there is nowhere "newer" to
    // return to — distinguished from the Older assertion above by the exact
    // href, since the thread-selection links also point under this base.
    expect(noCursor).not.toContain('href="/dashboard/accounts/acct1/conversations"');
  });

  it("falls back to getConversationSummary when `c` names a conversation NOT on the current page, and opens it (mutation: drop the fallback → thread pane stays the pick-a-thread empty state → FAILS)", async () => {
    listConversationsMock.mockResolvedValueOnce([row(0), row(1)]);
    getConversationSummaryMock.mockResolvedValueOnce({
      id: "convo99", contactId: "contact99", contactFirstName: "Off", contactLastName: "Page",
      lastMessageAt: "2026-09-01T00:00:00Z", lastMessagePreview: "old thread", unreadCount: 0,
    });
    const html = await markup({ c: "convo99" });
    expect(getConversationSummaryMock).toHaveBeenCalledWith(expect.anything(), "acct1", "convo99");
    expect(html).toContain("Off Page");
  });

  it("does NOT call getConversationSummary when `c` is already on the current page", async () => {
    listConversationsMock.mockResolvedValueOnce([row(0), row(1)]);
    await markup({ c: "convo1" });
    expect(getConversationSummaryMock).not.toHaveBeenCalled();
  });

  it("shows the full-page empty state only on a COLD START (zero rows, no cursor) — a cursored zero falls through to the normal list view", async () => {
    listConversationsMock.mockResolvedValueOnce([]);
    const cold = await markup({});
    expect(cold).toContain("No conversations yet");

    listConversationsMock.mockResolvedValueOnce([]);
    const cursoredEmpty = await markup({ before: encodeCursor({ v: "2026-10-01T00:00:00Z", id: "00000000-0000-0000-0000-000000000000" }) });
    expect(cursoredEmpty).not.toContain("No conversations yet");
  });
});
