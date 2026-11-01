import { describe, it, expect, vi, beforeEach } from "vitest";

const access = vi.fn();
vi.mock("@/lib/auth", () => ({ apiAccountAccess: (...a: unknown[]) => access(...a) }));
/** The request client: a sentinel, so a test can prove it (not serviceDb()) is what reaches each search. */
const REQUEST = {
  tag: "request-db",
  // S-10 fix round I7: the route reads the account's language for a client
  // reader. Still the same sentinel object, so the identity checks below hold.
  from: (table: string) => {
    if (table !== "accounts") throw new Error(`unexpected read of ${table}`);
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { language: localeFixture.account }, error: null }) }) }) };
  },
};
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));
const localeFixture = vi.hoisted(() => ({ person: null as "en" | "es" | null, account: null as "en" | "es" | null }));
vi.mock("@/lib/preferences/person-prefs", () => ({
  getPersonPrefs: async () => ({ language: localeFixture.person, theme: null }),
}));

const dbMocks = {
  searchContacts: vi.fn(), searchCalls: vi.fn(), searchConversations: vi.fn(),
};
// The three READS are mocked; `sanitizeSearchTerm`/`searchTermLength` are
// the REAL ones. Stubbing them would make this file assert against a
// sanitizer of its own invention — the "a mock more permissive than the
// real thing proves nothing" trap — and the query-floor tests below exist
// precisely to pin the real ones' behaviour at this boundary.
vi.mock("@bis/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bis/db")>();
  return { ...dbMocks, sanitizeSearchTerm: actual.sanitizeSearchTerm, searchTermLength: actual.searchTermLength };
});

const { GET } = await import("./route");

function req(q: string, types?: string) {
  const t = types === undefined ? "" : `&types=${encodeURIComponent(types)}`;
  return new Request(`http://x/api/accounts/a1/search?q=${encodeURIComponent(q)}${t}`);
}
function ctx() { return { params: Promise.resolve({ accountId: "a1" }) }; }

beforeEach(() => {
  localeFixture.person = null;
  localeFixture.account = null;
  access.mockReset();
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.searchContacts.mockResolvedValue([]);
  dbMocks.searchCalls.mockResolvedValue([]);
  dbMocks.searchConversations.mockResolvedValue([]);
});

