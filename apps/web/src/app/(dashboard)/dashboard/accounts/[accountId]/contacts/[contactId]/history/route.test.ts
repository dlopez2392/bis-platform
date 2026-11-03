import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * F-115 part 1 (S-04), plan Task 8: the Owner-only history download for one contact. `@bis/db` is
 * mocked bare, as `contacts/export/route.ts`'s own GET test does; the route's guard sequence mirrors
 * that same file's lines 91-114 (prefetch 204, agency-visit-ended 409, then `requireAccountOwner`).
 *
 * `requireAccountOwner` REDIRECTS a Staff/Technician caller (its own doc comment, `lib/auth.ts:96-103`
 * — never a literal 403), the same behaviour the export route's own GET test asserts against
 * (`route.get.test.ts`'s "checks the owner guard" case) — this file follows the SOURCE over the task
 * brief's "403" shorthand for that reason.
 */
const access = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAccountOwner: (...a: unknown[]) => access(...a) }));

const agencyVisitMissing = vi.fn(async (..._a: unknown[]) => false);
vi.mock("@/lib/access-log/gate", () => ({ agencyVisitMissing: (...a: unknown[]) => agencyVisitMissing(...a) }));
const noteOpenedApi = vi.fn(async (..._a: unknown[]) => true);
vi.mock("@/lib/access-log/note", () => ({ noteOpenedApi: (...a: unknown[]) => noteOpenedApi(...a) }));

let personLanguage: "en" | "es" | null = null;
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: personLanguage, theme: null }) }));
vi.mock("@/lib/zone", () => ({
  renderZone: async (z?: string) => ({ zone: z ?? "UTC", guessed: !z, label: z ?? "UTC", source: z ? "account" : "fallback" }),
}));

