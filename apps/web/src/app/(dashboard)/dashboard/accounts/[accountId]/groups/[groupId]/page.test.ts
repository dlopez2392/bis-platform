import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The household and business record page (S-03 part 2, plan Task 7; spec §8). As the contact page
 * test: the reads this async server component reaches are mocked, and what is under test is the
 * order of the reads (C16: a 404 before any read; C14: the ledger client only after getContact),
 * what each card is handed, and that each card fails on its own (part 1 C5). The three client
 * cards (Properties, People, Details) are recorded, not run: each has its own tests.
 */

const accountRead = vi.fn(async (): Promise<{ data: unknown; error: unknown }> =>
  ({ data: { timezone: "America/Chicago", language: null }, error: null }));
/** One stable request client, so a read can be proven to run on it by identity. */
const REQUEST_DB = vi.hoisted(() => ({ tag: "request-db" } as Record<string, unknown>));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => {
    REQUEST_DB.from = (table: string) => {
      if (table !== "accounts") throw new Error(`unexpected read of ${table}`);
      let cols: string[] = [];
      const chain = {
        select: (c: string) => { cols = c.split(",").map((s) => s.trim()); return chain; },
        eq: () => chain,
        // As PostgREST does: only the columns the page SELECTED come back.
        maybeSingle: async () => {
          const r = await accountRead();
          const data = r.data && typeof r.data === "object"
            ? Object.fromEntries(Object.entries(r.data).filter(([k]) => cols.includes(k))) : r.data;
          return { ...r, data };
        },
      };
      return chain;
    };
    return REQUEST_DB;
  },
}));

type Access = { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null; canManage: boolean };
const requireAccountAccessMock = vi.fn<(accountId: string) => Promise<Access>>();
vi.mock("@/lib/auth", () => ({ requireAccountAccess: (accountId: string) => requireAccountAccessMock(accountId) }));

const G = "11111111-1111-4111-8111-111111111111";
const GROUP = { id: G, kind: "household" as const, name: "García", billingAddress: "1 Main St" };
const member = (over: Record<string, unknown>) => ({
  memberId: "m-x", contactId: "c-x", firstName: null, lastName: null, phone: null, email: null, role: null,
  isBilling: false, isPrimaryContact: false, joinedAt: "2026-01-01T00:00:00.000Z", ...over,
});
const ANA = member({ memberId: "m-ana", contactId: "22222222-2222-4222-8222-222222222222", firstName: "Ana", lastName: "García",
  phone: "+19565550100", email: "ana@example.com", isPrimaryContact: true });
const LUIS = member({ memberId: "m-luis", contactId: "33333333-3333-4333-8333-333333333333", firstName: "Luis", lastName: "García" });
/** groupActivityMembers' GroupPerson shape (S-03 part 2b). */
const person = (p: { contactId: string; firstName: string | null; lastName: string | null }) =>
  ({ contactId: p.contactId, firstName: p.firstName, lastName: p.lastName });
const ANA_P = person(ANA as never);
const LUIS_P = person(LUIS as never);
const NO_PLACES = { groups: [], places: [], placeCount: 0, equipment: [], equipmentCount: 0 };
const place = (over: Record<string, unknown>) => ({
  id: "p1", account_id: "acct1", contact_id: null, client_group_id: G, label: null, address: null, landmark: null, directions: null,
  city: null, region: null, postal_code: null, country: null, archived_at: null, created_by: null,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...over,
});

const readGroupMock = vi.fn();
const listGroupMembersMock = vi.fn();
const listGroupPeopleMock = vi.fn();
const listGroupPlacesMock = vi.fn();
const listOpenDealsForMock = vi.fn();
const listContactPlacesMock = vi.fn();
const getContactMock = vi.fn();
vi.mock("@bis/db", () => ({
  readGroup: (...a: unknown[]) => readGroupMock(...a),
  listGroupMembers: (...a: unknown[]) => listGroupMembersMock(...a),
  listGroupPeople: (...a: unknown[]) => listGroupPeopleMock(...a),
  listGroupPlaces: (...a: unknown[]) => listGroupPlacesMock(...a),
  listOpenDealsFor: (...a: unknown[]) => listOpenDealsForMock(...a),
  listContactPlaces: (...a: unknown[]) => listContactPlacesMock(...a),
  getContact: (...a: unknown[]) => getContactMock(...a),
  // The middle column's reads (S-03 part 2b, Task 17), through group-loaders.ts.
  groupActivityMembers: (...a: unknown[]) => groupActivityMembersMock(...a),
  groupFacts: (...a: unknown[]) => groupFactsMock(...a),
  groupNextUp: (...a: unknown[]) => groupNextUpMock(...a),
  listTimelinePage: (...a: unknown[]) => listTimelinePageMock(...a),
  listPeopleNames: (...a: unknown[]) => listPeopleNamesMock(...a),
  getVoiceProfile: (...a: unknown[]) => getVoiceProfileMock(...a),
  TIMELINE_SOURCES: ["notes", "todos", "deals", "forms", "messages", "bookings", "calls"],
}));
const groupActivityMembersMock = vi.fn();
const groupFactsMock = vi.fn();
const groupNextUpMock = vi.fn();
const listTimelinePageMock = vi.fn();
const listPeopleNamesMock = vi.fn();
const getVoiceProfileMock = vi.fn();
const prefsMock = vi.fn(async () => ({ language: null as "en" | "es" | null, theme: null }));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: () => prefsMock() }));
// A desk: the two "have" cards render open, so their bodies and markers can be read.
vi.mock("@/components/record/use-phone", () => ({ usePhone: () => false, PHONE_QUERY: "(max-width: 767px)" }));
const renderZone = vi.fn(async (z: string | undefined) => (z
  ? { zone: z, guessed: false, label: z, source: "account" as const }
  : { zone: "UTC", guessed: true, label: "UTC", source: "fallback" as const }));
