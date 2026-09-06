import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CallListRow } from "@bis/db";

// `CallRow` calls `useRouter()` at render time for the whole-row click
// target; outside a mounted Next app router that hook throws. Needed here as
// soon as this file renders a table with rows in it — the cases above render
// zero. Same stand-in, same reason, as calls-table.test.ts's.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));

// Same shape as `conversations/actions.test.ts`: mock the auth gate and the
// DB entry points this async server component actually reaches, rather than
// exercising Clerk/Supabase for what is a pure "which branch renders" bug.
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: true }),
}));

// The page's own direct query — the account's timezone — projected the same
// way `conversations/actions.test.ts` projects its account row, so a column
// this page stops selecting would show up here too.
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

const listCallsMock = vi.fn();
// The failed-text-back read. Spied rather than stubbed away: what this page
// must never do is call it once per row, and the only way to see that from
// here is to count the calls and look at what was passed.
const listFailedOutboundSmsMock = vi.fn();
vi.mock("@bis/db", () => ({
  listCalls: (...args: unknown[]) => listCallsMock(...args),
  countCallsSince: async () => 3,
  listFailedOutboundSms: (...args: unknown[]) => listFailedOutboundSmsMock(...args),
}));

const { default: CallsPage } = await import("./page");

function route(before?: string) {
  return {
    params: Promise.resolve({ accountId: "acct1" }),
    searchParams: Promise.resolve({ before }),
  };
}

const ROW: CallListRow = {
  id: "c1",
  started_at: "2026-08-25T19:15:00.123456+00:00",
  ended_at: "2026-08-25T19:15:48.000000+00:00",
  duration_secs: null,
  outcome: "abandoned",
  language: "en",
  caller_e164: "+19565061545",
  contact_id: "ct1",
  conversation_id: "cv1",
  contact: null,
};

/** What the page hands `listFailedOutboundSms` for one row — asserted rather
 *  than recomputed from the source, so a change to the window silently
 *  widening it back out to "the whole conversation" fails here. */
const WINDOW_FOR_ROW = {
  callId: "c1",
  conversationId: "cv1",
  fromIso: "2026-08-25T19:15:00.123Z",
  // ended_at + the 5-minute grace.
  toIso: "2026-08-25T19:20:48.000Z",
};

