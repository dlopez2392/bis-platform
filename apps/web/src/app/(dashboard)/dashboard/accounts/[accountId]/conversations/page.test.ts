import { describe, it, expect, vi, beforeEach } from "vitest";
import { Suspense, isValidElement, type ReactElement } from "react";

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
// F-085 part 1: the page reads the caller (for ?who=). The agency, so no filter applies here.
// The send actions read the signed-in person's language (person-prefs pulls in @/lib/auth
// and the tenant theme); this page test only renders, so their prefs are empty.
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: null, theme: null }) }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "u1", isAgency: true, role: null, canManage: true }),
}));

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

// Task 12: the "Needs a look" filter and its own list. Mutable so individual
// tests can flip the read into a throw without a second `vi.mock` body.
const held = vi.hoisted(() => ({
  count: 0 as number | null,
  countThrows: false,
  listThrows: false,
  mode: "off" as "off" | "bis",
  items: [] as {
    id: string; accountId: string; conversationId: string; providerEmailId: string;
    fromEmail: string; fromName: string | null; toEmail: string; subject: string | null; text: string;
    auth: unknown; attachmentCount: number; status: "held"; holdReason: "not_on_record" | "unverified";
    messageId: string | null; decidedBy: string | null; decidedAt: string | null; receivedAt: string;
    contactId: string; contactFirstName: string | null; contactLastName: string | null;
  }[],
}));
// F-118 part 1 (Task 9): a ?c= not on the current page falls back to this read;
// defaults to resolving nothing so the existing fixtures (which never need it) are unaffected.
const getConversationSummaryMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock("@bis/db", () => ({
  listConversations: async () => conversationsFixture,
  getConversationSummary: (...a: unknown[]) => getConversationSummaryMock(...a),
  readPersonId: async () => null,
  listMessages: async () => [],
  // S-06 part 2: the forwarders' names (reached only for a thread holding a forward; none here).
  listPeopleNames: async () => ({}),
  countHeldInboundEmails: async () => { if (held.countThrows) throw new Error("count failed"); return held.count; },
  getInboundSettings: async () => ({ mode: held.mode, domain: null }),
  listHeldInboundEmails: async () => { if (held.listThrows) throw new Error("list failed"); return held.items; },
  // S-06 part 3: the composer's customer read answers null (the customer could not be read: the composer
  // opens with nothing ready); no thread here holds a chat, so the persona is never read.
  getContact: async () => null,
  getVoiceProfile: async () => null,
}));
// F-118 part 1 (Task 9): the one logger a record surface calls — controllable here so this file's
// own describe block can assert what it was called with, and make it reject.
const noteOpenedMock = vi.fn(async (..._a: unknown[]): Promise<void> => {});
vi.mock("@/lib/access-log/note", () => ({ noteOpened: (...a: unknown[]) => noteOpenedMock(...a) }));

const { default: ConversationsPage } = await import("./page");

function route(c?: string) {
  return {
    params: Promise.resolve({ accountId: "acct1" }),
    searchParams: Promise.resolve({ c }),
  };
}

function heldRoute(view?: string) {
  return {
    params: Promise.resolve({ accountId: "acct1" }),
    searchParams: Promise.resolve({ view }),
  };
}

function all(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(all);
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  // Walks every prop value, not only `children` — `filters` on `PageHeader`
  // carries this page's own held-filter link as a PROP, not as a child.
  return [el, ...Object.values(el.props).flatMap((v) => all(v))];
}

const HELD_ITEM = {
  id: "ie_1", accountId: "acct1", conversationId: "conv_1", providerEmailId: "prov_1",
  fromEmail: "luis@example.com", fromName: "Luis", toEmail: "reply@bis.com", subject: "Re: Your appointment",
  text: "Is Thursday ok?", auth: {}, attachmentCount: 0, status: "held" as const, holdReason: "not_on_record" as const,
  messageId: null, decidedBy: null, decidedAt: null, receivedAt: "2026-10-16T15:00:00.000Z",
  contactId: "ana", contactFirstName: "Ana", contactLastName: "Ruiz",
};

beforeEach(() => {
  held.count = 0;
  held.countThrows = false;
  held.listThrows = false;
  held.mode = "off";
  held.items = [];
  getConversationSummaryMock.mockReset().mockResolvedValue(null);
  noteOpenedMock.mockReset().mockResolvedValue(undefined);
});

