import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

/**
 * S-06 part 2 (spec §1, G4): the inbox names who on the team forwarded a filed email. The page
 * collects the forwarders' Clerk ids from the thread's own inbound-email meta and names them with
 * ONE `listPeopleNames` read on the REQUEST client, so RLS decides who the reader may name; an id it
 * does not answer for (someone who left, a person the reader's role cannot see) reads "someone on
 * the team" — and so does a failed read, which never costs the thread (own module: its own
 * `listMessages`/`listPeopleNames` fixtures would collide with the sibling files').
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
const prefs = vi.hoisted(() => ({ language: null as "en" | "es" | null }));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: prefs.language, theme: null }) }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "u1", isAgency: false, role: "owner", canManage: true }),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("./inbound-actions", () => ({ undoReplyStopAction: vi.fn(), stopEmailsFromReplyAction: vi.fn() }));

/** The request client, by identity: the names read must take THIS one, never a service client. */
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
vi.mock("@/lib/consent/ledger-db", () => ({ ledgerDb: () => ({}) }));
vi.mock("@/lib/consent/email-view", () => ({ readEmailView: vi.fn() }));

const conversationsFixture = [
  { id: "convo1", contactId: "ana", contactFirstName: "Ana", contactLastName: "Gomez", lastMessageAt: "2026-10-09T16:12:00Z", lastMessagePreview: "hi", unreadCount: 0, contactLanguage: null },
];
const at = "2026-10-09T16:12:00Z";
const inbound = (id: string, channel: string, meta: Record<string, unknown>) => ({
  id, conversation_id: "convo1", channel, direction: "inbound", status: "delivered", provider_message_id: null,
  subject: null, body: `body ${id}`, error: null, created_at: at, meta,
});
const forward = (id: string, by: string | null) => inbound(id, "email", {
  inbound_email_id: `re_${id}`, attachment_count: 0, consent: { kind: "none" }, forwarded: true, forwarded_by: by,
});
const listMessages = vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []);
const listPeopleNames = vi.fn(async (..._a: unknown[]): Promise<Record<string, string>> => ({}));

vi.mock("@bis/db", () => ({
  listConversations: async () => conversationsFixture,
  readPersonId: async () => null,
  listMessages: (...a: unknown[]) => listMessages(...a),
  listPeopleNames: (...a: unknown[]) => listPeopleNames(...a),
  getContact: async () => null,
  // The "Needs a look" count and the Replies setting the header reads: a quiet inbox.
  countHeldInboundEmails: async () => 0,
  getInboundSettings: async () => ({ mode: "bis", domain: null }),
}));

const { default: ConversationsPage } = await import("./page");
const html = async () => renderToStaticMarkup((await ConversationsPage({
  params: Promise.resolve({ accountId: "acct1" }), searchParams: Promise.resolve({ c: "convo1" }),
})) as React.ReactElement);
const lines = (h: string) => [...h.matchAll(/<p[^>]*data-forwarded=""[^>]*>([^<]*)<\/p>/g)].map((x) => renderedText(x[1]!).trim());

describe("ConversationsPage names the team's forwarders (S-06 part 2)", () => {
  afterEach(() => {
    listMessages.mockReset().mockResolvedValue([]);
    listPeopleNames.mockReset().mockResolvedValue({});
    prefs.language = null;
  });

  it("one read, on the REQUEST client, for the distinct forwarders only; the named one reads by name (mutation: read on another client or per message -> FAILS)", async () => {
    listMessages.mockResolvedValue([
      forward("m1", "user_maria"), forward("m2", "user_maria"), forward("m3", null),
      inbound("m4", "email", { inbound_email_id: "re_m4", attachment_count: 0, consent: { kind: "none" } }),
      // An SMS never names anyone, whatever its meta says.
      inbound("m5", "sms", { forwarded: true, forwarded_by: "user_sms" }),
    ]);
    listPeopleNames.mockResolvedValue({ user_maria: "Maria Lopez" });
    const h = await html();
    expect(listPeopleNames).toHaveBeenCalledTimes(1);
    expect(listPeopleNames.mock.calls[0]![0]).toBe(REQUEST);
    expect(listPeopleNames.mock.calls[0]![1]).toEqual(["user_maria"]);
    expect(lines(h)).toEqual(["Forwarded by Maria Lopez · team", "Forwarded by Maria Lopez · team", "Forwarded by someone on the team"]);
  });

  it("an id the reader may not name (RLS answers nothing for it) reads someone on the team, in Spanish too (mutation: print the id -> FAILS)", async () => {
    listMessages.mockResolvedValue([forward("m1", "user_gone")]);
    prefs.language = "es";
    const h = await html();
    expect(lines(h)).toEqual(["Reenviado por alguien del equipo"]);
    expect(h).not.toContain("user_gone");
  });

  it("no forward in the thread: no names read at all (mutation: always read -> FAILS)", async () => {
    listMessages.mockResolvedValue([inbound("m1", "email", { inbound_email_id: "re_1", attachment_count: 0, consent: { kind: "none" } })]);
    const h = await html();
    expect(listPeopleNames).not.toHaveBeenCalled();
    expect(h).not.toContain("data-forwarded");
  });

  it("a failed names read costs only the names: the thread renders, logged by account (mutation: let it throw -> the page rejects, FAILS)", async () => {
    listMessages.mockResolvedValue([forward("m1", "user_maria")]);
    listPeopleNames.mockRejectedValue(new Error("users read failed"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const h = await html();
      expect(lines(h)).toEqual(["Forwarded by someone on the team"]);
      expect(renderedText(h)).toContain("body m1");
      expect(errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n")).toContain("conversations: account acct1 forwarder names read failed");
    } finally { errors.mockRestore(); }
  });
});