describe("account search route", () => {
  it("404s without access — same answer for no-access and unknown account", async () => {
    access.mockResolvedValueOnce(null);
    expect((await GET(req("rosa"), ctx())).status).toBe(404);
    expect(dbMocks.searchContacts).not.toHaveBeenCalled();
  });

  it("returns empty groups for a too-short query without touching the database", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    const body = await (await GET(req("a"), ctx())).json();
    expect(body).toEqual({ contacts: [], calls: [], conversations: [] });
    expect(dbMocks.searchContacts).not.toHaveBeenCalled();
    expect(dbMocks.searchCalls).not.toHaveBeenCalled();
    expect(dbMocks.searchConversations).not.toHaveBeenCalled();
  });

  it("treats a query that sanitizes away as no query at all", async () => {
    // "%%" and "()" clear a RAW two-character floor but carry no searchable
    // term. listContacts is a LIST function whose `if (s)` guard reads an
    // empty term as "no filter", so without gating on the SANITIZED term the
    // palette would render the five most recent contacts as if they had
    // MATCHED "%%" — a lie about a search, and inconsistent with its two
    // siblings, which return [].
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    // D-009: "__" dropped out of this list — an underscore is now ESCAPED,
    // not deleted, so "__" sanitizes to the real two-character query "\_\_"
    // and clears the floor like any other short literal term (pinned in its
    // own test below), rather than vanishing like these four still do.
    for (const hostile of ["%%", "()", "**", `""`]) {
      const body = await (await GET(req(hostile), ctx())).json();
      expect(body, `query ${hostile}`).toEqual({ contacts: [], calls: [], conversations: [] });
    }
    expect(dbMocks.searchContacts).not.toHaveBeenCalled();
  });

  it("D-009: an underscore query clears the floor and reaches every search as typed; each escapes it for itself", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    await GET(req("__"), ctx());
    expect(dbMocks.searchContacts).toHaveBeenCalledWith(REQUEST, "a1", { term: "__", limit: 5 });
    expect(dbMocks.searchCalls).toHaveBeenCalledWith(REQUEST, "a1", { search: "__", limit: 5 });
  });

  // Review correction: the floor used to be measured on `sanitizeSearchTerm`'s
  // ESCAPED output, and a lone "_" escapes to "\_" — two characters — which
  // cleared a two-character floor on exactly one real character typed. It is
  // now measured with `searchTermLength`, on the term BEFORE that escape.
  it("D-009 (review correction): a single underscore does NOT clear the floor, even though it escapes to two characters (mutation: measure q.length instead → FAILS)", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    const body = await (await GET(req("_"), ctx())).json();
    expect(body).toEqual({ contacts: [], calls: [], conversations: [] });
    expect(dbMocks.searchContacts).not.toHaveBeenCalled();
  });

  it("measures the query floor after sanitizing, not before", async () => {
    // "(a)" is three characters raw and one character of actual query.
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    const body = await (await GET(req("(a)"), ctx())).json();
    expect(body).toEqual({ contacts: [], calls: [], conversations: [] });
    expect(dbMocks.searchContacts).not.toHaveBeenCalled();
  });

  it("F-092: passes the RAW term to all three, each of which sanitizes for itself, so nothing is sanitized twice (mutation: sanitize here again -> FAILS)", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    await GET(req(`ro"sa`), ctx());
    expect(dbMocks.searchContacts).toHaveBeenCalledWith(REQUEST, "a1", { term: `ro"sa`, limit: 5 });
    expect(dbMocks.searchCalls).toHaveBeenCalledWith(REQUEST, "a1", { search: `ro"sa`, limit: 5 });
    expect(dbMocks.searchConversations).toHaveBeenCalledWith(REQUEST, "a1", { search: `ro"sa`, limit: 5 });
  });

  it("contacts-archive Task 12 / F-092: asks searchContacts for the term and the limit only, so its own archive rule (exclude) holds (mutation: pass archived: \"only\" -> FAILS)", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    await GET(req("rosa"), ctx());
    const [, , opts] = dbMocks.searchContacts.mock.calls[0]!;
    expect(opts).toEqual({ term: "rosa", limit: 5 });
  });

  it("F-092 (plan correction 1): every search runs on the REQUEST client, so RLS decides who is found (mutation: hand searchContacts serviceDb() -> FAILS)", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    await GET(req("rosa"), ctx());
    expect(dbMocks.searchContacts.mock.calls[0]![0]).toBe(REQUEST);
    expect(dbMocks.searchCalls.mock.calls[0]![0]).toBe(REQUEST);
    expect(dbMocks.searchConversations.mock.calls[0]![0]).toBe(REQUEST);
  });

  it("F-092: types=contacts runs the contacts search only and answers the other two empty (mutation: ignore types -> FAILS)", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    dbMocks.searchContacts.mockResolvedValue([{ id: "c1", first_name: "Ana", last_name: null, email: null, phone: null }]);
    const body = await (await GET(req("ana", "contacts"), ctx())).json();
    expect(dbMocks.searchContacts).toHaveBeenCalledTimes(1);
    expect(dbMocks.searchCalls).not.toHaveBeenCalled();
    expect(dbMocks.searchConversations).not.toHaveBeenCalled();
    expect(body.contacts.map((h: { id: string }) => h.id)).toEqual(["c1"]);
    expect(body.calls).toEqual([]);
    expect(body.conversations).toEqual([]);
  });

  it("F-092: types is a comma list; calls,conversations skips contacts", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    const body = await (await GET(req("ana", "calls,conversations"), ctx())).json();
    expect(dbMocks.searchContacts).not.toHaveBeenCalled();
    expect(dbMocks.searchCalls).toHaveBeenCalledTimes(1);
    expect(dbMocks.searchConversations).toHaveBeenCalledTimes(1);
    expect(body.contacts).toEqual([]);
  });

  it("F-092: a types list naming none of the three (or empty) runs all three, as no types does", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    for (const types of ["bogus", "", ","]) {
      for (const fn of Object.values(dbMocks)) fn.mockClear();
      await GET(req("ana", types), ctx());
      expect(dbMocks.searchContacts, types).toHaveBeenCalledTimes(1);
      expect(dbMocks.searchCalls, types).toHaveBeenCalledTimes(1);
      expect(dbMocks.searchConversations, types).toHaveBeenCalledTimes(1);
    }
  });

  it("F-092: a phone search shows the phone it matched; a name search shows the email first, as before (mutation: always email first -> FAILS)", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    const hit = { id: "c1", first_name: "Maria", last_name: "Garcia", email: "a@b.c", phone: "+19565550199" };
    dbMocks.searchContacts.mockResolvedValue([hit]);
    expect((await (await GET(req("0199"), ctx())).json()).contacts[0].sublabel).toBe("+19565550199");
    expect((await (await GET(req("(956) 555-0199"), ctx())).json()).contacts[0].sublabel).toBe("+19565550199");
    expect((await (await GET(req("ana"), ctx())).json()).contacts[0].sublabel).toBe("a@b.c");
    // A phone-shaped term the stored phone does not hold (the hit matched on something else): the email, as before.
    expect((await (await GET(req("5550123"), ctx())).json()).contacts[0].sublabel).toBe("a@b.c");
  });

  it("F-092 (T4 review, Minor 3): a number found only by today's kept phone digits still shows as the match", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    dbMocks.searchContacts.mockResolvedValue([{ id: "c1", first_name: "C", last_name: null, email: "c@d.e", phone: "+19562195612" }]);
    expect((await (await GET(req("+1 956"), ctx())).json()).contacts[0].sublabel).toBe("+19562195612");
    dbMocks.searchContacts.mockResolvedValue([{ id: "c2", first_name: "L", last_name: null, email: "l@d.e", phone: "+5218991234567" }]);
    expect((await (await GET(req("+521 899 12"), ctx())).json()).contacts[0].sublabel).toBe("+5218991234567");
  });

  it("caps every source at five and asks the database for no more", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `c${i}`, first_name: "A", last_name: `B${i}`, email: null, phone: null,
      }));
    dbMocks.searchContacts.mockResolvedValue(many(9));
    const body = await (await GET(req("rosa"), ctx())).json();
    expect(body.contacts).toHaveLength(5);
    expect(dbMocks.searchContacts).toHaveBeenCalledWith(REQUEST, "a1", { term: "rosa", limit: 5 });
    expect(dbMocks.searchCalls).toHaveBeenCalledWith(REQUEST, "a1", { search: "rosa", limit: 5 });
    expect(dbMocks.searchConversations).toHaveBeenCalledWith(REQUEST, "a1", { search: "rosa", limit: 5 });
  });

  it("tolerates the contacts search answering null rather than 500ing", async () => {
    // listContacts, which this route called before F-092, handed back PostgREST's raw `data` (null in its
    // type); searchContacts answers an array, but a palette must still never 500 on a null.
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    dbMocks.searchContacts.mockResolvedValue(null);
    const res = await GET(req("rosa"), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).contacts).toEqual([]);
  });

  it("builds a working href and a localized sublabel for each kind", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    dbMocks.searchContacts.mockResolvedValue([
      { id: "c1", first_name: "Rosa", last_name: "Trevino", email: "rosa@x.com", phone: null },
    ]);
    dbMocks.searchCalls.mockResolvedValue([
      {
        id: "k1", started_at: "2026-09-01T10:00:00+00:00", outcome: "booked",
        caller_e164: "+19565551234", contact: null, duration_secs: 60,
        language: "en", contact_id: null,
      },
    ]);
    dbMocks.searchConversations.mockResolvedValue([
      {
        id: "v1", contactId: "c1", contactFirstName: "Rosa", contactLastName: "Trevino",
        lastMessageAt: "2026-09-01T10:00:00+00:00", lastMessagePreview: "cedar fence",
        unreadCount: 0,
      },
    ]);
    const body = await (await GET(req("rosa"), ctx())).json();

    expect(body.contacts[0].label).toBe("Rosa Trevino");
    expect(body.contacts[0].sublabel).toBe("rosa@x.com");
    expect(body.contacts[0].href).toBe("/dashboard/accounts/a1/contacts/c1");

    expect(body.calls[0].href).toBe("/dashboard/accounts/a1/calls/k1");
    // The LOCALIZED outcome, never the raw `calls.outcome` enum — the P4
    // drawer shipped "booked" beside a table showing "Booked" two clicks away.
    expect(body.calls[0].sublabel).toBe("Booked");
    expect(body.calls[0].sublabel).not.toBe("booked");
    // The raw ISO travels to the client, which formats it in the USER's zone.
    // Formatting here would render the previous day for the Americas.
    expect(body.calls[0].at).toBe("2026-09-01T10:00:00+00:00");

    expect(body.conversations[0].href).toBe("/dashboard/accounts/a1/conversations?c=v1");
    expect(body.conversations[0].label).toBe("Rosa Trevino");
    expect(body.conversations[0].sublabel).toBe("cedar fence");
    // A conversation hit carries NO date on purpose. `sublabel` is the MATCHED
    // message but `lastMessageAt` is the thread's NEWEST one, so pairing them
    // would caption a line from March with today's date. Pinned, because
    // "restore the date" is an inviting one-character change.
    expect(body.conversations[0].at).toBeNull();
  });

  it("S-47e Task 12 (P21): a shared number's holding thread labels 'Shared number (956) 555-0142', never 'Caller' (mutation: fall back to joinName always -> FAILS)", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    dbMocks.searchConversations.mockResolvedValue([
      {
        id: "vH", contactId: "ctH", contactFirstName: "Caller", contactLastName: null,
        lastMessageAt: "2026-09-01T10:00:00+00:00", lastMessagePreview: "hi",
        unreadCount: 0, holdsSharedNumber: true, sharedNumber: "+19565550142",
      },
    ]);
    const body = await (await GET(req("rosa"), ctx())).json();
    expect(body.conversations[0].label).toBe("Shared number (956) 555-0142");
    expect(body.conversations[0].label).not.toBe("Caller");
  });

  it("falls back to the raw outcome rather than throwing on an unknown enum value", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    dbMocks.searchCalls.mockResolvedValue([
      {
        id: "k9", started_at: "2026-09-01T10:00:00+00:00", outcome: "brand_new_outcome",
        caller_e164: "+19565551234", contact: null, duration_secs: 1,
        language: "en", contact_id: null,
      },
    ]);
    const body = await (await GET(req("rosa"), ctx())).json();
    expect(body.calls[0].sublabel).toBe("brand_new_outcome");
  });

  it("names an unnamed contact instead of rendering a blank row", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    dbMocks.searchContacts.mockResolvedValue([
      { id: "c2", first_name: null, last_name: null, email: null, phone: "+19565550000" },
    ]);
    const body = await (await GET(req("956"), ctx())).json();
    expect(body.contacts[0].label).toBe("Unnamed contact");
    expect(body.contacts[0].sublabel).toBe("+19565550000");
  });

  // F-092 final review M-4a: "Unnamed contact" is the route's own stand-in, not the customer's name, so it says
  // so on the hit and no client marks "contact" in it as though the search had matched a name.
  it("flags the unnamed contact's label as a stand-in, and only that one (mutation: never set unnamed -> FAILS)", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    dbMocks.searchContacts.mockResolvedValue([
      { id: "c2", first_name: null, last_name: null, email: "contact@roofs.example", phone: null },
      { id: "c3", first_name: "Contact", last_name: "Ruiz", email: null, phone: null },
    ]);
    const body = await (await GET(req("contact"), ctx())).json();
    expect(body.contacts[0]).toMatchObject({ label: "Unnamed contact", unnamed: true });
    expect(body.contacts[1].unnamed).toBeUndefined();
  });

  it("500s rather than reporting an empty result when a source throws", async () => {
    // Silence would render as "nothing found" — a lie about a failure. The
    // route must fail loudly so the palette can show its error row.
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    dbMocks.searchCalls.mockRejectedValue(new Error("permission denied for table calls"));
    await expect(GET(req("rosa"), ctx())).rejects.toThrow(/permission denied/);
  });
});

