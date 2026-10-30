import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

/**
 * S-06 part 3 (spec §5, §6): a lead's website chat on the inbox thread, and the Text | Email composer
 * that opens on the channel the SERVER chose. The harness is page.forwarders.test.ts's (own module:
 * its own `listMessages`/`getVoiceProfile` fixtures would collide with the sibling files'). The
 * request client keeps throwing on any table but `accounts`; `softSmsGate` is mocked, so nothing here
 * reads `phone_numbers`. The mocked `getContact` answers the thread's own customer, what RLS answers
 * an Owner.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: null, theme: null }) }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "u1", isAgency: false, role: "owner", canManage: true }),
}));
// F-118 part 1 (Task 9): the one logger a record surface calls. A client (isAgency false here)
// is never logged, but the module still imports Clerk's `auth()`, so every page*.test.ts needs this.
vi.mock("@/lib/access-log/note", () => ({ noteOpened: async () => {} }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("./inbound-actions", () => ({ undoReplyStopAction: vi.fn(), stopEmailsFromReplyAction: vi.fn() }));
vi.mock("./actions", () => ({ sendEmailAction: vi.fn(), sendSmsAction: vi.fn(), markConversationReadAction: vi.fn() }));

/** The request client, by identity: the persona read must take THIS one, never a service client. */
const REQUEST = vi.hoisted(() => ({
  from: (table: string) => {
    if (table === "accounts") {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { timezone: "UTC", language: null }, error: null }) }) }) };
    }
    throw new Error(`unexpected read of ${table}`);
  },
}));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));
vi.mock("@/lib/zone", () => ({
  renderZone: async () => ({ zone: "UTC", guessed: false, label: "UTC", source: "account" as const }),
}));
/** The ledger client, by identity: the two recipient states must take THIS one, never the request client. */
const LEDGER = vi.hoisted(() => ({ ledger: true }));
vi.mock("@/lib/consent/ledger-db", () => ({ ledgerDb: () => LEDGER }));
vi.mock("@/lib/consent/email-view", () => ({ readEmailView: vi.fn() }));

const gate = vi.hoisted(() => ({ value: { ok: true, from: "+19565550000", ownedNumbers: ["+19565550000"] } as unknown }));
const sms = vi.hoisted(() => ({ value: { kind: "ok" } as unknown }));
vi.mock("@/lib/record/loaders", () => ({ softSmsGate: async () => gate.value }));
/** Each recipient-state read's client, in call order. */
const stateClients = vi.hoisted(() => ({ sms: [] as unknown[], email: [] as unknown[] }));
vi.mock("@/lib/consent/recipient-state", () => ({
  smsRecipientState: async (db: unknown) => { stateClients.sms.push(db); return sms.value; },
  emailRecipientState: async (db: unknown) => { stateClients.email.push(db); return { kind: "ok" }; },
}));

const conversationsFixture = [
  { id: "convo1", contactId: "ana", contactFirstName: "Ana", contactLastName: "Gomez", lastMessageAt: "2026-10-17T15:00:00Z", lastMessagePreview: "hi", unreadCount: 0, contactLanguage: null },
];
const listMessages = vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []);
const getVoiceProfile = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ persona_name: "Rosa" }));
/** The thread's own customer, what RLS answers an Owner on the request client. */
const getContact = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ id: "ana", phone: "(956) 555-0100", email: "ana@example.com", phone_country_unconfirmed: false }));

vi.mock("@bis/db", () => ({
  listConversations: async () => conversationsFixture,
  readPersonId: async () => null,
  listMessages: (...a: unknown[]) => listMessages(...a),
  // S-06 part 2: the forwarders' names (reached only for a thread holding a forward; none here).
  listPeopleNames: async () => ({}),
  getVoiceProfile: (...a: unknown[]) => getVoiceProfile(...a),
  getContact: (...a: unknown[]) => getContact(...a),
  // The "Needs a look" count and the Replies setting the header reads: a quiet inbox.
  countHeldInboundEmails: async () => 0,
  getInboundSettings: async () => ({ mode: "bis", domain: null }),
}));

const { default: ConversationsPage } = await import("./page");
const html = async () => renderToStaticMarkup((await ConversationsPage({
  params: Promise.resolve({ accountId: "acct1" }), searchParams: Promise.resolve({ c: "convo1" }),
})) as React.ReactElement);

const row = (id: string, channel: string, direction: string, author_kind: string, meta: Record<string, unknown> = {}) => ({
  id, conversation_id: "convo1", channel, direction, status: "delivered", provider_message_id: null, subject: null,
  body: `body ${id}`, error: null, created_at: "2026-10-17T15:00:00Z", author_kind, author_id: null, meta,
});
const chatRow = (id: string, index: number, direction: string) => row(id, "webchat", direction, direction === "inbound" ? "customer" : "ai",
  { webchat: { chat_id: "11111111-1111-4111-8111-111111111111", index, locale: "en", submission_id: "s1", matched_existing: false } });
