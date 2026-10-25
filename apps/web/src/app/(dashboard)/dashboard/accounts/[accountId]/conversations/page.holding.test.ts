import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";

/**
 * S-47e Task 12 (spec 5.12.4-5): a holding thread's own read — `listContactsOnNumber`, the people on the
 * number, the holding record excluded, a Technician gets no Move, and a failed read still renders the
 * thread (best-effort, rule 5). Copies `page.test.ts`'s own bare factory and mocks, adding only the one
 * new function this holding branch reaches (the affected-test rule, kind 4) — every OTHER `page*.test.ts`
 * file stays unedited because its own fixtures never set `holdsSharedNumber`.
 *
 * `./holding-move` (a Radix dropdown, closed by default) is mocked to a prop-recording stub — same idiom
 * as `relationships-card`/`places-card` in the record page's own test — because a CLOSED Radix menu's
 * content portals nothing into a static render, so asserting on the real markup would only prove the
 * trigger exists, never which `people` the page actually computed and handed down.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: null, theme: null }) }));
vi.mock("./holding-move", () => ({
  HoldingMove: (p: Record<string, unknown>) => createElement("div", { "data-holding-move": "", "data-holding-move-props": JSON.stringify(p) }),
}));

const authFixture = vi.hoisted(() => ({
  userId: "u1", isAgency: true, role: null as "owner" | "staff" | "technician" | null, canManage: true,
}));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => authFixture,
}));

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

const HOLDING_CONVO = {
  id: "convoH", contactId: "ctH", contactFirstName: "Caller", contactLastName: null,
  lastMessageAt: "2026-10-08T10:00:00Z", lastMessagePreview: "hi", unreadCount: 0,
  holdsSharedNumber: true, sharedNumber: "+19565550142",
};

const onNumber = vi.hoisted(() => ({
  rows: [] as { id: string; first_name: string | null; last_name: string | null; phone: string | null; email_key: string | null; holds_shared_number: boolean }[],
  truncated: false,
  throws: false,
}));
const listContactsOnNumberMock = vi.fn(async (..._a: unknown[]) => {
  if (onNumber.throws) throw new Error("read failed");
  return { rows: onNumber.rows, truncated: onNumber.truncated };
});

vi.mock("@bis/db", () => ({
  listConversations: async () => [HOLDING_CONVO],
  readPersonId: async () => null,
  listMessages: async () => [],
  listPeopleNames: async () => ({}),
  countHeldInboundEmails: async () => 0,
  getInboundSettings: async () => ({ mode: "off", domain: null }),
  listHeldInboundEmails: async () => [],
  getContact: async () => null,
  getVoiceProfile: async () => null,
  listContactsOnNumber: (...a: unknown[]) => listContactsOnNumberMock(...a),
}));

const { default: ConversationsPage } = await import("./page");
const { renderToStaticMarkup } = await import("react-dom/server");
const { renderedText } = await import("@/lib/rendered-text");

function route(c?: string) {
  return { params: Promise.resolve({ accountId: "acct1" }), searchParams: Promise.resolve({ c }) };
}

beforeEach(() => {
  authFixture.userId = "u1"; authFixture.isAgency = true; authFixture.role = null; authFixture.canManage = true;
  onNumber.rows = [];
  onNumber.truncated = false;
  onNumber.throws = false;
  listContactsOnNumberMock.mockClear();
});

describe("ConversationsPage reads the people on a holding thread's number (S-47e Task 12)", () => {
  it("passes the real contacts on the number (the holding record itself excluded) to the Move menu, for an Owner/agency (mutation: keep the holding record in `people` -> FAILS)", async () => {
    onNumber.rows = [
      { id: "ctH", first_name: "Caller", last_name: null, phone: "+19565550142", email_key: null, holds_shared_number: true },
      { id: "ct2", first_name: "Beto", last_name: "Prueba", phone: "+19565550142", email_key: null, holds_shared_number: false },
    ];
    const html = await ConversationsPage(route("convoH")).then(renderToStaticMarkup);
    expect(listContactsOnNumberMock).toHaveBeenCalledWith(expect.anything(), "acct1", "+19565550142");
    const props = JSON.parse(html.match(/data-holding-move-props="([^"]*)"/)![1]!.replace(/&quot;/g, '"'));
    expect(props.people).toEqual([{ id: "ct2", name: "Beto Prueba" }]);
  });

  it("a Technician gets no Move component at all, even with real contacts on the number (mutation: ignore the role -> FAILS)", async () => {
    authFixture.isAgency = false; authFixture.role = "technician";
    onNumber.rows = [
      { id: "ct2", first_name: "Beto", last_name: "Prueba", phone: "+19565550142", email_key: null, holds_shared_number: false },
    ];
    const html = await ConversationsPage(route("convoH")).then(renderToStaticMarkup);
    expect(html).not.toContain("data-holding-move-props");
    // The Notice itself still shows: a Technician can still read why this thread has no name.
    expect(renderedText(html)).toContain("These texts came from (956) 555-0142");
  });

  it("a failed read of the people on the number still renders the thread, with an EMPTY people list handed to the Move menu (best-effort, rule 5; mutation: let the throw escape -> the render rejects, FAILS)", async () => {
    onNumber.throws = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = await ConversationsPage(route("convoH")).then(renderToStaticMarkup);
      expect(renderedText(html)).toContain("These texts came from (956) 555-0142");
      const props = JSON.parse(html.match(/data-holding-move-props="([^"]*)"/)![1]!.replace(/&quot;/g, '"'));
      expect(props.people).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  it("the thread's own HEADER name is the holding label, never 'Caller' (mutation: use contactDisplayName always -> FAILS)", async () => {
    const html = await ConversationsPage(route("convoH")).then(renderToStaticMarkup);
    expect(html).toMatch(/<p data-thread-name="" class="[^"]*">Shared number \(956\) 555-0142<\/p>/);
    expect(html).not.toMatch(/<p data-thread-name="" class="[^"]*">Caller<\/p>/);
  });
});
