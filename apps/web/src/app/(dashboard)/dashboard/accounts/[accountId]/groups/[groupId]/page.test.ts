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
}));
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

async function render(over: { groupId?: string; people?: string; locale?: string } = {}) {
  const search: Record<string, string> = {};
  if (over.people !== undefined) search.people = over.people;
  if (over.locale !== undefined) search.locale = over.locale;
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
  placesCardProps.length = 0; peopleCardProps.length = 0; detailsCardProps.length = 0;
  errors?.mockRestore();
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

const EVERY_READ = () => [listGroupMembersMock, listGroupPeopleMock, listGroupPlacesMock, listOpenDealsForMock, listContactPlacesMock,
  getContactMock, resolveSmsSenderMock, prefsMock, ledgerDbMock, accountRead];

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
  it("the cards in phone order are the DOM order, and 2a's middle column is empty (C6; mutation: render the registry in desk order -> FAILS)", async () => {
    const html = await render();
    const ids = [...html.matchAll(/data-record-card="([\w-]+)"/g)].map((x) => x[1]);
    expect(ids).toEqual(cardsInPhoneOrder(GROUP_RECORD_CARDS).map((d) => d.id));
    expect(ids).toEqual(["properties", "deals", "people", "details"]);
    expect(html).not.toContain('data-record-column="happening"');
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

  it("Deals reads exactly the people listGroupPeople returned (C13; mutation: read the deals of no one -> FAILS)", async () => {
    listGroupPeopleMock.mockResolvedValue([{ contactId: "c1", firstName: "Ana", lastName: null }, { contactId: "c2", firstName: "Luis", lastName: null }]);
    await render();
    expect(listGroupPeopleMock).toHaveBeenCalledWith(REQUEST_DB, "acct1", G);
    expect(listOpenDealsForMock).toHaveBeenCalledWith(REQUEST_DB, "acct1", ["c1", "c2"]);
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
