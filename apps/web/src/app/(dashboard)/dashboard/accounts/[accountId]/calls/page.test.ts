import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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
vi.mock("@bis/db", () => ({
  listCalls: (...args: unknown[]) => listCallsMock(...args),
  countCallsSince: async () => 3,
}));

const { default: CallsPage } = await import("./page");

function route(before?: string) {
  return {
    params: Promise.resolve({ accountId: "acct1" }),
    searchParams: Promise.resolve({ before }),
  };
}

describe("CallsPage", () => {
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
});