vi.mock("@/lib/zone", () => ({ renderZone: (z: string | undefined) => renderZone(z) }));
const resolveSmsSenderMock = vi.fn();
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: (...a: unknown[]) => resolveSmsSenderMock(...a) }));
const smsRecipientStateMock = vi.fn();
vi.mock("@/lib/consent/recipient-state", () => ({ smsRecipientState: (...a: unknown[]) => smsRecipientStateMock(...a) }));
const LEDGER = vi.hoisted(() => ({ tag: "ledger-db" }));
const ledgerDbMock = vi.hoisted(() => vi.fn(() => LEDGER));
vi.mock("@/lib/consent/ledger-db", () => ({ ledgerDb: () => ledgerDbMock() }));

const placesCardProps: Record<string, unknown>[] = [];
vi.mock("../../contacts/places-card", () => ({ PlacesCard: (p: Record<string, unknown>) => { placesCardProps.push(p); return null; } }));
const peopleCardProps: Record<string, unknown>[] = [];
vi.mock("./people-card", () => ({ PeopleCard: (p: Record<string, unknown>) => { peopleCardProps.push(p); return null; } }));
const detailsCardProps: Record<string, unknown>[] = [];
vi.mock("./details-card", () => ({ DetailsCard: (p: Record<string, unknown>) => { detailsCardProps.push(p); return null; } }));

const NOT_FOUND = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: () => { throw NOT_FOUND; },
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));

const { default: GroupRecordPage } = await import("./page");
const { m } = await import("@/lib/messages");
const { GROUP_RECORD_CARDS, cardsInPhoneOrder } = await import("@/lib/record/record-cards");

async function render(over: { groupId?: string; people?: string; locale?: string; before?: string } = {}) {
  const search: Record<string, string> = {};
  if (over.people !== undefined) search.people = over.people;
  if (over.locale !== undefined) search.locale = over.locale;
  if (over.before !== undefined) search.before = over.before;
  const el = await GroupRecordPage({ params: Promise.resolve({ accountId: "acct1", groupId: over.groupId ?? G }), searchParams: Promise.resolve(search) });
  return renderToStaticMarkup(el);
}
const cardHtml = (html: string, id: string) => html.match(new RegExp(`<section[^>]*data-record-card="${id}"[\\s\\S]*?</section>`))?.[0] ?? "";
const actionIds = (html: string) => [...html.matchAll(/data-record-action="(\w+)"/g)].map((x) => x[1]);
const esc = (s: string) => s.replaceAll("'", "&#x27;");

