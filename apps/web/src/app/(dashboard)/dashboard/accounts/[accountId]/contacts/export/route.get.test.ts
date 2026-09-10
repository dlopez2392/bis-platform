import { describe, expect, it, vi, beforeEach } from "vitest";

// Supplementary to route.test.ts (which is transcribed verbatim from the
// task brief and covers only the pure toCsv/CSV_COLUMNS contract). This file
// covers the GET handler itself — described in prose in the brief, not
// pre-written — against the CONSTRAINTS the task called out explicitly:
// the account access check, honoring q/sort/dir, the chunked tuple-cursor
// pagination past 500 rows, and the empty tags column. Same mocking shape as
// the sibling ⌘K search route's own test (search/route.test.ts).

const access = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAccountAccess: (...a: unknown[]) => access(...a) }));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => ({}) }));

const listContacts = vi.fn();
vi.mock("@bis/db", () => ({ listContacts: (...a: unknown[]) => listContacts(...a) }));

const { GET } = await import("./route");

function req(qs = ""): Request {
  return new Request(`http://x/dashboard/accounts/a1/contacts/export${qs}`);
}
function ctx() {
  return { params: Promise.resolve({ accountId: "a1" }) };
}
async function text(res: Response): Promise<string> {
  return await res.text();
}

beforeEach(() => {
  access.mockReset();
  listContacts.mockReset();
  access.mockResolvedValue({ userId: "u1", isAgency: true });
});

describe("contacts CSV export route (GET)", () => {
  it("checks account access, for THIS account, before touching the database", async () => {
    const denied = new Error("NEXT_REDIRECT"); // stand-in for requireAccountAccess's real redirect() throw
    access.mockRejectedValueOnce(denied);
    await expect(GET(req(), ctx())).rejects.toBe(denied);
    expect(access).toHaveBeenCalledWith("a1");
    expect(listContacts).not.toHaveBeenCalled();
  });

  it("passes q, sort and dir straight through — 'export what I'm looking at'", async () => {
    listContacts.mockResolvedValueOnce([]);
    await GET(req("?q=rosa&sort=company&dir=asc"), ctx());
    expect(listContacts).toHaveBeenCalledWith({}, "a1",
      { search: "rosa", limit: 500, before: undefined, sort: { key: "company", dir: "asc" } });
  });

  it("falls back to the list page's own default (created, desc) for a missing or invalid sort/dir", async () => {
    listContacts.mockResolvedValueOnce([]);
    await GET(req("?sort=bogus&dir=sideways"), ctx());
    expect(listContacts).toHaveBeenCalledWith({}, "a1",
      { search: undefined, limit: 500, before: undefined, sort: { key: "created", dir: "desc" } });
  });

  it("streams just the header for zero matches, with the CSV response headers set", async () => {
    listContacts.mockResolvedValueOnce([]);
    const res = await GET(req(), ctx());
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="contacts-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(await text(res)).toBe("first_name,last_name,email,phone,company_name,source,tags");
  });

  it("emits an empty tags column per row — no bulk tag read exists yet (see task report)", async () => {
    listContacts.mockResolvedValueOnce([{
      id: "c1", first_name: "Ana", last_name: null, email: null, phone: null,
      company_name: null, source: null, sort_name: "ana", created_at: "2026-01-01T00:00:00Z",
    }]);
    const res = await GET(req(), ctx());
    expect(await text(res)).toBe(
      "first_name,last_name,email,phone,company_name,source,tags\nAna,,,,,,");
  });

  it("pages past one chunk using the tuple cursor built from the last row", async () => {
    const full = Array.from({ length: 500 }, (_, i) => ({
      id: `id-${i}`, first_name: `F${i}`, last_name: null, email: null, phone: null,
      company_name: null, source: null, sort_name: `F${i}`, created_at: "2026-01-01T00:00:00Z",
    }));
    const last = full[full.length - 1]!;
    listContacts.mockResolvedValueOnce(full).mockResolvedValueOnce([]);
    await GET(req(), ctx());
    expect(listContacts).toHaveBeenCalledTimes(2);
    expect(listContacts).toHaveBeenNthCalledWith(2, {}, "a1", {
      search: undefined, limit: 500,
      before: { v: last.created_at, id: last.id },
      sort: { key: "created", dir: "desc" },
    });
  });

  it("does not issue a wasted extra query when the last chunk is short", async () => {
    listContacts.mockResolvedValueOnce([{
      id: "c1", first_name: "Ana", last_name: null, email: null, phone: null,
      company_name: null, source: null, sort_name: "ana", created_at: "2026-01-01T00:00:00Z",
    }]);
    await GET(req(), ctx());
    expect(listContacts).toHaveBeenCalledTimes(1);
  });
});