const C1 = "11111111-1111-4111-8111-111111111111";
const OTHER1 = "22222222-2222-4222-8222-222222222222";
const OTHER2 = "33333333-3333-4333-8333-333333333333";
const CONTACT_ROW = { id: C1, account_id: "a1", first_name: "Maria", last_name: "Garcia" };
let accountRow: { language: "en" | "es" | null; timezone: string | null } = { language: null, timezone: null };
let accountError: { message: string } | null = null;
let nameRows: unknown[] = [CONTACT_ROW];
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from: (table: string) => {
      if (table === "accounts") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: accountRow, error: accountError }) }) }) };
      }
      if (table === "contacts") {
        return { select: () => ({ in: async () => ({ data: nameRows, error: null }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

const getContact = vi.fn();
const mergedIdsOf = vi.fn();
const listPeopleNames = vi.fn();
const getVoiceProfile = vi.fn();
vi.mock("@bis/db", () => ({
  getContact: (...a: unknown[]) => getContact(...a),
  mergedIdsOf: (...a: unknown[]) => mergedIdsOf(...a),
  listPeopleNames: (...a: unknown[]) => listPeopleNames(...a),
  getVoiceProfile: (...a: unknown[]) => getVoiceProfile(...a),
}));

const fetchBoundedChangeRows = vi.fn();
const prefetchGuard = vi.fn((_req: Request) => null as Response | null);
const visitEndedResponse = vi.fn(() => new Response("ended", { status: 409 }));
const tooBigResponse = vi.fn((_locale: string) => new Response("too-big", { status: 413 }));
const readFailedResponse = vi.fn((_locale: string) => new Response("read-failed", { status: 500 }));
vi.mock("@/lib/record/history-download", () => ({
  fetchBoundedChangeRows: (...a: unknown[]) => fetchBoundedChangeRows(...a),
  prefetchGuard: (...a: Parameters<typeof prefetchGuard>) => prefetchGuard(...a),
  visitEndedResponse: () => visitEndedResponse(),
  tooBigResponse: (...a: Parameters<typeof tooBigResponse>) => tooBigResponse(...a),
  readFailedResponse: (...a: Parameters<typeof readFailedResponse>) => readFailedResponse(...a),
}));

const { GET } = await import("./route");
const { m } = await import("@/lib/messages");

function req(headers: Record<string, string> = {}): Request {
  return new Request(`http://x/dashboard/accounts/a1/contacts/${C1}/history`, { headers });
}
function ctx() {
  return { params: Promise.resolve({ accountId: "a1", contactId: C1 }) };
}

beforeEach(() => {
  access.mockReset().mockResolvedValue({ userId: "u1", isAgency: false });
  agencyVisitMissing.mockReset().mockResolvedValue(false);
  noteOpenedApi.mockReset().mockResolvedValue(true);
  getContact.mockReset().mockResolvedValue(CONTACT_ROW);
  mergedIdsOf.mockReset().mockResolvedValue([]);
  listPeopleNames.mockReset().mockResolvedValue({});
  getVoiceProfile.mockReset().mockResolvedValue(null);
  fetchBoundedChangeRows.mockReset().mockResolvedValue({ rows: [] });
  prefetchGuard.mockReset().mockReturnValue(null);
  visitEndedResponse.mockClear();
  tooBigResponse.mockClear();
  readFailedResponse.mockClear();
  personLanguage = null;
  accountRow = { language: null, timezone: null };
  accountError = null;
  nameRows = [CONTACT_ROW];
});

describe("contact history route (GET)", () => {
  it("an Owner gets 200, text/csv, and a filename naming the contact", async () => {
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="history-maria-garcia-\d{4}-\d{2}-\d{2}\.csv"$/);
  });

  // Staff and roles: this route is Owner-only, so it is requireAccountOwner (never
  // requireAccountAccess), and that guard REDIRECTS a non-Owner, it never answers 403 (lib/auth.ts's
  // own doc comment) — the export route's own GET test asserts the identical shape.
  it("a Staff caller never reaches a read: requireAccountOwner's redirect propagates before getContact runs", async () => {
    const denied = new Error("NEXT_REDIRECT");
    access.mockRejectedValueOnce(denied);
    await expect(GET(req(), ctx())).rejects.toBe(denied);
    expect(access).toHaveBeenCalledWith("a1");
    expect(getContact).not.toHaveBeenCalled();
  });

  it("a Technician caller is refused the same way, before getContact runs (mutation: let a Technician through -> FAILS)", async () => {
    const denied = new Error("NEXT_REDIRECT");
    access.mockRejectedValueOnce(denied);
    await expect(GET(req(), ctx())).rejects.toBe(denied);
    expect(getContact).not.toHaveBeenCalled();
  });

  it("an agency reader's download notes the open exactly once, with the contact's id (mutation: drop the note -> FAILS)", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    await GET(req(), ctx());
    expect(noteOpenedApi).toHaveBeenCalledTimes(1);
    expect(noteOpenedApi).toHaveBeenCalledWith(
      { userId: "u1", isAgency: true }, "a1", { kind: "record_history_export", recordId: C1 });
  });

  it("a client Owner's download notes nothing (spec: only the agency pays for the log)", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: false });
    await GET(req(), ctx());
    expect(noteOpenedApi).not.toHaveBeenCalled();
  });

  it("a Spanish reader's CSV body starts with the Spanish header (mutation: hard-code the English header -> FAILS)", async () => {
    personLanguage = "es";
    const res = await GET(req(), ctx());
    const body = await res.text();
    expect(body.replace(/^﻿/, "").split("\n")[0]).toBe("Cuándo,Quién,Tipo,Registro,Campo,Antes,Después,Causa");
  });

  it("past the cap, answers the shared 413 in the reader's locale and never calls noteOpenedApi (mutation: ignore tooBig -> FAILS)", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    fetchBoundedChangeRows.mockResolvedValue({ tooBig: true });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(413);
    expect(tooBigResponse).toHaveBeenCalledWith("en");
    expect(noteOpenedApi).not.toHaveBeenCalled();
  });

  it("a nonexistent contact is a 404, before any history read (mutation: skip the existence check -> FAILS)", async () => {
    getContact.mockResolvedValue(null);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
    expect(fetchBoundedChangeRows).not.toHaveBeenCalled();
  });

  it.each([
    ["rsc", { rsc: "1" }],
    ["next-router-prefetch", { "next-router-prefetch": "1" }],
  ])("a %s request answers whatever prefetchGuard says, before the owner guard runs", async (_label, headers) => {
    prefetchGuard.mockReturnValueOnce(new Response(null, { status: 204 }));
    const res = await GET(req(headers), ctx());
    expect(res.status).toBe(204);
    expect(access).not.toHaveBeenCalled();
  });

  it("an ended agency visit answers visitEndedResponse before the owner guard runs", async () => {
    agencyVisitMissing.mockResolvedValueOnce(true);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(409);
    expect(access).not.toHaveBeenCalled();
  });

  it("includes the merge's tombstones in the scope read (mutation: pass only [contactId] -> FAILS)", async () => {
    mergedIdsOf.mockResolvedValue([OTHER1, OTHER2]);
    await GET(req(), ctx());
    expect(fetchBoundedChangeRows).toHaveBeenCalledWith(
      expect.anything(), "a1", { contactIds: [C1, OTHER1, OTHER2] });
  });

  it("the English fallback copy mentions the limit", () => {
    expect(m["history.download.tooBig"]).toContain("too long");
  });

  // F-115 PR C fix (review m4).
  it("an error reading the account row fails loudly, never silently proceeding with an undefined account (mutation: drop the accounts error check -> FAILS)", async () => {
    accountError = { message: "connection reset" };
    const res = await GET(req(), ctx());
    expect(res.status).toBe(500);
    expect(fetchBoundedChangeRows).not.toHaveBeenCalled();
  });

  it("a failed mergedIdsOf read fails the download loudly (500), logged, rather than silently dropping merged rows (mutation: .catch(() => []) swallows it -> FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mergedIdsOf.mockRejectedValueOnce(new Error("merge lookup boom"));
    const res = await GET(req(), ctx());
    expect(res.status).toBe(500);
    expect(fetchBoundedChangeRows).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