let errors: MockInstance<typeof console.error>;
beforeEach(() => {
  for (const f of [readGroupMock, listGroupMembersMock, listGroupPeopleMock, listGroupPlacesMock, listOpenDealsForMock,
    listContactPlacesMock, getContactMock, resolveSmsSenderMock, smsRecipientStateMock, accountRead, prefsMock]) f.mockClear();
  ledgerDbMock.mockClear();
  requireAccountAccessMock.mockReset().mockResolvedValue({ userId: "u1", isAgency: true, role: null, canManage: true });
  readGroupMock.mockReset().mockResolvedValue(GROUP);
  listGroupMembersMock.mockReset().mockResolvedValue({ primary: ANA, members: [LUIS], next: null });
  listGroupPeopleMock.mockReset().mockResolvedValue([
    { contactId: ANA.contactId, firstName: "Ana", lastName: "García" }, { contactId: LUIS.contactId, firstName: "Luis", lastName: "García" }]);
  listGroupPlacesMock.mockReset().mockResolvedValue(NO_PLACES);
  listOpenDealsForMock.mockReset().mockResolvedValue({ deals: [], count: 0 });
  listContactPlacesMock.mockReset().mockResolvedValue(NO_PLACES);
  getContactMock.mockReset().mockResolvedValue({ id: ANA.contactId, phone: ANA.phone, email: ANA.email });
  resolveSmsSenderMock.mockReset().mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
  smsRecipientStateMock.mockReset().mockResolvedValue({ kind: "ok" });
  prefsMock.mockReset().mockResolvedValue({ language: null, theme: null });
  groupActivityMembersMock.mockReset().mockResolvedValue({ people: [ANA_P, LUIS_P], total: { ok: true, value: 2 }, more: false });
  groupFactsMock.mockReset().mockResolvedValue({ bookingsMade: { ok: true, value: 0 }, lastTalked: { ok: true, value: null } });
  groupNextUpMock.mockReset().mockResolvedValue({ bookings: [], datedTasks: [], undatedCount: 0 });
  listTimelinePageMock.mockReset().mockResolvedValue({ items: [], older: null, failed: [] });
  listPeopleNamesMock.mockReset().mockResolvedValue({});
  getVoiceProfileMock.mockReset().mockResolvedValue(null);
  placesCardProps.length = 0; peopleCardProps.length = 0; detailsCardProps.length = 0;
  errors?.mockRestore();
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

const EVERY_READ = () => [listGroupMembersMock, listGroupPeopleMock, listGroupPlacesMock, listOpenDealsForMock, listContactPlacesMock,
  getContactMock, resolveSmsSenderMock, prefsMock, ledgerDbMock, accountRead,
  groupActivityMembersMock, groupFactsMock, groupNextUpMock, listTimelinePageMock, listPeopleNamesMock, getVoiceProfileMock];

describe("the group record page: authorisation before any read (C16)", () => {
  it("a malformed id is a 404 before ANY read (C16; mutation: start the reads before the uuid check -> FAILS)", async () => {
    await expect(render({ groupId: "not-a-uuid" })).rejects.toBe(NOT_FOUND);
    for (const f of [readGroupMock, ...EVERY_READ()]) expect(f).not.toHaveBeenCalled();
  });

  it("a group readGroup cannot see is a 404 before any other read (mutation: Promise.all the reads with readGroup -> FAILS)", async () => {
    readGroupMock.mockResolvedValue(null);
    await expect(render()).rejects.toBe(NOT_FOUND);
    expect(readGroupMock).toHaveBeenCalledWith(REQUEST_DB, "acct1", G);
    for (const f of EVERY_READ()) expect(f).not.toHaveBeenCalled();
  });

  it("the caller's access to the account is checked before the group is read (mutation: read the group first -> FAILS)", async () => {
    await render();
    expect(requireAccountAccessMock).toHaveBeenCalledWith("acct1");
    expect(requireAccountAccessMock.mock.invocationCallOrder[0]).toBeLessThan(readGroupMock.mock.invocationCallOrder[0]!);
  });
});

describe("the group record page: the header (spec §8.1)", () => {
  it("the header: the group's name as the h1, the kind word under it, Call and Email to the call-first member by first name (mutation: label with the group's name -> FAILS)", async () => {
    const html = await render();
    expect(html).toMatch(/<h1[^>]*>García<\/h1>/);
    expect(html).toMatch(/data-record-subtitle[^>]*>Household</);
    expect(actionIds(html)).toEqual(["call", "email"]);
    expect(html).toContain('href="tel:+19565550100"');
    expect(html).toContain(`href="/dashboard/accounts/acct1/contacts/${ANA.contactId}#compose-email"`);
    expect(html).toContain(">Call Ana<");
    expect(html).toContain(">Email Ana<");
    expect(html).toContain('href="/dashboard/accounts/acct1/contacts"');
  });

  it("a business reads 'Business customer' under its name (C11; mutation: always the household word -> FAILS)", async () => {
    readGroupMock.mockResolvedValue({ ...GROUP, kind: "business", name: "Rio Roofing" });
    const html = await render();
    expect(html).toMatch(/data-record-subtitle[^>]*>Business customer</);
  });

  it("no visible call-first member: no Call, Text or Email; Directions still shows from the group's places (D4; mutation: fall back to the first member -> FAILS)", async () => {
    listGroupMembersMock.mockResolvedValue({ primary: null, members: [LUIS], next: null });
    listGroupPlacesMock.mockResolvedValue({ ...NO_PLACES, places: [place({ address: "1 Main St", city: "McAllen" })], placeCount: 1 });
    resolveSmsSenderMock.mockResolvedValue({ ok: true, from: "+1", ownedNumbers: [] });
    const html = await render();
    expect(actionIds(html)).toEqual(["directions"]);
    expect(html).toContain("https://www.google.com/maps/search/?api=1&amp;query=1%20Main%20St%2C%20McAllen");
    expect(getContactMock).not.toHaveBeenCalled();
    expect(listContactPlacesMock).not.toHaveBeenCalled();
  });

  it("no addressed group place: Directions falls back to the call-first member's OWN place, never another group's (D4; mutation: take the first of every place they can reach -> FAILS)", async () => {
    listContactPlacesMock.mockResolvedValue({ ...NO_PLACES, places: [
      place({ id: "p-other", client_group_id: "44444444-4444-4444-8444-444444444444", address: "9 Other Rd" }),
      place({ id: "p-own", client_group_id: null, contact_id: ANA.contactId, address: "5 Own Ave" }),
    ] });
    const html = await render();
    expect(listContactPlacesMock).toHaveBeenCalledWith(REQUEST_DB, "acct1", ANA.contactId);
    expect(actionIds(html)).toEqual(["call", "email", "directions"]);
    expect(html).toContain("query=5%20Own%20Ave");
    expect(html).not.toContain("9%20Other%20Rd");
  });

  it("an addressed group place wins, and the member's own places are never read (D4; mutation: always read the member's -> FAILS)", async () => {
    listGroupPlacesMock.mockResolvedValue({ ...NO_PLACES, places: [place({ address: "1 Main St" })], placeCount: 1 });
    const html = await render();
    expect(html).toContain("query=1%20Main%20St");
    expect(listContactPlacesMock).not.toHaveBeenCalled();
  });

  it("the ledger client is built only after getContact proved the call-first member (C14; mutation: build it first -> FAILS)", async () => {
    listGroupMembersMock.mockResolvedValue({ primary: ANA, members: [], next: null });
    resolveSmsSenderMock.mockResolvedValue({ ok: true, from: "+19565550199", ownedNumbers: ["+19565550199"] });
    const html = await render();
    expect(getContactMock).toHaveBeenCalledWith(REQUEST_DB, "acct1", ANA.contactId);
    expect(getContactMock.mock.invocationCallOrder[0]).toBeLessThan(ledgerDbMock.mock.invocationCallOrder[0]!);
    expect(actionIds(html)).toEqual(["call", "text", "email"]);
    expect(html).toContain(`href="/dashboard/accounts/acct1/contacts/${ANA.contactId}#compose-sms"`);
    expect(html).toContain(">Text Ana<");
  });

  it("a stopped number hides Text (C14: the composer it lands on would not open; mutation: canText from the gate alone -> FAILS)", async () => {
    resolveSmsSenderMock.mockResolvedValue({ ok: true, from: "+19565550199", ownedNumbers: ["+19565550199"] });
    smsRecipientStateMock.mockResolvedValue({ kind: "stopped", since: "2026-01-01T00:00:00Z" });
    expect(actionIds(await render())).toEqual(["call", "email"]);
  });

  it("names no hero, and the header's Call is its one primary (rules 11 and 8; mutation: mark a data-hero -> FAILS; mutation: every action primary -> FAILS)", async () => {
    resolveSmsSenderMock.mockResolvedValue({ ok: true, from: "+19565550199", ownedNumbers: ["+19565550199"] });
    const html = await render();
    expect(html).not.toContain("data-hero");
    const variants = [...html.matchAll(/<a [^>]*data-record-action="\w+"[^>]*>/g)]
      .map((x) => [x[0].match(/data-record-action="(\w+)"/)![1], x[0].match(/data-variant="(\w+)"/)?.[1]]);
    expect(variants).toEqual([["call", "default"], ["text", "ghost"], ["email", "ghost"]]);
  });
});

describe("the group record page: the cards (spec §8.2-8.5)", () => {
  it("the cards in phone order are the DOM order, the middle column first (C6, spec §7; mutation: render the registry in desk order -> FAILS)", async () => {
    const html = await render();
    const ids = [...html.matchAll(/data-record-card="([\w-]+)"/g)].map((x) => x[1]);
    expect(ids).toEqual(cardsInPhoneOrder(GROUP_RECORD_CARDS).map((d) => d.id));
    expect(ids).toEqual(["summary", "next-up", "timeline", "properties", "deals", "people", "details"]);
    expect([...html.matchAll(/data-record-column="(\w+)"/g)].map((x) => x[1])).toEqual(["happening", "have", "who"]);
  });

  it("each card fails on its own: People failing leaves Properties, Deals and Details (mutation: one Promise.all with no per-card loads -> the render rejects, FAILS)", async () => {
    listGroupMembersMock.mockRejectedValue(new Error("members down"));
    const html = await render();
    expect(cardHtml(html, "people")).toMatch(/data-state="error"/);
    expect(cardHtml(html, "people")).toContain(esc(m["record.card.failed"].replace("{title}", m["groupPage.card.people"])));
    expect(cardHtml(html, "deals")).not.toMatch(/data-state="error"/);
    expect(peopleCardProps).toEqual([]);
    expect(detailsCardProps.at(-1)).toMatchObject({ name: "García" });
    expect(placesCardProps.at(-1)).toMatchObject({ group: { id: G, kind: "household", name: "García" }, canMovePlace: false });
    // With no members read there is no call-first member: Call, Text and Email hide, the page stands.
    expect(actionIds(html)).toEqual([]);
  });

  it("Deals failing leaves People (mutation: let the deals read reject the page -> FAILS)", async () => {
    listOpenDealsForMock.mockRejectedValue(new Error("deals down"));
    const html = await render();
    expect(cardHtml(html, "deals")).toMatch(/data-state="error"/);
    expect(cardHtml(html, "deals")).toContain(esc(m["record.card.failed"].replace("{title}", m["record.card.deals"])));
    expect(cardHtml(html, "people")).toMatch(/data-state="ready"/);
    expect(peopleCardProps).toHaveLength(1);
  });

  it("a failed header-places read drops Directions, never the header or the Properties card, and never falls back to the member's own place (spec §6; mutation: rethrow -> FAILS; mutation: fall back on a failed read -> FAILS)", async () => {
    listGroupPlacesMock.mockRejectedValue(new Error("places down"));
    // The call-first member HAS an addressed place of their own: a failed group read cannot know the
    // group has no addressed place, so the fallback must not run.
    listContactPlacesMock.mockResolvedValue({ ...NO_PLACES, places: [place({ id: "p-own", client_group_id: null, contact_id: ANA.contactId, address: "5 Own Ave" })] });
    const html = await render();
    expect(actionIds(html)).toEqual(["call", "email"]);
    expect(html).not.toContain("5%20Own%20Ave");
    expect(listContactPlacesMock).not.toHaveBeenCalled();
    expect(placesCardProps).toHaveLength(1);
  });

  it("People is handed the call-first member, the rest, and its pager; a whole-account reader is a manager (mutation: pin the primary into rows -> FAILS)", async () => {
    listGroupMembersMock.mockResolvedValue({ primary: ANA, members: [LUIS], next: { v: "2026-01-01T00:00:00.000Z", id: LUIS.memberId } });
    await render();
    const p = peopleCardProps.at(-1)!;
    expect(p).toMatchObject({
      accountId: "acct1", groupId: G, kind: "household", manager: true, paged: false,
      primary: { memberId: "m-ana", contactId: ANA.contactId, name: "Ana García", role: null, isBilling: false, isPrimaryContact: true },
      rows: [{ memberId: "m-luis", contactId: LUIS.contactId, name: "Luis García", role: null, isBilling: false, isPrimaryContact: false }],
    });
    expect((p.pager as { moreHref: string | null }).moreHref).toMatch(new RegExp(`^/dashboard/accounts/acct1/groups/${G}\\?people=.+#group-people$`));
    expect((p.pager as { firstHref: string | null }).firstHref).toBeNull();
    expect(detailsCardProps.at(-1)).toEqual({ accountId: "acct1", groupId: G, name: "García", kind: "household", billingAddress: "1 Main St", manager: true });
  });

  it("a narrow reader gets no Make primary contact, no Remove and no prompt (C2, C3; mutation: pass manager from canManage -> FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValue({ userId: "u1", isAgency: false, role: "technician", canManage: true });
    await render();
    expect(peopleCardProps.at(-1)).toMatchObject({ manager: false });
    expect(detailsCardProps.at(-1)).toMatchObject({ manager: false });
  });

  it("an Owner is a manager (mutation: manager = isAgency -> FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValue({ userId: "u1", isAgency: false, role: "owner", canManage: true });
    await render();
    expect(peopleCardProps.at(-1)).toMatchObject({ manager: true });
  });

  it("Staff is a manager too (C2: Owner, Staff and the agency; mutation: manager = isAgency || role owner -> FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValue({ userId: "u1", isAgency: false, role: "staff", canManage: false });
    await render();
    expect(peopleCardProps.at(-1)).toMatchObject({ manager: true });
    expect(detailsCardProps.at(-1)).toMatchObject({ manager: true });
  });

  it("a nameless member reads the page's own '(no name)', never the English catalogue's on a Spanish page (memberName; mutation: build the name with the English (no name) -> FAILS)", async () => {
    prefsMock.mockResolvedValue({ language: "es", theme: null });
    listGroupMembersMock.mockResolvedValue({ primary: null, members: [member({ memberId: "m-n", contactId: "c-n" })], next: null });
    await render();
    expect((peopleCardProps.at(-1)!.rows as { name: string }[])[0]!.name).toBe(m["contact.noName.es"]);
  });

  it("Properties shows the GROUP's own places with the kind's empty text and no Move to (C12; mutation: the household's text for a business -> FAILS; mutation: canMovePlace from manager -> FAILS)", async () => {
    readGroupMock.mockResolvedValue({ ...GROUP, kind: "business", name: "Rio Roofing" });
    await render();
    expect(placesCardProps.at(-1)).toEqual({
      accountId: "acct1", group: { id: G, kind: "business", name: "Rio Roofing" }, canMovePlace: false, headingHidden: true,
      emptyText: m["groupPage.places.emptyBusiness"],
    });
  });

  it("Deals reads exactly the activity set, the same ≤50 people as the middle column, never the joined-order list (C13, plan deviation 5; mutation: keep 2a's listGroupPeople -> FAILS)", async () => {
    groupActivityMembersMock.mockResolvedValue({ people: [person({ contactId: "c2", firstName: "Luis", lastName: null }),
      person({ contactId: "c9", firstName: "Rosa", lastName: null })], total: { ok: true, value: 2 }, more: false });
    listGroupPeopleMock.mockResolvedValue([{ contactId: "c1", firstName: "Ana", lastName: null }, { contactId: "c2", firstName: "Luis", lastName: null }]);
    await render();
    // The set is read on the REQUEST client for this group (the loader's own options are its business).
    expect(groupActivityMembersMock.mock.calls[0]!.slice(0, 3)).toEqual([REQUEST_DB, "acct1", G]);
    expect(listOpenDealsForMock).toHaveBeenCalledWith(REQUEST_DB, "acct1", ["c2", "c9"]);
    expect(listGroupPeopleMock).not.toHaveBeenCalled();
  });

  it("with no activity set (its scan failed), Deals is its card's error, not a guess from another list, logged once under the scan's cause (C13, final review minor d; mutation: fall back to listGroupPeople -> FAILS; mutation: throw inside Deals' loader -> FAILS)", async () => {
    groupActivityMembersMock.mockRejectedValue(new Error("scan down"));
    const html = await render();
    expect(cardHtml(html, "deals")).toMatch(/data-state="error"/);
    expect(listOpenDealsForMock).not.toHaveBeenCalled();
    expect(cardHtml(html, "people")).toMatch(/data-state="ready"/);
    // Logged ONCE, under its real cause, never again as a made-up Deals failure (final review minor d;
    // mutation: throw "no activity set" inside Deals' loader -> a second, deals line, FAILS).
    const lines = errors.mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.includes("activity set read failed") && l.includes("scan down"))).toHaveLength(1);
    expect(lines.filter((l) => l.includes("deals read failed"))).toEqual([]);
  });

  it("each deal names its person from that set, and past 30 the more line says how many (C13, §8.5; mutation: drop who -> FAILS; mutation: never the more line -> FAILS)", async () => {
    const deal = (id: string, contact_id: string) => ({ id, name: `Deal ${id}`, status: "open", monetary_value: 100, created_at: "2026-01-01T00:00:00Z", contact_id });
    listOpenDealsForMock.mockResolvedValue({ deals: [deal("d1", LUIS.contactId), deal("d2", "c-gone")], count: 41 });
    const html = cardHtml(await render(), "deals");
    expect(html).toMatch(/Deal d1<\/p><p data-deal-who="true"[^>]*>Luis García<\/p>/);
    // A deal whose person is not in the set shows no name rather than a guessed one.
    expect(html).not.toMatch(/Deal d2<\/p><p data-deal-who/);
    expect(html).toContain(">Showing 2 of 41 open deals.<");
  });

  it("no open deals: the group's empty text, not the contact page's (mutation: drop emptyText -> FAILS)", async () => {
    const html = cardHtml(await render(), "deals");
    expect(html).toContain(esc(m["groupPage.deals.empty"]));
    expect(html).not.toContain("data-deals-more");
  });
});

