import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * F-115 part 1 (S-04), plan Task 8: the Owner-only history download for one household/business.
 * Same guard sequence and shape as the contact history route's own test — see that file's header
 * comment for why "Staff/Technician gets 403" is tested as `requireAccountOwner`'s real redirect
 * rather than a literal 403 response.
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

let accountRow: { language: "en" | "es" | null; timezone: string | null } = { language: null, timezone: null };
let accountError: { message: string } | null = null;
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from: (table: string) => {
      if (table === "accounts") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: accountRow, error: accountError }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

const readGroup = vi.fn();
const listPeopleNames = vi.fn();
const getVoiceProfile = vi.fn();
vi.mock("@bis/db", () => ({
  readGroup: (...a: unknown[]) => readGroup(...a),
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

const G1 = "44444444-4444-4444-8444-444444444444";
const GROUP_ROW = { id: G1, kind: "household" as const, name: "The García Household", billingAddress: null };

function req(headers: Record<string, string> = {}): Request {
  return new Request(`http://x/dashboard/accounts/a1/groups/${G1}/history`, { headers });
}
function ctx() {
  return { params: Promise.resolve({ accountId: "a1", groupId: G1 }) };
}

beforeEach(() => {
  access.mockReset().mockResolvedValue({ userId: "u1", isAgency: false });
  agencyVisitMissing.mockReset().mockResolvedValue(false);
  noteOpenedApi.mockReset().mockResolvedValue(true);
  readGroup.mockReset().mockResolvedValue(GROUP_ROW);
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
});

describe("group history route (GET)", () => {
  it("an Owner gets 200, text/csv, and a filename naming the group", async () => {
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="history-the-garcia-household-\d{4}-\d{2}-\d{2}\.csv"$/);
  });

  it("a Staff caller never reaches a read: requireAccountOwner's redirect propagates before readGroup runs", async () => {
    const denied = new Error("NEXT_REDIRECT");
    access.mockRejectedValueOnce(denied);
    await expect(GET(req(), ctx())).rejects.toBe(denied);
    expect(access).toHaveBeenCalledWith("a1");
    expect(readGroup).not.toHaveBeenCalled();
  });

  it("a Technician caller is refused the same way, before readGroup runs (mutation: let a Technician through -> FAILS)", async () => {
    const denied = new Error("NEXT_REDIRECT");
    access.mockRejectedValueOnce(denied);
    await expect(GET(req(), ctx())).rejects.toBe(denied);
    expect(readGroup).not.toHaveBeenCalled();
  });

  it("an agency reader's download notes the open exactly once, with the group's id (mutation: drop the note -> FAILS)", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    await GET(req(), ctx());
    expect(noteOpenedApi).toHaveBeenCalledTimes(1);
    expect(noteOpenedApi).toHaveBeenCalledWith(
      { userId: "u1", isAgency: true }, "a1", { kind: "record_history_export", recordId: G1 });
  });

  it("a client Owner's download notes nothing", async () => {
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

  it("a nonexistent group is a 404, before any history read (mutation: skip the existence check -> FAILS)", async () => {
    readGroup.mockResolvedValue(null);
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

  it("scopes the history read by groupId, not contactIds (mutation: pass contactIds -> FAILS)", async () => {
    await GET(req(), ctx());
    expect(fetchBoundedChangeRows).toHaveBeenCalledWith(expect.anything(), "a1", { groupId: G1 });
  });

  it("the English fallback copy mentions the limit", () => {
    expect(m["history.download.tooBig"]).toContain("too long");
  });

  // F-115 PR C fix (review m4), mirrored for the group route's own accounts read.
  it("an error reading the account row fails loudly, never silently proceeding with an undefined account (mutation: drop the accounts error check -> FAILS)", async () => {
    accountError = { message: "connection reset" };
    const res = await GET(req(), ctx());
    expect(res.status).toBe(500);
    expect(fetchBoundedChangeRows).not.toHaveBeenCalled();
  });
});
