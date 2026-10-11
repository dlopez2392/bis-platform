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
// Same shape as page.test.ts's own mock: the page's own account-timezone
// read, threaded into the list/thread's `timezone` prop (D-010's pattern).
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { timezone: "America/Chicago" }, error: null }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/zone", () => ({
  renderZone: async (z: string | undefined) => (z
    ? { zone: z, guessed: false, label: z, source: "account" as const }
    : { zone: "UTC", guessed: true, label: "UTC", source: "fallback" as const }),
}));

/** F-085 part 1: the caller, for ?who= (defaults to the agency). */
type Access = { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null; canManage: boolean };
const AGENCY: Access = { userId: "u1", isAgency: true, role: null, canManage: true };
const accessMock = vi.fn(async (): Promise<Access> => AGENCY);
vi.mock("@/lib/auth", () => ({ requireAccountAccess: () => accessMock() }));

const listConversationsMock = vi.fn();
const getConversationSummaryMock = vi.fn();
const readPersonIdMock = vi.fn<(...a: unknown[]) => Promise<string | null>>(async () => "p-me");
vi.mock("@bis/db", () => ({
  listConversations: (...args: unknown[]) => listConversationsMock(...args),
  getConversationSummary: (...args: unknown[]) => getConversationSummaryMock(...args),
  listMessages: async () => [],
  readPersonId: (...args: unknown[]) => readPersonIdMock(...args),
}));

const { default: ConversationsPage } = await import("./page");
const { renderToStaticMarkup } = await import("react-dom/server");

function route(params: { c?: string; before?: string; who?: string }) {
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

async function markup(params: { c?: string; before?: string; who?: string }) {
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

  // DESIGN.md "Paged lists": "Selection survives a page change." Review
  // fix: opening a thread from page 2 used to lose the page entirely —
  // neither the row link that opened it nor the Back link it rendered
  // carried `before`, so Back silently returned to page one.
  it("carries the current page's `before` cursor on both the row links and the open thread's Back link (mutation: drop `before` from either → FAILS)", async () => {
    const cursor = encodeCursor({ v: "2026-10-01T00:00:00Z", id: "00000000-0000-0000-0000-000000000000" });
    listConversationsMock.mockResolvedValueOnce([row(0), row(1)]);
    const html = await markup({ before: cursor, c: "convo1" });
    // The OTHER row's link (convo0 — row 1 of the two), not the one
    // currently open: every row needs this, not only the active one.
    expect(html).toContain(`href="/dashboard/accounts/acct1/conversations?before=${cursor}&amp;c=convo0"`);
    // The Back link: returning from the thread must land back on THIS
    // page, not page one.
    expect(html).toContain(`href="/dashboard/accounts/acct1/conversations?before=${cursor}"`);
  });

  it("carries no `before` on row links or the Back link when on page one", async () => {
    listConversationsMock.mockResolvedValueOnce([row(0), row(1)]);
    const html = await markup({ c: "convo1" });
    expect(html).toContain('href="/dashboard/accounts/acct1/conversations?c=convo0"');
    expect(html).toContain('href="/dashboard/accounts/acct1/conversations"');
    expect(html).not.toContain("before=");
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

// F-085 part 1 (spec §8-§9): Mine / Unassigned on the inbox, filtered on the
// server, and kept on every link the list renders.
describe("ConversationsPage's ?who=", () => {
  const STAFF: Access = { userId: "u1", isAgency: false, role: "staff", canManage: false };
  const TECH: Access = { userId: "u1", isAgency: false, role: "technician", canManage: false };
  beforeEach(() => {
    listConversationsMock.mockReset();
    getConversationSummaryMock.mockReset();
    readPersonIdMock.mockClear();
    accessMock.mockReset().mockResolvedValue(STAFF);
  });

  it("who=mine asks listConversations for the caller's own customers' threads (mutation: drop the assignee -> FAILS)", async () => {
    listConversationsMock.mockResolvedValueOnce([row(0)]);
    await markup({ who: "mine" });
    expect(listConversationsMock.mock.calls[0]![2]).toMatchObject({ assignee: { who: "mine", userId: "p-me" } });
  });

  it("who=unassigned asks for Unassigned customers' threads", async () => {
    listConversationsMock.mockResolvedValueOnce([row(0)]);
    await markup({ who: "unassigned" });
    expect(listConversationsMock.mock.calls[0]![2]).toMatchObject({ assignee: { who: "unassigned" } });
  });

  it("a Technician: no filter is passed (RLS already makes the inbox theirs), and no users read", async () => {
    accessMock.mockResolvedValue(TECH);
    listConversationsMock.mockResolvedValueOnce([row(0)]);
    await markup({ who: "unassigned" });
    expect((listConversationsMock.mock.calls[0]![2] as { assignee?: unknown }).assignee).toBeUndefined();
    expect(readPersonIdMock).not.toHaveBeenCalled();
  });

  it("the Older link keeps who=mine (mutation: build Older without withWho -> FAILS)", async () => {
    const full = Array.from({ length: 50 }, (_, i) => row(i));
    listConversationsMock.mockResolvedValueOnce(full);
    const html = await markup({ who: "mine" });
    const cursor = encodeCursor({ v: full[49]!.lastMessageAt, id: full[49]!.id });
    expect(html).toContain(`href="/dashboard/accounts/acct1/conversations?before=${cursor}&amp;who=mine"`);
  });

  it("the Newer link, the row links and the Back link keep who=mine too", async () => {
    const cursor = encodeCursor({ v: "2026-10-01T00:00:00Z", id: "00000000-0000-0000-0000-000000000000" });
    listConversationsMock.mockResolvedValueOnce([row(0), row(1)]);
    const html = await markup({ before: cursor, who: "mine", c: "convo1" });
    expect(html).toContain(`href="/dashboard/accounts/acct1/conversations?before=${cursor}&amp;who=mine&amp;c=convo0"`);
    expect(html).toContain(`href="/dashboard/accounts/acct1/conversations?before=${cursor}&amp;who=mine"`);
    expect(html).toContain('href="/dashboard/accounts/acct1/conversations?who=mine"');
  });

  it("All carries no who anywhere", async () => {
    const full = Array.from({ length: 50 }, (_, i) => row(i));
    listConversationsMock.mockResolvedValueOnce(full);
    const html = await markup({ c: "convo1" });
    expect(html).not.toContain("who=");
  });
});