describe("the group record page: language and paging", () => {
  it("Spanish: lang='es', the kind word 'Familia', the titles 'Personas' and 'Datos', 'Llamar a Ana' (D10; mutation: drop userLanguage -> English, FAILS)", async () => {
    prefsMock.mockResolvedValue({ language: "es", theme: null });
    const html = await render();
    expect(html).toMatch(/data-record-layout[^>]*lang="es"|lang="es"[^>]*data-record-layout/);
    expect(html).toMatch(/data-record-subtitle[^>]*>Familia</);
    expect(cardHtml(html, "people")).toContain(`>${m["groupPage.card.people.es"]}<`);
    expect(cardHtml(html, "details")).toContain(`>${m["groupPage.card.details.es"]}<`);
    expect(html).toContain(">Llamar a Ana<");
    expect(html).toContain(`>${m["record.back.es"]}<`);
  });

  it("a client-role reader with no language of their own reads the account's Spanish (mutation: drop language from the accounts select -> FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValue({ userId: "u1", isAgency: false, role: "owner", canManage: true });
    accountRead.mockResolvedValueOnce({ data: { timezone: "America/Chicago", language: "es" }, error: null });
    expect(await render()).toMatch(/data-record-layout[^>]*lang="es"|lang="es"[^>]*data-record-layout/);
  });

  it("a failed account read is logged and the page still renders in the fallback zone (mutation: throw on it -> FAILS)", async () => {
    accountRead.mockResolvedValueOnce({ data: null, error: { message: "accounts down" } });
    const html = await render();
    expect(html).toContain("data-record-layout");
    expect(renderZone).toHaveBeenLastCalledWith(undefined);
    expect(errors.mock.calls.map((c) => String(c[0]))).toContain("group page: account acct1 timezone and language read failed: accounts down");
  });

  it("a ?people= that does not parse is a cold start, and a good one reaches listGroupMembers as a paged view (mutation: never pass the cursor -> FAILS; mutation: pass an unparsed one -> FAILS)", async () => {
    await render({ people: "x" });
    expect(listGroupMembersMock).toHaveBeenLastCalledWith(REQUEST_DB, "acct1", G, { after: undefined });
    expect(peopleCardProps.at(-1)).toMatchObject({ paged: false });

    const { encodeCursor } = await import("@/lib/cursor");
    const cursor = { v: "2026-01-01T00:00:00.000Z", id: "55555555-5555-4555-8555-555555555555" };
    await render({ people: encodeCursor(cursor) });
    expect(listGroupMembersMock).toHaveBeenLastCalledWith(REQUEST_DB, "acct1", G, { after: cursor });
    const p = peopleCardProps.at(-1)!;
    expect(p).toMatchObject({ paged: true });
    expect((p.pager as { firstHref: string | null }).firstHref).toBe(`/dashboard/accounts/acct1/groups/${G}#group-people`);
  });
});

