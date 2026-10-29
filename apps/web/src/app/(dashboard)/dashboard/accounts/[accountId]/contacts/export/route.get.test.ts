import { describe, expect, it, vi, beforeEach } from "vitest";

// Supplementary to route.test.ts (which is transcribed verbatim from the
// task brief and covers only the pure toCsv/CSV_COLUMNS contract). This file
// covers the GET handler itself — described in prose in the brief, not
// pre-written — against the CONSTRAINTS the task called out explicitly:
// the account access check, honoring q/sort/dir, the chunked tuple-cursor
// pagination past 500 rows, and the empty tags column. Same mocking shape as
// the sibling ⌘K search route's own test (search/route.test.ts).

// Staff and roles (Task 6): export is Owner-only — the route's guard is
// requireAccountOwner, not requireAccountAccess.
const access = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAccountOwner: (...a: unknown[]) => access(...a) }));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => ({}) }));

const listContacts = vi.fn();
const listTagNamesForContacts = vi.fn();
const countContacts = vi.fn();
vi.mock("@bis/db", () => ({
  listContacts: (...a: unknown[]) => listContacts(...a),
  listTagNamesForContacts: (...a: unknown[]) => listTagNamesForContacts(...a),
  countContacts: (...a: unknown[]) => countContacts(...a),
}));

// F-118 part 1 (plan Task 7, review m5): the agency-visit gate and the access-log write. A download
// link must never fall through to a redirect that would save the chooser's HTML as the file.
const agencyVisitMissing = vi.fn(async (..._a: unknown[]) => false);
vi.mock("@/lib/access-log/gate", () => ({ agencyVisitMissing: (...a: unknown[]) => agencyVisitMissing(...a) }));
const noteOpenedApi = vi.fn(async (..._a: unknown[]) => true);
vi.mock("@/lib/access-log/note", () => ({ noteOpenedApi: (...a: unknown[]) => noteOpenedApi(...a) }));

const { GET } = await import("./route");
const { m } = await import("@/lib/messages");

function req(qs = "", headers?: Record<string, string>): Request {
  return new Request(`http://x/dashboard/accounts/a1/contacts/export${qs}`, headers ? { headers } : undefined);
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
  listTagNamesForContacts.mockReset();
  countContacts.mockReset();
  agencyVisitMissing.mockReset();
  noteOpenedApi.mockReset();
  access.mockResolvedValue({ userId: "u1", isAgency: true });
  listTagNamesForContacts.mockResolvedValue(new Map());
  countContacts.mockResolvedValue(0);
  agencyVisitMissing.mockResolvedValue(false);
  noteOpenedApi.mockResolvedValue(true);
});