// S-10 fix round I7: ⌘K's call hits were English (callerLabel(c) and
// OUTCOMES[...].label, no locale) on an otherwise Spanish dashboard.
describe("account search route — the reader's language for call hits", () => {
  const CALL_HIT = { id: "c1", outcome: "booked", started_at: "2026-08-25T19:15:00Z", caller_e164: null, contact: null };

  it("a Spanish-reading operator gets the outcome and the unknown caller in Spanish (mutation: OUTCOMES[...].label / callerLabel(c) -> FAILS)", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    localeFixture.person = "es";
    dbMocks.searchCalls.mockResolvedValue([CALL_HIT]);
    const body = await (await GET(req("rosa", "calls"), ctx())).json();
    expect(body.calls[0]).toMatchObject({ label: "Desconocido", sublabel: "Agendó" });
  });

  it("a client with no choice of their own reads the account's Spanish", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: false });
    localeFixture.account = "es";
    dbMocks.searchCalls.mockResolvedValue([CALL_HIT]);
    const body = await (await GET(req("rosa", "calls"), ctx())).json();
    expect(body.calls[0]).toMatchObject({ label: "Desconocido", sublabel: "Agendó" });
  });

  it("an operator never inherits the account's Spanish (mutation: read the account for an operator and resolve with isOperator: false -> FAILS)", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    localeFixture.account = "es";
    dbMocks.searchCalls.mockResolvedValue([CALL_HIT]);
    const body = await (await GET(req("rosa", "calls"), ctx())).json();
    expect(body.calls[0]).toMatchObject({ label: "Unknown caller", sublabel: "Booked" });
  });
});