const pressed = (h: string) => [...h.matchAll(/<button[^>]*aria-pressed="true"[^>]*>([^<]*)<\/button>/g)].map((x) => x[1]);

describe("ConversationsPage with a web chat thread (S-06 part 3, spec §5, §6)", () => {
  afterEach(() => {
    listMessages.mockReset().mockResolvedValue([]); getVoiceProfile.mockClear(); getContact.mockClear(); sms.value = { kind: "ok" };
    stateClients.sms.length = 0; stateClients.email.length = 0;
  });

  it("the composer proves the customer with getContact on the REQUEST client, then reads both recipient states on the LEDGER client (mutation: getContact on ledgerDb() → FAILS; a recipient state on db → FAILS)", async () => {
    listMessages.mockResolvedValue([row("t1", "sms", "inbound", "customer")]);
    await html();
    expect(getContact.mock.calls).toHaveLength(1);
    expect(getContact.mock.calls[0]![0]).toBe(REQUEST);
    expect(getContact.mock.calls[0]!.slice(1)).toEqual(["acct1", "ana"]);
    expect(stateClients.sms).toEqual([LEDGER]);
    expect(stateClients.email).toEqual([LEDGER]);
    expect(stateClients.sms[0]).not.toBe(REQUEST);
    expect(stateClients.email[0]).not.toBe(REQUEST);
  });

  it("a thread holding a chat reads the persona ONCE, on the request client, and Sofía's bubble names her; a thread with none never reads it (mutation: read always → called for the text thread, FAILS)", async () => {
    listMessages.mockResolvedValue([chatRow("a0", 0, "inbound"), chatRow("a1", 1, "outbound")]);
    expect(renderedText(await html())).toContain("Web chat · Rosa · AI");
    expect(getVoiceProfile).toHaveBeenCalledTimes(1);
    expect(getVoiceProfile.mock.calls[0]![0]).toBe(REQUEST);
    expect(getVoiceProfile.mock.calls[0]![1]).toBe("acct1");
    getVoiceProfile.mockClear();
    listMessages.mockResolvedValue([row("t1", "sms", "inbound", "customer")]);
    await html();
    expect(getVoiceProfile).not.toHaveBeenCalled();
  });

  it("a failed persona read costs only the name, logged by account (mutation: let it throw → the page rejects, FAILS)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      getVoiceProfile.mockRejectedValueOnce(new Error("down"));
      listMessages.mockResolvedValue([chatRow("a1", 1, "outbound")]);
      expect(renderedText(await html())).toContain("Web chat · Sofía · AI");
      expect(errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n")).toContain("conversations: account acct1 persona read failed");
    } finally { errors.mockRestore(); }
  });

  it("the composer is Text | Email and opens on the server's channel: after their text, Text; after their email, Email; after a chat, Text while cleared (mutation: no initialMode → Text always, FAILS on the email case)", async () => {
    listMessages.mockResolvedValue([row("t1", "sms", "inbound", "customer")]);
    expect(pressed(await html())).toEqual(["Text"]);
    listMessages.mockResolvedValue([row("e1", "email", "inbound", "customer")]);
    expect(pressed(await html())).toEqual(["Email"]);
    listMessages.mockResolvedValue([row("e1", "email", "inbound", "customer"), chatRow("a0", 0, "inbound")]);
    expect(pressed(await html())).toEqual(["Text"]);
  });

  it("their texts stopped: it never opens on Text, even after their last text (G10; mutation: ignore readiness → Text, FAILS)", async () => {
    sms.value = { kind: "stopped", since: "2026-10-01T00:00:00Z" };
    listMessages.mockResolvedValue([row("t1", "sms", "inbound", "customer")]);
    expect(pressed(await html())).toEqual(["Email"]);
  });

  it("import sites: the page imports only the COMPONENT from the 'use client' composer, the facts from the plain module, and keys the composer by the thread (mutation: import smsFormBlock into page.tsx → FAILS; drop key={active.id} → the next thread inherits this one's tab, FAILS)", () => {
    const src = readFileSync(path.join(__dirname, "page.tsx"), "utf8");
    expect(src).toContain('import { MessageComposer } from "../contacts/[contactId]/message-composer";');
    expect(src).toContain('import { loadInboxComposer } from "./composer-facts";');
    expect(src).toMatch(/<MessageComposer\s+key=\{active\.id\}/);
    expect(src).not.toMatch(/EmailComposer|email-composer/);
  });

  it("the inbox never opens its composer by a #compose-* deep link: nothing the page renders, nor its source or the thread's, names one (Task 6 review; mutation: link to #compose-email from the thread → FAILS)", async () => {
    listMessages.mockResolvedValue([row("e1", "email", "inbound", "customer"), chatRow("a0", 0, "inbound")]);
    expect(await html()).not.toContain("#compose-");
    for (const f of ["page.tsx", "message-thread.tsx"]) {
      expect(readFileSync(path.join(__dirname, f), "utf8"), f).not.toContain("#compose-");
    }
  });
});
