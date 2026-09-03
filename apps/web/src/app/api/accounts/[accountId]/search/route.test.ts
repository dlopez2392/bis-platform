import { describe, it, expect, vi, beforeEach } from "vitest";

const access = vi.fn();
vi.mock("@/lib/auth", () => ({ apiAccountAccess: (...a: unknown[]) => access(...a) }));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => ({}) }));

const dbMocks = {
  listContacts: vi.fn(), searchCalls: vi.fn(), searchConversations: vi.fn(),
};
// The three READS are mocked; `sanitizeSearchTerm` is the REAL one. Stubbing
// it would make this file assert against a sanitizer of its own invention —
// the "a mock more permissive than the real thing proves nothing" trap — and
// the query-floor tests below exist precisely to pin the real one's behaviour
// at this boundary.
vi.mock("@bis/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bis/db")>();
  return { ...dbMocks, sanitizeSearchTerm: actual.sanitizeSearchTerm };
});

const { GET } = await import("./route");

function req(q: string) {
  return new Request(`http://x/api/accounts/a1/search?q=${encodeURIComponent(q)}`);
}
function ctx() { return { params: Promise.resolve({ accountId: "a1" }) }; }

beforeEach(() => {
  access.mockReset();
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listContacts.mockResolvedValue([]);
  dbMocks.searchCalls.mockResolvedValue([]);
  dbMocks.searchConversations.mockResolvedValue([]);
});

describe("account search route", () => {
  it("404s without access — same answer for no-access and unknown account", async () => {
    access.mockResolvedValueOnce(null);
    expect((await GET(req("rosa"), ctx())).status).toBe(404);
    expect(dbMocks.listContacts).not.toHaveBeenCalled();
  });

  it("returns empty groups for a too-short query without touching the database", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    const body = await (await GET(req("a"), ctx())).json();
    expect(body).toEqual({ contacts: [], calls: [], conversations: [] });
    expect(dbMocks.listContacts).not.toHaveBeenCalled();
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
    for (const hostile of ["%%", "()", "__", "**", `""`]) {
      const body = await (await GET(req(hostile), ctx())).json();
      expect(body, `query ${hostile}`).toEqual({ contacts: [], calls: [], conversations: [] });
    }
    expect(dbMocks.listContacts).not.toHaveBeenCalled();
  });

  it("measures the query floor after sanitizing, not before", async () => {
    // "(a)" is three characters raw and one character of actual query.
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    const body = await (await GET(req("(a)"), ctx())).json();
    expect(body).toEqual({ contacts: [], calls: [], conversations: [] });
    expect(dbMocks.listContacts).not.toHaveBeenCalled();
  });

  it("passes the SANITIZED term to the database, not the raw one", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    await GET(req(`ro"sa`), ctx());
    expect(dbMocks.listContacts).toHaveBeenCalledWith({}, "a1", { search: "rosa", limit: 5 });
  });

  it("caps every source at five and asks the database for no more", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `c${i}`, first_name: "A", last_name: `B${i}`, email: null, phone: null,
      }));
    dbMocks.listContacts.mockResolvedValue(many(9));
    const body = await (await GET(req("rosa"), ctx())).json();
    expect(body.contacts).toHaveLength(5);
    expect(dbMocks.listContacts).toHaveBeenCalledWith({}, "a1", { search: "rosa", limit: 5 });
    expect(dbMocks.searchCalls).toHaveBeenCalledWith({}, "a1", { search: "rosa", limit: 5 });
    expect(dbMocks.searchConversations).toHaveBeenCalledWith({}, "a1", { search: "rosa", limit: 5 });
  });

  it("tolerates listContacts returning null, which its signature allows", async () => {
    // listContacts has no return annotation and hands back PostgREST's raw
    // `data`, so `null` is in its inferred type. A palette must not 500 on it.
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    dbMocks.listContacts.mockResolvedValue(null);
    const res = await GET(req("rosa"), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).contacts).toEqual([]);
  });

  it("builds a working href and a localized sublabel for each kind", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    dbMocks.listContacts.mockResolvedValue([
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
    expect(body.conversations[0].sublabel).toBe("cedar fence");
    // A conversation hit carries NO date on purpose. `sublabel` is the MATCHED
    // message but `lastMessageAt` is the thread's NEWEST one, so pairing them
    // would caption a line from March with today's date. Pinned, because
    // "restore the date" is an inviting one-character change.
    expect(body.conversations[0].at).toBeNull();
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
    dbMocks.listContacts.mockResolvedValue([
      { id: "c2", first_name: null, last_name: null, email: null, phone: "+19565550000" },
    ]);
    const body = await (await GET(req("956"), ctx())).json();
    expect(body.contacts[0].label).toBe("Unnamed contact");
    expect(body.contacts[0].sublabel).toBe("+19565550000");
  });

  it("500s rather than reporting an empty result when a source throws", async () => {
    // Silence would render as "nothing found" — a lie about a failure. The
    // route must fail loudly so the palette can show its error row.
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    dbMocks.searchCalls.mockRejectedValue(new Error("permission denied for table calls"));
    await expect(GET(req("rosa"), ctx())).rejects.toThrow(/permission denied/);
  });
});
