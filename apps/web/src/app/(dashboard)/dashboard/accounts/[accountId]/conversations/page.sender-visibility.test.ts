import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import type { EmailView } from "@/lib/consent/email-view";

/**
 * Fix round 2 (UI review): visibility now has ONE path — `getContact` on
 * the request client (0068's own RLS scope), the same call `page.tsx`
 * already needs to read a contact's email before checking its consent
 * history. The separate "contacts" visibility-only read fix round 1 added
 * is gone (nothing else used it — see `page.tsx`'s own comment).
 *
 * Round 1's version of this file made `getContact` ALWAYS answer the
 * contact regardless of what the (then-separate) visibility read decided —
 * a state production can't actually reach, because in production
 * `getContact` runs on the SAME request client the real visibility check
 * would have used. This version makes `getContact` itself the lever: a
 * hidden household member's `getContact` answers `null`, exactly as 0068's
 * RLS does for a Technician's non-customer — and the real, stricter
 * consequence is asserted: with no contact, there is no `EmailView` to
 * read AT ALL, so a STOPPED reply's whole notice disappears (never merely
 * a withheld button — decided stricter than the original ruling, accepted),
 * while a "maybe" chip still shows its own dot-and-word, only its button
 * withheld (own module: needs its own `listMessages`/`getContact`/
 * `readEmailView` fixtures, which would collide with simpler sibling files).
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: null, theme: null }) }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "u1", isAgency: true, role: null, canManage: true }),
}));
// The notice is a "use client" component with its own server action imports; same mocks
// message-thread.test.ts and inbound-notice.test.ts already need for the same reason.
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("./inbound-actions", () => ({ undoReplyStopAction: vi.fn(), stopEmailsFromReplyAction: vi.fn() }));

const accountRead = vi.fn(async () => ({ data: { timezone: "America/Chicago", language: null }, error: null }));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from: (table: string) => {
      if (table === "accounts") return { select: () => ({ eq: () => ({ maybeSingle: () => accountRead() }) }) };
      throw new Error(`unexpected read of ${table}: the consolidated visibility path reads contacts only through getContact`);
    },
  }),
}));
vi.mock("@/lib/zone", () => ({
  renderZone: async (z: string | undefined) => (z
    ? { zone: z, guessed: false, label: z, source: "account" as const }
    : { zone: "UTC", guessed: true, label: "UTC", source: "fallback" as const }),
}));
vi.mock("@/lib/consent/ledger-db", () => ({ ledgerDb: () => ({}) }));

const CURRENT_REPLY_VIEW: EmailView = { kind: "stopped", eventId: "ev_1", since: "2026-10-09T16:12:00Z", how: { kind: "reply", expired: false }, canResume: false };
const readEmailView = vi.fn(async (): Promise<EmailView> => CURRENT_REPLY_VIEW);
vi.mock("@/lib/consent/email-view", () => ({ readEmailView }));

// The ONE lever: which contact ids `getContact` can see. Starts empty (nothing hidden) —
// matches 0068's RLS answering null for a Technician's own non-customer, never throwing.
const hiddenIds = new Set<string>();
const getContactCalls: { accountId: string; id: string }[] = [];
const getContact = vi.fn(async (_db: unknown, accountId: string, id: string) => {
  getContactCalls.push({ accountId, id });
  if (hiddenIds.has(id)) return null;
  return { id, email: `${id}@example.com` };
});

type Msg = {
  id: string; conversation_id: string; channel: string; direction: string; status: string;
  provider_message_id: null; subject: null; body: string; error: null; created_at: string;
  meta: { inbound_email_id: string; attachment_count: number; sender: { contact_id: string; first_name: string; last_name: string }; consent: { kind: string; eventId?: string } };
};

const conversationsFixture = [
  { id: "convo1", contactId: "ana", contactFirstName: "Ana", contactLastName: "Gomez", lastMessageAt: "2026-10-09T16:12:00Z", lastMessagePreview: "hi", unreadCount: 0 },
];
const stoppedMessage: Msg = {
  id: "m1", conversation_id: "convo1", channel: "email", direction: "inbound",
  status: "delivered", provider_message_id: null, subject: null, body: "hi", error: null,
  created_at: "2026-10-09T16:12:00Z",
  meta: { inbound_email_id: "re_1", attachment_count: 0, sender: { contact_id: "luis", first_name: "Luis", last_name: "Ruiz" }, consent: { kind: "stopped", eventId: "ev_1" } },
};
const maybeMessage: Msg = {
  ...stoppedMessage, id: "m2",
  meta: { ...stoppedMessage.meta, consent: { kind: "maybe" } },
};
const listMessages = vi.fn(async (): Promise<Msg[]> => [stoppedMessage]);

vi.mock("@bis/db", () => ({
  listConversations: async () => conversationsFixture,
  readPersonId: async () => null,
  listMessages,
  getContact,
  // S-06 part 2: the forwarders' names (reached only for a thread holding a forward; none here).
  listPeopleNames: async () => ({}),
}));

const { default: ConversationsPage } = await import("./page");

function route(c?: string) {
  return { params: Promise.resolve({ accountId: "acct1" }), searchParams: Promise.resolve({ c }) };
}

describe("ConversationsPage's visibility, now a SINGLE path through getContact (fix round 2)", () => {
  afterEach(() => {
    hiddenIds.clear();
    getContactCalls.length = 0;
    readEmailView.mockReset();
    readEmailView.mockResolvedValue(CURRENT_REPLY_VIEW);
    listMessages.mockReset();
    listMessages.mockResolvedValue([stoppedMessage]);
  });

  it("calls getContact scoped to THIS account, for the exact household-member id the thread named (mutation: drop the accountId argument → FAILS)", async () => {
    await ConversationsPage(route("convo1"));
    // "ana": the composer's readiness read of the thread's own customer (S-06 part 3, spec §6), after the consent block.
    expect(getContactCalls).toEqual([{ accountId: "acct1", id: "luis" }, { accountId: "acct1", id: "ana" }]);
  });

  it("the sender IS visible: the stop notice and its Undo button both render", async () => {
    const html = renderToStaticMarkup((await ConversationsPage(route("convo1"))) as React.ReactElement);
    expect(html).toContain("data-reply-stopped");
    expect(renderedText(html)).toContain("Undo");
  });

  it("the sender is NOT visible (getContact answers null, 0068's own RLS): the whole stop notice is GONE, not merely its button (mutation: show the status text anyway → FAILS)", async () => {
    hiddenIds.add("luis");
    const html = renderToStaticMarkup((await ConversationsPage(route("convo1"))) as React.ReactElement);
    expect(html).not.toContain("data-reply-stopped");
    expect(renderedText(html)).not.toContain("Undo");
  });

  it("readEmailView is NEVER called for an id getContact answered null for — the request-client proof gates the ledger read (mutation: call readEmailView before checking getContact's answer → FAILS)", async () => {
    hiddenIds.add("luis");
    await ConversationsPage(route("convo1"));
    expect(readEmailView).not.toHaveBeenCalled();
  });

  it("the \"maybe\" chip: hidden sender still shows the chip's dot-and-word, but no Stop-emails button (mutation: hide the chip entirely too → FAILS)", async () => {
    listMessages.mockResolvedValue([maybeMessage]);
    hiddenIds.add("luis");
    const html = renderToStaticMarkup((await ConversationsPage(route("convo1"))) as React.ReactElement);
    expect(html).toContain("data-reply-maybe");
    expect(renderedText(html)).toContain("May want to stop");
    expect(renderedText(html)).not.toContain("Stop emails");
  });

  it("the \"maybe\" chip: VISIBLE sender gets the Stop-emails button when the address still reads allowed", async () => {
    listMessages.mockResolvedValue([maybeMessage]);
    readEmailView.mockResolvedValue({ kind: "allowed", newestId: "ev_0" });
    const html = renderToStaticMarkup((await ConversationsPage(route("convo1"))) as React.ReactElement);
    expect(renderedText(html)).toContain("Stop emails");
  });
});
