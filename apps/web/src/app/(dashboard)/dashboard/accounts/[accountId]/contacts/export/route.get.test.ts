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

type FixtureRow = {
  id: string; first_name: string; last_name: null; email: null; phone: null;
  company_name: string; source: null; sort_name: string; created_at: string;
};

// first_name doubles as this row's unique identity in the assertions below
// — id isn't a CSV column, so it can't be recovered from the output.
// sort_name/company_name are deliberately DIFFERENT strings from
// first_name and from each other, so a test that only passes because
// cursorValue grabbed the wrong field would be caught.
function makeRow(n: number): FixtureRow {
  return {
    id: `id-${n}`, first_name: `F${n}`, last_name: null, email: null, phone: null,
    company_name: `CN${n}`, source: null, sort_name: `SN${n}`, created_at: "2026-01-01T00:00:00Z",
  };
}

// The row lines after the header. route.ts never emits a trailing newline,
// so split("\n") needs no filtering for a trailing empty entry.
function dataLines(body: string): string[] {
  return body.split("\n").slice(1);
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

  it("prefixes the body with a UTF-8 BOM — Excel mis-renders á/ñ/é without it on double-click open", async () => {
    listContacts.mockResolvedValueOnce([]);
    const res = await GET(req(), ctx());
    // res.text() would silently STRIP a leading BOM here (verified against
    // this runtime: Fetch's UTF-8-decode algorithm removes it), so proving
    // it's actually on the wire means reading raw bytes, not decoded text.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
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

  it.each([
    ["created", "created_at"],
    ["name", "sort_name"],
    ["company", "company_name"],
  ] as const)(
    "pages past a chunk boundary with every row exactly once, no drops or dupes — sort=%s uses the %s cursor",
    async (sortKey, cursorField) => {
      // Two NON-empty chunks (500 then 4) so there's a real boundary rows
      // can be lost across, and the second chunk is short enough to end
      // the loop without a third (empty) call.
      const chunk1 = Array.from({ length: 500 }, (_, i) => makeRow(i));
      const chunk2 = Array.from({ length: 4 }, (_, i) => makeRow(500 + i));
      const last1 = chunk1[chunk1.length - 1]!;
      listContacts.mockResolvedValueOnce(chunk1).mockResolvedValueOnce(chunk2);

      const res = await GET(req(`?sort=${sortKey}`), ctx());

      expect(listContacts).toHaveBeenCalledTimes(2);
      expect(listContacts).toHaveBeenNthCalledWith(2, {}, "a1", {
        search: undefined, limit: 500,
        before: { v: last1[cursorField], id: last1.id },
        sort: { key: sortKey, dir: "desc" },
      });

      // The property that actually matters: the ASSEMBLED FILE has every
      // row exactly once across the chunk boundary. Asserting only the
      // second call's arguments (as this test used to) can't tell a
      // complete export from a truncated one — a chunk-loop bug that stops
      // after the first page would still produce those very same arguments
      // right before it stops.
      const rows = dataLines(await text(res));
      const names = rows.map((l) => l.split(",")[0]);
      const expectedNames = [...chunk1, ...chunk2].map((r) => r.first_name);
      expect(names).toHaveLength(504);
      expect([...names].sort()).toEqual([...expectedNames].sort());
    },
  );

  it("does not issue a wasted extra query when the last chunk is short", async () => {
    listContacts.mockResolvedValueOnce([{
      id: "c1", first_name: "Ana", last_name: null, email: null, phone: null,
      company_name: null, source: null, sort_name: "ana", created_at: "2026-01-01T00:00:00Z",
    }]);
    await GET(req(), ctx());
    expect(listContacts).toHaveBeenCalledTimes(1);
  });
});