describe("the group record page: the middle column (S-03 part 2b, spec §8.6-8.8)", () => {
  const AT = "2026-10-09T16:12:00Z";
  const callOf = (contactId: string) => ({ kind: "call", id: "k1", at: AT, contactId, call: { id: "k1", contact_id: contactId, started_at: AT,
    outcome: "booked", duration_secs: 120, reason: "Wants a quote.", summary: null, language: "en" } });
  const noteOf = (contactId: string) => ({ kind: "note", id: "n1", at: AT, contactId, note: { id: "n1", body: "Gate code 4411", author_id: "u1", created_at: AT } });
  const many = (n: number) => Array.from({ length: n }, (_, i) => person({ contactId: `c${i}`, firstName: `P${i}`, lastName: null }));
  const happening = (html: string) => html.match(/<div[^>]*data-record-column="happening"[^>]*>([\s\S]*?)<\/div><div[^>]*data-record-column="have"/)?.[1] ?? "";

  it("the summary, Next up and the timeline read EXACTLY the activity set's ids, never People's page (C5, C13; mutation: pass People's ids -> FAILS)", async () => {
    // People's first page is Ana then Luis; the activity set is Luis then Rosa: the two differ.
    const ROSA = person({ contactId: "44444444-4444-4444-8444-444444444444", firstName: "Rosa", lastName: "Peña" });
    groupActivityMembersMock.mockResolvedValue({ people: [LUIS_P, ROSA], total: { ok: true, value: 2 }, more: false });
    await render();
    const ids = [LUIS.contactId, ROSA.contactId];
    expect(groupFactsMock).toHaveBeenCalledWith(REQUEST_DB, "acct1", ids, expect.anything());
    expect(groupNextUpMock).toHaveBeenCalledWith(REQUEST_DB, "acct1", ids, expect.any(String));
    expect(listTimelinePageMock).toHaveBeenCalledWith(REQUEST_DB, "acct1", ids, undefined, expect.anything());
    // S-07: the group's own documents reach its timeline only through its id (mutation: drop group.id at page.tsx's loadGroupTimeline call -> FAILS).
    expect(listTimelinePageMock).toHaveBeenCalledWith(REQUEST_DB, "acct1", ids, undefined, expect.objectContaining({ groupId: G }));
  });

  it("the summary fails alone: Next up and the timeline still render (part 1 C5; mutation: one shared try for the three -> FAILS)", async () => {
    groupFactsMock.mockRejectedValue(new Error("facts down"));
    const html = await render();
    expect(cardHtml(html, "summary")).toMatch(/data-state="error"/);
    expect(cardHtml(html, "summary")).toContain(esc(m["record.summary.failed"]));
    expect(cardHtml(html, "next-up")).toMatch(/data-state="ready"/);
    expect(cardHtml(html, "timeline")).toMatch(/data-state="ready"/);
  });

  it("Next up fails alone (mutation: let its loader's error reject the page -> FAILS)", async () => {
    groupNextUpMock.mockRejectedValue(new Error("next up down"));
    const html = await render();
    expect(cardHtml(html, "next-up")).toMatch(/data-state="error"/);
    expect(cardHtml(html, "next-up")).toContain(esc(m["record.nextUp.failed"]));
    expect(cardHtml(html, "summary")).toMatch(/data-state="ready"/);
    expect(cardHtml(html, "timeline")).toMatch(/data-state="ready"/);
  });

  it("the timeline fails alone (mutation: let its loader's error reject the page -> FAILS)", async () => {
    listTimelinePageMock.mockRejectedValue(new Error("timeline down"));
    const html = await render();
    expect(cardHtml(html, "timeline")).toMatch(/data-state="error"/);
    expect(cardHtml(html, "timeline")).toContain(esc(m["record.activity.failed"]));
    expect(cardHtml(html, "summary")).toMatch(/data-state="ready"/);
    expect(cardHtml(html, "next-up")).toMatch(/data-state="ready"/);
  });

  it("every fact failing is the summary's error, not an empty line (spec §8.6; mutation: ignore allFailed -> FAILS)", async () => {
    groupActivityMembersMock.mockResolvedValue({ people: [ANA_P], total: { ok: false }, more: false });
    groupFactsMock.mockResolvedValue({ bookingsMade: { ok: false }, lastTalked: { ok: false } });
    const html = await render();
    expect(cardHtml(html, "summary")).toMatch(/data-state="error"/);
    expect(cardHtml(html, "summary")).toContain(esc(m["record.summary.failed"]));
  });

  it("no activity set (its scan failed): the three middle cards are errors, no read is made with a guessed set, and no cap line (C5; mutation: read with People's ids -> FAILS)", async () => {
    groupActivityMembersMock.mockRejectedValue(new Error("scan down"));
    const html = await render();
    for (const id of ["summary", "next-up", "timeline"]) expect(cardHtml(html, id), id).toMatch(/data-state="error"/);
    for (const f of [groupFactsMock, groupNextUpMock, listTimelinePageMock]) expect(f).not.toHaveBeenCalled();
    expect(html).not.toContain("data-group-capped");
    expect(cardHtml(html, "people")).toMatch(/data-state="ready"/);
  });

  it("the facts: '2 people', booked, and Last talked naming the member's first name (C9; mutation: the full name -> FAILS)", async () => {
    groupFactsMock.mockResolvedValue({ bookingsMade: { ok: true, value: 3 }, lastTalked: { ok: true, value: { at: AT, channel: "text", contactId: ANA.contactId } } });
    const html = cardHtml(await render(), "summary");
    expect(html).toMatch(/<p data-record-facts[^>]*>2 people · Booked 3 times · Last talked [^<]+ with Ana \(text\)<\/p>/);
  });

  it("a narrow reader's people fact reads 'people you can see' (C4; mutation: narrow from isAgency -> an Owner is told 'you can see', FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValue({ userId: "u1", isAgency: false, role: "technician", canManage: false });
    expect(cardHtml(await render(), "summary")).toContain(">2 people you can see<");
    requireAccountAccessMock.mockResolvedValue({ userId: "u1", isAgency: false, role: "owner", canManage: true });
    expect(cardHtml(await render(), "summary")).toContain(">2 people<");
  });

  it("the cap line: once, the FIRST node of the middle column, above the summary, only past 50 (D7, plan deviation 12; mutation: put it inside the summary card -> FAILS)", async () => {
    groupActivityMembersMock.mockResolvedValue({ people: many(50), total: { ok: true, value: 73 }, more: true });
    const html = await render();
    expect(html.match(/data-group-capped/g)).toHaveLength(1);
    expect(happening(html)).toMatch(/^<p data-group-capped[^>]*>Showing activity for 50 of 73 people\. Open a person to see theirs\.<\/p><section[^>]*data-record-card="summary"/);
    expect(cardHtml(html, "summary")).not.toContain("data-group-capped");
  });

  it("the cap line stays when the summary fails (plan deviation 12; mutation: draw it in the summary's slot -> FAILS)", async () => {
    groupActivityMembersMock.mockResolvedValue({ people: many(50), total: { ok: true, value: 73 }, more: true });
    groupFactsMock.mockRejectedValue(new Error("facts down"));
    const html = await render();
    expect(cardHtml(html, "summary")).toMatch(/data-state="error"/);
    expect(happening(html)).toMatch(/^<p data-group-capped/);
  });

  it("no cap line at exactly 50, and a narrow reader's reads 'of the 73 people you can see' (C4; mutation: >= 50 -> FAILS)", async () => {
    groupActivityMembersMock.mockResolvedValue({ people: many(50), total: { ok: true, value: 50 }, more: false });
    expect(await render()).not.toContain("data-group-capped");
    requireAccountAccessMock.mockResolvedValue({ userId: "u1", isAgency: false, role: "technician", canManage: false });
    groupActivityMembersMock.mockResolvedValue({ people: many(50), total: { ok: true, value: 73 }, more: true });
    expect(await render()).toContain(">Showing activity for 50 of the 73 people you can see. Open a person to see theirs.<");
  });

  it("the count failed but the scan held more than 50: the cap line still shows, first, naming no total (review of Task 16; mutation: drop more from groupCapLine's input -> FAILS)", async () => {
    groupActivityMembersMock.mockResolvedValue({ people: many(50), total: { ok: false }, more: true });
    const html = await render();
    expect(happening(html)).toMatch(new RegExp(`^<p data-group-capped[^>]*>${m["groupPage.cap.unknownTotal"].replace("{shown}", "50").replaceAll(".", "\\.")}</p><section`));
    // And with no more scanned, no line: nothing says the list was cut.
    groupActivityMembersMock.mockResolvedValue({ people: many(50), total: { ok: false }, more: false });
    expect(await render()).not.toContain("data-group-capped");
  });

  it("Next up names each row's member by first name (spec §8.7, C9; mutation: drop names from nextUpView -> FAILS)", async () => {
    groupNextUpMock.mockResolvedValue({ bookings: [{ id: "b1", starts_at: "2099-01-05T15:00:00Z", contact_id: LUIS.contactId }], datedTasks: [], undatedCount: 0 });
    const html = cardHtml(await render(), "next-up");
    expect(html).toMatch(/data-next-up-who=""[^>]*> · <span lang="">Luis<\/span>/);
    expect(html).not.toContain(m["record.nextUp.addTodo"]);
  });

  it("Next up: a nameless member reads the page's '(no name)' with no lang=\"\", a named one keeps it (final review minor b; mutation: typed: true for everyone -> FAILS)", async () => {
    prefsMock.mockResolvedValue({ language: "es", theme: null });
    groupActivityMembersMock.mockResolvedValue({ people: [LUIS_P, person({ contactId: "c-n", firstName: null, lastName: "  " })], total: { ok: true, value: 2 }, more: false });
    groupNextUpMock.mockResolvedValue({ bookings: [
      { id: "b1", starts_at: "2099-01-05T15:00:00Z", contact_id: LUIS.contactId },
      { id: "b2", starts_at: "2099-01-06T15:00:00Z", contact_id: "c-n" },
    ], datedTasks: [], undatedCount: 0 });
    const html = cardHtml(await render(), "next-up");
    expect(html).toMatch(/data-next-up-who=""[^>]*> · <span lang="">Luis<\/span>/);
    expect(html).toMatch(new RegExp(`data-next-up-who=""[^>]*> · <span>${m["contact.noName.es"].replace(/[()]/g, "\\$&")}</span>`));
  });

  it("Next up empty: the group's sentence, no Add a To-do (spec §8.7; mutation: the contact page's empty text -> FAILS)", async () => {
    const html = cardHtml(await render(), "next-up");
    expect(html).toContain(esc(m["groupPage.nextUp.empty"]));
    expect(html).not.toContain(m["record.nextUp.addTodo"]);
  });

  it("timeline rows name their member with a link to the member's page, and keep the mark (C8; mutation: no subjects -> FAILS)", async () => {
    listTimelinePageMock.mockResolvedValue({ items: [callOf(ANA.contactId), noteOf(LUIS.contactId)], older: null, failed: [] });
    const html = cardHtml(await render(), "timeline");
    expect(html).toMatch(new RegExp(`<a (?=[^>]*href="/dashboard/accounts/acct1/contacts/${ANA.contactId}")(?=[^>]*data-timeline-subject)[^>]*>Ana García</a>`));
    expect(html).toMatch(new RegExp(`<a (?=[^>]*href="/dashboard/accounts/acct1/contacts/${LUIS.contactId}")(?=[^>]*data-timeline-subject)[^>]*>Luis García</a>`));
    expect(html.match(/data-author-mark=/g)).toHaveLength(2);
    expect(html).not.toContain("data-timeline-composer");
  });

  it("timeline empty on the head with nothing failed: the group's sentence (rule 5; mutation: the contact page's timeline.empty -> FAILS)", async () => {
    expect(cardHtml(await render(), "timeline")).toContain(esc(m["groupPage.timeline.empty"]));
  });

  it("a source failed: the failure is said, with no empty sentence and no Older (spec §8.8; mutation: show the empty text whenever rows are empty -> FAILS)", async () => {
    listTimelinePageMock.mockResolvedValue({ items: [], older: { v: AT, id: "n1" }, failed: ["calls"] });
    const html = cardHtml(await render(), "timeline");
    expect(html).toContain("data-timeline-failed");
    expect(html).not.toContain("data-timeline-empty");
    expect(html).not.toContain(">Older<");
  });

  it("?before= reaches the timeline read and gives Newer; Older carries the page's cursor (DESIGN.md, Paged lists; mutation: ignore ?before= -> FAILS)", async () => {
    const { encodeCursor } = await import("@/lib/cursor");
    const cursor = { v: AT, id: "55555555-5555-4555-8555-555555555555" };
    listTimelinePageMock.mockResolvedValue({ items: [noteOf(LUIS.contactId)], older: { v: AT, id: "n1" }, failed: [] });
    const html = cardHtml(await render({ before: encodeCursor(cursor), locale: "es" }), "timeline");
    expect(listTimelinePageMock).toHaveBeenLastCalledWith(REQUEST_DB, "acct1", [ANA.contactId, LUIS.contactId], cursor, expect.anything());
    expect(html).toContain(`href="/dashboard/accounts/acct1/groups/${G}?locale=es#record-timeline"`);
    expect(html).toContain(`href="/dashboard/accounts/acct1/groups/${G}?locale=es&amp;before=${encodeCursor({ v: AT, id: "n1" })}#record-timeline"`);
    // A paged view never shows the empty sentence (it is the head's).
    expect(html).not.toContain("data-timeline-empty");
  });

  it("Spanish: '2 personas' and the group's empty sentences in Spanish (D10)", async () => {
    prefsMock.mockResolvedValue({ language: "es", theme: null });
    const html = await render();
    expect(cardHtml(html, "summary")).toContain(">2 personas<");
    expect(cardHtml(html, "next-up")).toContain(esc(m["groupPage.nextUp.empty.es"]));
    expect(cardHtml(html, "timeline")).toContain(esc(m["groupPage.timeline.empty.es"]));
  });

  it("a group with no one in it: the summary says so with the People card's own sentence, by kind, never an empty line (final review minor a; mutation: drop the zero-member branch -> FAILS)", async () => {
    groupActivityMembersMock.mockResolvedValue({ people: [], total: { ok: true, value: 0 }, more: false });
    expect(cardHtml(await render(), "summary")).toMatch(new RegExp(`<p data-record-facts[^>]*>${esc(m["groupPage.people.emptyHousehold"]).replaceAll(".", "\\.")}</p>`));
    readGroupMock.mockResolvedValue({ ...GROUP, kind: "business", name: "Rio Roofing" });
    expect(cardHtml(await render(), "summary")).toContain(esc(m["groupPage.people.emptyBusiness"]));
  });

  it("still names no hero with the middle column drawn (rule 11)", async () => {
    groupActivityMembersMock.mockResolvedValue({ people: many(50), total: { ok: true, value: 73 }, more: true });
    expect(await render()).not.toContain("data-hero");
  });
});
