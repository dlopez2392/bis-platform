import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

/**
 * Review of #225: replacing BOTH `timezone={zone.zone}` props on this page
 * (`ConversationList`'s and `MessageThread`'s) with a literal `"UTC"` still
 * passed all 69 of this directory's existing tests — none of them actually
 * asserted a clock STRING reached either component, only structural things
 * (hrefs, hidden classes, pager presence). This file closes that gap: a
 * real account zone (Chicago), a runtime stubbed to disagree with it (UTC),
 * and an assertion that the account's own clock time reaches BOTH panes.
 *
 * Own module (not `page.test.ts`): that file's `@/lib/zone` mock already
 * echoes the account's raw zone, which is fine for ITS assertions, but this
 * file needs its OWN account-timezone fixture and its OWN `listMessages`
 * fixture (a message with a real `created_at`), so it is its own `vi.mock`
 * call rather than a second, conflicting one layered onto that file's.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const accountRead = vi.fn(async (): Promise<{ data: unknown; error: unknown }> =>
  ({ data: { timezone: "America/Chicago" }, error: null }));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from: (table: string) => {
      if (table !== "accounts") throw new Error(`unexpected read of ${table}`);
      return { select: () => ({ eq: () => ({ maybeSingle: () => accountRead() }) }) };
    },
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
    // 15:30 UTC is 10:30 AM in Chicago (CDT, UTC-5) — distinct AM/PM from
    // a bare UTC render (3:30 PM), so a dropped zone cannot pass by luck.
    lastMessageAt: "2026-10-08T15:30:00.000Z", lastMessagePreview: "hi", unreadCount: 0,
  },
];
vi.mock("@bis/db", () => ({
  listConversations: async () => conversationsFixture,
  listMessages: async () => [{
    id: "m1", conversation_id: "convo1", channel: "sms", direction: "inbound",
    status: "received", provider_message_id: null, subject: null, body: "hi",
    error: null, created_at: "2026-10-08T15:30:00.000Z",
  }],
}));

const { default: ConversationsPage } = await import("./page");

function route(c?: string) {
  return { params: Promise.resolve({ accountId: "acct1" }), searchParams: Promise.resolve({ c }) };
}

describe("ConversationsPage threads the account's own zone into both panes (review of #225)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    accountRead.mockReset();
    accountRead.mockResolvedValue({ data: { timezone: "America/Chicago" }, error: null });
  });

  it("the list row AND the open thread's bubble both show the account's clock time (Chicago), not the runtime's (UTC) (mutation: hardcode `timezone=\"UTC\"` on either prop → FAILS)", async () => {
    vi.stubEnv("TZ", "UTC");
    const html = renderToStaticMarkup((await ConversationsPage(route("convo1"))) as React.ReactElement);
    const text = renderedText(html);
    expect(text).toContain("10:30 AM");
    expect(text).not.toContain("3:30 PM");
  });

  it("renders the page (no throw) and logs when the account's own timezone read fails", async () => {
    accountRead.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup((await ConversationsPage(route("convo1"))) as React.ReactElement);
    expect(renderedText(html)).toContain("Ada Lovelace");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("boom"));
    logSpy.mockRestore();
  });
});
