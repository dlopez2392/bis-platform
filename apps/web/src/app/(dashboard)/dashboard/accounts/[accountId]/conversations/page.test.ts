import { describe, it, expect, vi } from "vitest";

/**
 * D-021. Below `lg` the grid's two columns stack into one scroll
 * (page.tsx's own comment on the `grid lg:grid-cols-[...]` wrapper), so
 * rendering BOTH the full list and the open thread there put a selected
 * thread below the whole list with no way back. Mocks the same shape
 * `calls/page.test.ts` already uses for this page's server-component
 * dependencies, rather than exercising Clerk/Supabase for a pure
 * "which branch renders" question.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

// The page's own direct query — the account's timezone, threaded into
// ConversationList/MessageThread's own `timezone` prop (D-010's pattern
// applied here) — same shape as calls/page.test.ts's own mock.
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

const conversationsFixture = [
  {
    id: "convo1", contactId: "contact1", contactFirstName: "Ada", contactLastName: "Lovelace",
    lastMessageAt: "2026-10-08T10:00:00Z", lastMessagePreview: "hi", unreadCount: 0,
  },
];
vi.mock("@bis/db", () => ({
  listConversations: async () => conversationsFixture,
  listMessages: async () => [],
}));

const { default: ConversationsPage } = await import("./page");

function route(c?: string) {
  return {
    params: Promise.resolve({ accountId: "acct1" }),
    searchParams: Promise.resolve({ c }),
  };
}

describe("ConversationsPage's mobile layout (D-021)", () => {
  it("hides the list (lg:block only) and shows a Back link once a thread is open (mutation: drop the `hidden` class → FAILS)", async () => {
    const html = (await ConversationsPage(route("convo1"))) as React.ReactElement;
    const { renderToStaticMarkup } = await import("react-dom/server");
    const markup = renderToStaticMarkup(html);
    // The list's wrapper is hidden below `lg`, visible again at `lg` — the
    // one-pane-at-a-time rule.
    expect(markup).toMatch(/class="hidden lg:block"/);
    // The Back link is present and itself `lg:hidden` — only shown where it
    // is needed, below `lg`.
    expect(markup).toContain('href="/dashboard/accounts/acct1/conversations"');
    expect(markup).toMatch(/lg:hidden/);
  });

  it("shows the list (no `hidden`) and no Back link when nothing is selected", async () => {
    const html = (await ConversationsPage(route(undefined))) as React.ReactElement;
    const { renderToStaticMarkup } = await import("react-dom/server");
    const markup = renderToStaticMarkup(html);
    expect(markup).not.toMatch(/class="hidden lg:block"/);
    expect(markup).not.toContain('href="/dashboard/accounts/acct1/conversations"');
  });
});
