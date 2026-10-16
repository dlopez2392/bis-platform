import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

/**
 * Fix round 1 (UI review, minor #8): the sender-visibility read (a
 * household member's `meta.sender.contact_id` must come back under the
 * REQUEST client, scoped to this account, or the Undo/Stop-emails button is
 * withheld — orchestrator ruling, Task 11). Own module (not `page.test.ts`
 * or `page.zone.test.ts`): needs its own `contacts` table mock and its own
 * `listMessages`/`getContact`/`readEmailView` fixtures, which would collide
 * with those files' simpler shapes.
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
// Captures the EXACT scope the contacts read was made with (account_id, the ids asked for), and
// answers either a success or the injected error — the one lever this file's tests pull.
const contactsCalls: { accountId: string; ids: string[] }[] = [];
const contactsRead = vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: [{ id: "luis" }], error: null }));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from: (table: string) => {
      if (table === "accounts") return { select: () => ({ eq: () => ({ maybeSingle: () => accountRead() }) }) };
      if (table === "contacts") {
        return {
          select: () => ({
            eq: (col: string, accountId: string) => {
              if (col !== "account_id") throw new Error(`expected account_id scope, got ${col}`);
              return {
                in: (idCol: string, ids: string[]) => {
                  if (idCol !== "id") throw new Error(`expected an id filter, got ${idCol}`);
                  contactsCalls.push({ accountId, ids });
                  return contactsRead();
                },
              };
            },
          }),
        };
      }
      throw new Error(`unexpected read of ${table}`);
    },
  }),
}));
vi.mock("@/lib/zone", () => ({
  renderZone: async (z: string | undefined) => (z
    ? { zone: z, guessed: false, label: z, source: "account" as const }
    : { zone: "UTC", guessed: true, label: "UTC", source: "fallback" as const }),
}));
// Isolates this file's assertions to the VISIBILITY gate alone: every contact's email view
// always answers a CURRENT, non-expired reply stop, so the stop's own TEXT renders regardless —
// only the button's presence should move with `contactsRead`'s own answer.
vi.mock("@/lib/consent/ledger-db", () => ({ ledgerDb: () => ({}) }));
vi.mock("@/lib/consent/email-view", () => ({
  readEmailView: async () => ({
    kind: "stopped", eventId: "ev_1", since: "2026-10-09T16:12:00Z", how: { kind: "reply", expired: false }, canResume: false,
  }),
}));

const conversationsFixture = [
  { id: "convo1", contactId: "ana", contactFirstName: "Ana", contactLastName: "Gomez", lastMessageAt: "2026-10-09T16:12:00Z", lastMessagePreview: "hi", unreadCount: 0 },
];
const messagesFixture = [{
  id: "m1", conversation_id: "convo1", channel: "email", direction: "inbound",
  status: "delivered", provider_message_id: null, subject: null, body: "hi", error: null,
  created_at: "2026-10-09T16:12:00Z",
  meta: { inbound_email_id: "re_1", attachment_count: 0, sender: { contact_id: "luis", first_name: "Luis", last_name: "Ruiz" }, consent: { kind: "stopped", eventId: "ev_1" } },
}];
vi.mock("@bis/db", () => ({
  listConversations: async () => conversationsFixture,
  readPersonId: async () => null,
  listMessages: async () => messagesFixture,
  getContact: async (_db: unknown, _accountId: string, id: string) => ({ id, email: `${id}@example.com` }),
}));

const { default: ConversationsPage } = await import("./page");

function route(c?: string) {
  return { params: Promise.resolve({ accountId: "acct1" }), searchParams: Promise.resolve({ c }) };
}

describe("ConversationsPage's sender-visibility read (fix round 1, minor #8)", () => {
  afterEach(() => {
    contactsRead.mockReset();
    contactsRead.mockResolvedValue({ data: [{ id: "luis" }], error: null });
    contactsCalls.length = 0;
  });

  it("reads contacts scoped to THIS account, on the REQUEST client, asking for the exact sender id the thread named (mutation: drop the account_id .eq → FAILS)", async () => {
    await ConversationsPage(route("convo1"));
    expect(contactsCalls).toEqual([{ accountId: "acct1", ids: ["luis"] }]);
  });

  it("the sender comes back visible: the Undo button renders", async () => {
    const html = renderToStaticMarkup((await ConversationsPage(route("convo1"))) as React.ReactElement);
    expect(html).toContain("data-reply-stopped");
    expect(html).toContain("<button");
  });

  it("the sender-visibility read ERRORS: the status still shows, but the Undo button is WITHHELD — fail closed, never open (mutation: ignore the error and show the button anyway → FAILS)", async () => {
    contactsRead.mockResolvedValue({ data: null, error: { message: "boom" } });
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup((await ConversationsPage(route("convo1"))) as React.ReactElement);
    expect(html).toContain("data-reply-stopped");
    expect(renderedText(html)).not.toContain("Undo");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("boom"));
    logSpy.mockRestore();
  });

  it("the sender simply does not come back (RLS filtered it, a Technician's own scope): the Undo button is WITHHELD too", async () => {
    contactsRead.mockResolvedValue({ data: [], error: null });
    const html = renderToStaticMarkup((await ConversationsPage(route("convo1"))) as React.ReactElement);
    expect(html).toContain("data-reply-stopped");
    expect(renderedText(html)).not.toContain("Undo");
  });
});