describe("ConversationsPage — Task 12: the 'Needs a look' filter and its list", () => {
  it("?view=held renders HeldEmailList with the mapped items, and the header's filter link reads 'Needs a look · 2' (mutation: drop the count from the label -> FAILS)", async () => {
    held.count = 2;
    held.items = [HELD_ITEM, { ...HELD_ITEM, id: "ie_2" }];
    const { renderedText } = await import("@/lib/rendered-text");
    const html = (await ConversationsPage(heldRoute("held"))) as React.ReactElement;
    const els = all(html);
    const link = els.find((e) => (e.props as Record<string, unknown>)["data-held-filter"] !== undefined);
    expect(link).toBeTruthy();
    expect(link!.props.children).toBe("Needs a look · 2");
    // Coordinator round 1, item 4: the pill carries lang for its own render locale.
    expect(link!.props.lang).toBe("en");

    const boundary = els.find((e) => e.type === Suspense)!;
    const child = boundary.props.children as ReactElement<Record<string, unknown>>;
    const resolved = await (child.type as (p: Record<string, unknown>) => Promise<ReactElement>)(child.props);
    const { renderToStaticMarkup } = await import("react-dom/server");
    const childHtml = renderToStaticMarkup(resolved);
    expect(renderedText(childHtml)).toContain("Luis");
    expect(renderedText(childHtml)).toContain("Ana Ruiz");
  });

  // S-10 T9a: the held row's suggested customer name (HeldEmailPane's own `contactDisplayName`
  // call) was built with no locale — a nameless suggestion always read "(no name)".
  it("a nameless held row's suggested name reads Spanish, not always English (mutation: call contactDisplayName with no locale → FAILS)", async () => {
    held.count = 1;
    held.items = [{ ...HELD_ITEM, contactFirstName: null, contactLastName: null }];
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    try {
      const { m } = await import("@/lib/messages");
      const { renderedText } = await import("@/lib/rendered-text");
      const html = (await ConversationsPage({
        params: Promise.resolve({ accountId: "acct1" }),
        searchParams: Promise.resolve({ view: "held", locale: "es" }),
      })) as React.ReactElement;
      const els = all(html);
      const boundary = els.find((e) => e.type === Suspense)!;
      const child = boundary.props.children as ReactElement<Record<string, unknown>>;
      const resolved = await (child.type as (p: Record<string, unknown>) => Promise<ReactElement>)(child.props);
      const { renderToStaticMarkup } = await import("react-dom/server");
      const childHtml = renderToStaticMarkup(resolved);
      expect(renderedText(childHtml)).toContain(m["contact.noName.es"]);
      expect(renderedText(childHtml)).not.toContain(m["contact.noName"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("countHeldInboundEmails throwing still renders the inbox, with the link reading 'Needs a look' and no number (mutation: let the throw escape -> FAILS)", async () => {
    held.countThrows = true;
    held.mode = "bis"; // inbound replies are ON, so the filter still has a reason to show even with no known count.
    const html = (await ConversationsPage(route(undefined))) as React.ReactElement;
    const { renderToStaticMarkup } = await import("react-dom/server");
    const markup = renderToStaticMarkup(html);
    const { renderedText } = await import("@/lib/rendered-text");
    expect(renderedText(markup)).toContain("Needs a look");
    expect(renderedText(markup)).not.toContain("Needs a look · ");
  });

  it("listHeldInboundEmails throwing under ?view=held renders the loadFailed line (rule 5; mutation: let the throw escape -> FAILS)", async () => {
    held.count = 2;
    held.listThrows = true;
    const { m } = await import("@/lib/messages");
    const { renderedText } = await import("@/lib/rendered-text");
    const html = (await ConversationsPage(heldRoute("held"))) as React.ReactElement;
    const els = all(html);
    const boundary = els.find((e) => e.type === Suspense)!;
    const child = boundary.props.children as ReactElement<Record<string, unknown>>;
    const resolved = await (child.type as (p: Record<string, unknown>) => Promise<ReactElement>)(child.props);
    const { renderToStaticMarkup } = await import("react-dom/server");
    const childHtml = renderToStaticMarkup(resolved);
    expect(renderedText(childHtml)).toContain(m["conversations.held.loadFailed"]);
    // Coordinator round 1, item 4: the loadFailed line carries lang too.
    expect(childHtml).toMatch(/lang="en"/);
  });
});

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
    // The list's own links only: the All · Mine · Unassigned row (F-085)
    // links to this base on purpose, and is pinned in page.pagination.test.ts.
    expect(markup.replace(/<nav[^>]*aria-label="Show"[^>]*>[\s\S]*?<\/nav>/, "")).not.toContain('href="/dashboard/accounts/acct1/conversations"');
  });
});

// F-085 follow-up (Task B): the title, the pickThread empty state and
// (on a zero-row account) the "no conversations yet" empty state all read
// the reader's own language, with `lang` on the wrapper — the QA override
// is the same mechanism tasks/page.test.ts's own Spanish test already proves.
describe("ConversationsPage in Spanish (requestLocale; F-085 follow-up, Task B)", () => {
  async function renderEs(searchParams: Record<string, string> = {}) {
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    try {
      const { renderToStaticMarkup } = await import("react-dom/server");
      const html = (await ConversationsPage({
        params: Promise.resolve({ accountId: "acct1" }),
        searchParams: Promise.resolve({ locale: "es", ...searchParams }),
      })) as React.ReactElement;
      return renderToStaticMarkup(html);
    } finally {
      vi.unstubAllEnvs();
    }
  }

  it("the title and the pickThread pane read Spanish, with lang set (mutation: wrap the page in no LocaleProvider, or leave conversation-list.tsx reading a bare m[...] -> FAILS)", async () => {
    const { m } = await import("@/lib/messages");
    const markup = await renderEs();
    expect(markup).toMatch(/<div lang="es"/);
    expect(markup).toContain(`>${m["nav.conversations.es"]}<`);
    expect(markup).toContain(m["conversations.pickThread.es"]);
  });
});

// F-118 part 1 (spec §4.1; plan Task 9): opening a thread in the inbox is a record open. The guard
// here already returns an agency access (`isAgency: true`).
// S-10 T9a: the active thread's own header name (MessageThread's `contactName` prop) was built
// with `contactDisplayName({...})`, no locale — a nameless contact always read "(no name)", even
// for a Spanish-reading operator.
describe("ConversationsPage's contactName follows the reader's own locale (S-10 T9a)", () => {
  it("a nameless active contact's header name reads Spanish, not always English (mutation: call contactDisplayName with no locale → FAILS)", async () => {
    const fixture = conversationsFixture[0] as { contactFirstName: string | null; contactLastName: string | null };
    const original = { contactFirstName: fixture.contactFirstName, contactLastName: fixture.contactLastName };
    fixture.contactFirstName = null;
    fixture.contactLastName = null;
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    try {
      const { m } = await import("@/lib/messages");
      const html = (await ConversationsPage({
        params: Promise.resolve({ accountId: "acct1" }),
        searchParams: Promise.resolve({ c: "convo1", locale: "es" }),
      })) as React.ReactElement;
      const els = all(html);
      const thread = els.find((e) => Object.hasOwn(e.props, "contactName"));
      expect(thread?.props.contactName).toBe(m["contact.noName.es"]);
      expect(thread?.props.contactName).not.toBe(m["contact.noName"]);
    } finally {
      fixture.contactFirstName = original.contactFirstName;
      fixture.contactLastName = original.contactLastName;
      vi.unstubAllEnvs();
    }
  });
});

describe("ConversationsPage logs BIS's open of a resolved thread (F-118 part 1)", () => {
  it("1. a ?c= found on the current page is logged with the thread's own id, after it resolves (mutation: log c before it resolves -> FAILS)", async () => {
    await ConversationsPage(route("convo1"));
    expect(noteOpenedMock).toHaveBeenCalledTimes(1);
    expect(noteOpenedMock).toHaveBeenCalledWith(
      { userId: "u1", isAgency: true, role: null, canManage: true },
      "acct1",
      { kind: "conversation", recordId: "convo1" },
    );
  });

  it("2. a ?c= found only by getConversationSummary (not on the current page) is logged too", async () => {
    getConversationSummaryMock.mockResolvedValueOnce({
      id: "off-page", contactId: "contactX", contactFirstName: "Off", contactLastName: "Page",
      lastMessageAt: "2026-09-01T00:00:00Z", lastMessagePreview: "old thread", unreadCount: 0,
    });
    await ConversationsPage(route("off-page"));
    expect(noteOpenedMock).toHaveBeenCalledWith(expect.anything(), "acct1", { kind: "conversation", recordId: "off-page" });
  });

  it("3. a ?c= that resolves to nothing (not on the page, and getConversationSummary finds none) makes no call (mutation: log c before it resolves -> FAILS)", async () => {
    getConversationSummaryMock.mockResolvedValueOnce(null);
    await ConversationsPage(route("missing"));
    expect(noteOpenedMock).not.toHaveBeenCalled();
  });

  it("4. a request with no ?c= at all makes no call", async () => {
    await ConversationsPage(route(undefined));
    expect(noteOpenedMock).not.toHaveBeenCalled();
    expect(getConversationSummaryMock).not.toHaveBeenCalled();
  });

  it("5. a rejecting log rejects the page (owner ruling 4: fail closed)", async () => {
    noteOpenedMock.mockRejectedValueOnce(new Error("log failed"));
    await expect(ConversationsPage(route("convo1"))).rejects.toThrow("log failed");
  });

  it("6. ?view=held makes no call: no thread is resolved on that branch", async () => {
    await ConversationsPage(heldRoute("held"));
    expect(noteOpenedMock).not.toHaveBeenCalled();
  });
});