describe("CallsPage", () => {
  beforeEach(() => {
    listFailedOutboundSmsMock.mockReset();
    listFailedOutboundSmsMock.mockResolvedValue([]);
  });

  it("renders the cold-start EmptyState for a genuinely empty, uncursored account", async () => {
    listCallsMock.mockResolvedValue([]);
    const html = renderToStaticMarkup(await CallsPage(route(undefined)));

    expect(html).toContain("No calls yet");
    // `CallsTable`'s own header — its absence is what proves EmptyState, not
    // an empty table, is what rendered.
    expect(html).not.toContain("Outcome");
  });

  /**
   * The bug this pins: `?before=` present, `listCalls` comes back with zero
   * rows — a client fifty-deep into their own call history who has simply
   * paged past the oldest row, not a client who has never had a call. Before
   * the fix, `rows.length === 0` alone picked the cold-start `EmptyState`
   * here too — a lie for this account, and a dead end (`EmptyState` renders
   * no link back). The fix: `CallsTable` always renders once a cursor is
   * present, zero rows or not — headers-only, same as `CallsTable`'s own
   * "nothing to page" case, and still reachable/navigable.
   */
  it("renders the table, not the cold-start EmptyState, when a cursor runs off the end of real history", async () => {
    listCallsMock.mockResolvedValue([]);
    const html = renderToStaticMarkup(
      await CallsPage(route("2026-01-01T00:00:00.000000+00:00")),
    );

    expect(html).toContain("Outcome");
    expect(html).not.toContain("No calls yet");
  });

  it("still reads as cold-start when `?before=` is unparseable — `cursorFrom` drops it, so it is not a real cursor", async () => {
    listCallsMock.mockResolvedValue([]);
    const html = renderToStaticMarkup(await CallsPage(route("not-a-timestamp")));

    expect(html).toContain("No calls yet");
  });

  /**
   * THE performance contract, pinned rather than trusted: 50 rows must cost
   * ONE failed-text-back read, with every conversation id on the page handed
   * over at once. A per-row read would satisfy every other assertion in this
   * file — it would render exactly the same HTML — so counting the calls is
   * the only thing that can tell the two apart.
   */
  it("asks for the whole page's failed text-backs in ONE read, not one per row", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      ...ROW, id: `c${i}`, conversation_id: `cv${i}`,
    }));
    listCallsMock.mockResolvedValue(rows);
    listFailedOutboundSmsMock.mockResolvedValue([
      { callId: "c7", conversationId: "cv7", messageId: "msg7", body: "Sorry we missed you.", failedAt: "2026-08-25T19:16:00+00:00", supersededAt: null },
    ]);

    const html = renderToStaticMarkup(await CallsPage(route(undefined)));

    expect(listFailedOutboundSmsMock).toHaveBeenCalledTimes(1);
    const [, accountId, windows] = listFailedOutboundSmsMock.mock.calls[0]!;
    expect(accountId).toBe("acct1");
    expect(windows).toHaveLength(50);
    // One window PER CALL, each bounded by that call's own timestamps — not a
    // bare list of conversation ids.
    expect(windows).toContainEqual({ ...WINDOW_FOR_ROW, callId: "c7", conversationId: "cv7" });

    // …and the one failure that came back is badged, exactly once, on the row
    // it belongs to rather than on all fifty.
    expect(html.match(/Text-back didn&#x27;t send/g)).toHaveLength(1);
  });

  it("only asks about ABANDONED calls — a repeat caller's booked row shares the conversation and must not inherit its failure", async () => {
    // Conversations are one-per-CONTACT. This caller abandoned once and booked
    // once, so both rows carry `cv1`. Only the abandoned one is a text-back
    // candidate; badging the booked row would put a sentence on it that is not
    // true of that call.
    listCallsMock.mockResolvedValue([
      { ...ROW, id: "c-abandoned", outcome: "abandoned", conversation_id: "cv1" },
      { ...ROW, id: "c-booked", outcome: "booked", conversation_id: "cv1" },
    ]);
    listFailedOutboundSmsMock.mockResolvedValue([
      { callId: "c-abandoned", conversationId: "cv1", messageId: "msg1", body: "Sorry we missed you.", failedAt: "2026-08-25T19:16:00+00:00", supersededAt: null },
    ]);

    const html = renderToStaticMarkup(await CallsPage(route(undefined)));

    // ONE window, for the abandoned call. The booked row contributes nothing —
    // not its call id and not the conversation id it shares.
    expect(listFailedOutboundSmsMock.mock.calls[0]![2])
      .toEqual([{ ...WINDOW_FOR_ROW, callId: "c-abandoned" }]);
    // …and the badge lands once, not on both rows sharing that conversation.
    expect(html.match(/Text-back didn&#x27;t send/g)).toHaveLength(1);
  });

  it("hands over an EMPTY window list for a page of calls that opened no conversation", async () => {
    // Every call in the log from before the text-back shipped, and every call
    // in an account that has it switched off. Those rows must produce no window
    // at all — `listFailedOutboundSms` short-circuits on an empty list (proven
    // in packages/db's own test), so this costs no round trip.
    listCallsMock.mockResolvedValue([
      { ...ROW, id: "c1", conversation_id: null },
      { ...ROW, id: "c2", conversation_id: null },
    ]);

    const html = renderToStaticMarkup(await CallsPage(route(undefined)));

    expect(listFailedOutboundSmsMock).toHaveBeenCalledTimes(1);
    expect(listFailedOutboundSmsMock.mock.calls[0]![2]).toEqual([]);
    expect(html).not.toContain("Text-back");
  });

  it("asks for no window at all for a call that never finished — nothing bounds it", async () => {
    // `ended_at` null: the row write failed, or the call is still live. Either
    // way there is no end to hang a window off, and an unbounded window would be
    // the conversation-wide claim this page stopped making.
    listCallsMock.mockResolvedValue([{ ...ROW, ended_at: null }]);

    renderToStaticMarkup(await CallsPage(route(undefined)));

    expect(listFailedOutboundSmsMock.mock.calls[0]![2]).toEqual([]);
  });

  /**
   * FINDING 3. The badge is advisory; the log of calls is the page. Letting a
   * `messages` error out of this read took the whole Calls page down with it —
   * a blank screen for a client whose calls are all fine, because one
   * decoration could not be computed.
   */
  it("still renders the whole page when the failed-text-back read blows up", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    listCallsMock.mockResolvedValue([ROW]);
    listFailedOutboundSmsMock.mockRejectedValue(new Error("permission denied for table messages"));

    const html = renderToStaticMarkup(await CallsPage(route(undefined)));

    // The calls themselves are all still there.
    expect(html).toContain("Outcome");
    expect(html).toContain("+19565061545");
    // Only the badge is missing…
    expect(html).not.toContain("Text-back");
    // …and the swallow left a trace, the way finish-call.ts's four legs do.
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("failed-text-back read failed"));
    spy.mockRestore();
  });
});