describe("contacts CSV export route (GET)", () => {
  // Staff and roles (Task 6): export is Owner-only, so a Staff caller's
  // requireAccountOwner redirect (never 403 — requireAccountOwner's own
  // doc comment) must be rejected as-is before listContacts ever runs.
  // (mutation: call requireAccountAccess instead of requireAccountOwner →
  // FAILS, since the mock above only answers for requireAccountOwner.)
  it("checks the owner guard, for THIS account, before touching the database — a Staff caller never reaches listContacts", async () => {
    const denied = new Error("NEXT_REDIRECT"); // stand-in for requireAccountOwner's real redirect() throw
    access.mockRejectedValueOnce(denied);
    await expect(GET(req(), ctx())).rejects.toBe(denied);
    expect(access).toHaveBeenCalledWith("a1");
    expect(listContacts).not.toHaveBeenCalled();
  });

  it("passes q, sort and dir straight through — 'export what I'm looking at'", async () => {
    listContacts.mockResolvedValueOnce([]);
    await GET(req("?q=rosa&sort=company&dir=asc"), ctx());
    expect(listContacts).toHaveBeenCalledWith({}, "a1",
      { search: "rosa", limit: 500, before: undefined, sort: { key: "company", dir: "asc" }, archived: "exclude" });
  });

  // Contact archive (spec §4.1, plan Task 10): Export exports the view it was opened from. The list's
  // Export leaves archived contacts out, like the screen; the Archived view's exports only them.
  it("?view=archived exports only archived contacts; no view, or any other word, leaves them out (mutation: drop the view -> FAILS)", async () => {
    listContacts.mockResolvedValue([]);
    await GET(req("?view=archived&sort=name&dir=asc"), ctx());
    expect(listContacts).toHaveBeenLastCalledWith({}, "a1",
      { search: undefined, limit: 500, before: undefined, sort: { key: "name", dir: "asc" }, archived: "only" });
    await GET(req("?view=Archived"), ctx());
    expect(listContacts.mock.calls.at(-1)![2]).toMatchObject({ archived: "exclude" });
    await GET(req(), ctx());
    expect(listContacts.mock.calls.at(-1)![2]).toMatchObject({ archived: "exclude" });
  });

  it("falls back to the list page's own default (created, desc) for a missing or invalid sort/dir", async () => {
    listContacts.mockResolvedValueOnce([]);
    await GET(req("?sort=bogus&dir=sideways"), ctx());
    expect(listContacts).toHaveBeenCalledWith({}, "a1",
      { search: undefined, limit: 500, before: undefined, sort: { key: "created", dir: "desc" }, archived: "exclude" });
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

  it("D-008: fills the tags column from the bulk tag read, per row", async () => {
    listContacts.mockResolvedValueOnce([
      { id: "c1", first_name: "Ana", last_name: null, email: null, phone: null,
        company_name: null, source: null, sort_name: "ana", created_at: "2026-01-01T00:00:00Z" },
      { id: "c2", first_name: "Bo", last_name: null, email: null, phone: null,
        company_name: null, source: null, sort_name: "bo", created_at: "2026-01-01T00:00:00Z" },
    ]);
    listTagNamesForContacts.mockResolvedValueOnce(new Map([["c1", "urgent,vip"]]));
    const res = await GET(req(), ctx());
    expect(await text(res)).toBe(
      "first_name,last_name,email,phone,company_name,source,tags\n"
      + "Ana,,,,,,\"urgent,vip\"\nBo,,,,,,");
  });

  it("D-008: reads tags for exactly this chunk's ids, in one batched call", async () => {
    listContacts.mockResolvedValueOnce([{
      id: "c1", first_name: "Ana", last_name: null, email: null, phone: null,
      company_name: null, source: null, sort_name: "ana", created_at: "2026-01-01T00:00:00Z",
    }]);
    await GET(req(), ctx());
    expect(listTagNamesForContacts).toHaveBeenCalledTimes(1);
    expect(listTagNamesForContacts).toHaveBeenCalledWith({}, "a1", ["c1"]);
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

      // Drain the stream BEFORE inspecting the mocks: the chunk loop now
      // awaits `listTagNamesForContacts` too (D-008), one more suspension
      // point per chunk than `await GET(...)` alone resolves past — reading
      // the body is what actually runs the loop to completion, same as the
      // real client downloading the file.
      const body = await text(res);

      expect(listContacts).toHaveBeenCalledTimes(2);
      expect(listContacts).toHaveBeenNthCalledWith(2, {}, "a1", {
        search: undefined, limit: 500,
        before: { v: last1[cursorField], id: last1.id },
        sort: { key: sortKey, dir: "desc" }, archived: "exclude",
      });

      // The property that actually matters: the ASSEMBLED FILE has every
      // row exactly once across the chunk boundary. Asserting only the
      // second call's arguments (as this test used to) can't tell a
      // complete export from a truncated one — a chunk-loop bug that stops
      // after the first page would still produce those very same arguments
      // right before it stops.
      const rows = dataLines(body);
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

/**
 * F-118 part 1 (plan Task 7; spec 4.1): the export route logs the download before the first byte
 * leaves, counted on the export's own filters, and answers a plain-text 409 — never a redirect — when
 * the agency's visit has ended. A Link's prefetch or RSC fetch must neither read nor log.
 */
describe("contacts CSV export route: the access log (F-118 part 1)", () => {
  it.each([
    ["rsc", { rsc: "1" }],
    ["next-router-prefetch", { "next-router-prefetch": "1" }],
  ])("a %s request answers 204 with an empty body; none of the guard, the gate, the count, the note or listContacts runs (mutation: drop the check -> FAILS)", async (_l, headers) => {
    const res = await GET(req("", headers), ctx());
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(agencyVisitMissing).not.toHaveBeenCalled();
    expect(access).not.toHaveBeenCalled();
    expect(countContacts).not.toHaveBeenCalled();
    expect(noteOpenedApi).not.toHaveBeenCalled();
    expect(listContacts).not.toHaveBeenCalled();
  });

  it("review m5: an agency visit that has ended answers 409 plain text, no Content-Disposition, before requireAccountOwner can redirect (mutation: drop the check -> FAILS)", async () => {
    agencyVisitMissing.mockResolvedValue(true);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(409);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Disposition")).toBeNull();
    expect(await res.text()).toBe(m["accessLog.exportEnded"]);
    expect(access).not.toHaveBeenCalled();
    expect(listContacts).not.toHaveBeenCalled();
  });

  it("counts with the SAME search and archived filters the stream's listContacts gets (mutation: drop search -> FAILS)", async () => {
    listContacts.mockResolvedValueOnce([]);
    await GET(req("?q=rosa&view=archived"), ctx());
    expect(countContacts).toHaveBeenCalledWith({}, "a1", { search: "rosa", archived: "only" });
    expect(listContacts).toHaveBeenCalledWith({}, "a1", expect.objectContaining({ search: "rosa", archived: "only" }));
  });

  it("noteOpenedApi runs with the count BEFORE the first listContacts (mutation: log after the first chunk -> FAILS)", async () => {
    countContacts.mockResolvedValue(7);
    listContacts.mockResolvedValueOnce([]);
    const res = await GET(req(), ctx());
    await text(res);
    expect(noteOpenedApi).toHaveBeenCalledWith({ userId: "u1", isAgency: true }, "a1", { kind: "customer_list_export", itemCount: 7 });
    expect(noteOpenedApi.mock.invocationCallOrder[0]!).toBeLessThan(listContacts.mock.invocationCallOrder[0]!);
  });

  it("spec 4.3: a client's export issues no count and no note, and still streams the file (mutation: count unconditionally -> FAILS)", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: false });
    listContacts.mockResolvedValueOnce([]);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    await text(res);
    expect(countContacts).not.toHaveBeenCalled();
    expect(noteOpenedApi).not.toHaveBeenCalled();
    expect(listContacts).toHaveBeenCalledTimes(1);
  });

  it("noteOpenedApi -> false (the visit ended in between) answers the same 409, and listContacts never runs (mutation: ignore the answer -> FAILS)", async () => {
    noteOpenedApi.mockResolvedValue(false);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(409);
    expect(await res.text()).toBe(m["accessLog.exportEnded"]);
    expect(listContacts).not.toHaveBeenCalled();
  });

  it("a rejected note rejects the GET, and listContacts never runs (mutation: swallow it -> FAILS)", async () => {
    const boom = new Error("write failed");
    noteOpenedApi.mockRejectedValue(boom);
    await expect(GET(req(), ctx())).rejects.toBe(boom);
    expect(listContacts).not.toHaveBeenCalled();
  });
});
