import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ apiAccountAccess: access }));
const noteOpenedApi = vi.hoisted(() => vi.fn());
vi.mock("@/lib/access-log/note", () => ({ noteOpenedApi }));
const accountRead = vi.hoisted(() => vi.fn());
const accountFilters = vi.hoisted(() => [] as [string, unknown][]);
/** The request client: a sentinel by identity, which also answers the account's zone read. */
const client = vi.hoisted(() => ({
  tag: "request-db",
  from: (table: string) => {
    const b = {
      select: () => b,
      eq: (col: string, v: unknown) => { accountFilters.push([`${table}.${col}`, v]); return b; },
      maybeSingle: () => accountRead(),
    };
    return b;
  },
}));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => client }));
const getContact = vi.hoisted(() => vi.fn());
const listContactPlaces = vi.hoisted(() => vi.fn());
const serviceDb = vi.hoisted(() => vi.fn(() => { throw new Error("serviceDb must never be called here"); }));
vi.mock("@bis/db", () => ({ getContact, listContactPlaces, serviceDb }));
vi.mock("@/lib/zone", () => ({ renderZone: async (z?: string) => ({ zone: z ?? "UTC", guessed: !z, label: z ?? "UTC" }) }));

import { GET } from "./route";

const A = "44444444-4444-4444-8444-444444444444";
const S = "11111111-1111-4111-8111-111111111111";
const G = "55555555-5555-4555-8555-555555555555";
const P = "66666666-6666-4666-8666-666666666666";
const U = "77777777-7777-4777-8777-777777777777";
const T = "2026-10-01T12:00:00.000Z";
const params = (contactId = S) => ({ params: Promise.resolve({ accountId: A, contactId }) });
const PLACE = {
  id: P, account_id: A, contact_id: S, client_group_id: null, label: "Casa", address: "1204 Nolana Ave",
  landmark: null, directions: null, city: null, region: null, postal_code: null, country: null,
  archived_at: null, created_by: "user_2abcSECRETsub", created_at: T, updated_at: T,
};
const UNIT = {
  id: U, account_id: A, place_id: P, name: "AC upstairs", make: null, model: null, serial: null, notes: null,
  installed_on: "2020-05-01", warranty_until: "2027-05-01", replaces_id: null, created_by: "user_2abcSECRETsub", created_at: T, updated_at: T,
};
const GROUPS = [{ id: G, kind: "household", name: "Ramírez", isPrimary: true }];

beforeEach(() => {
  access.mockReset().mockResolvedValue({ userId: "u", isAgency: false, role: "owner", canManage: true });
  noteOpenedApi.mockReset().mockResolvedValue(true);
  getContact.mockReset().mockResolvedValue({ id: S, first_name: "Sofía", last_name: "Ramírez" });
  listContactPlaces.mockReset().mockResolvedValue({ groups: GROUPS, places: [PLACE], placeCount: 1, equipment: [UNIT], equipmentCount: 1 });
  accountRead.mockReset().mockResolvedValue({ data: { timezone: "America/Chicago" }, error: null });
  accountFilters.length = 0;
  serviceDb.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {}).mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe("GET …/places (spec §6: the card's own read)", () => {
  it("answers the record, its groups, places and equipment with real counts, read on the request client", async () => {
    const res = await GET(new Request("https://x.test"), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subject).toEqual({ id: S, firstName: "Sofía", lastName: "Ramírez" });
    expect(body.groups).toEqual(GROUPS);
    expect(body.placeCount).toBe(1);
    expect(body.equipmentCount).toBe(1);
    expect(body.places[0]).toMatchObject({ id: P, address: "1204 Nolana Ave" });
    expect(body.equipment[0]).toMatchObject({ id: U, name: "AC upstairs" });
    expect(getContact).toHaveBeenCalledWith(client, A, S);
    expect(listContactPlaces).toHaveBeenCalledWith(client, A, S);
    expect(accountFilters).toEqual([["accounts.id", A]]);
    expect(serviceDb).not.toHaveBeenCalled();
  });

  it("404s with no access, and 404s a contact the request client cannot see without reading its places (mutation: drop the getContact check -> FAILS)", async () => {
    getContact.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://x.test"), params())).status).toBe(404);
    expect(listContactPlaces).not.toHaveBeenCalled();
    expect(accountRead).not.toHaveBeenCalled();
    access.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://x.test"), params())).status).toBe(404);
    expect(listContactPlaces).not.toHaveBeenCalled();
  });

  it("a contact id that is not an id is a 404, read nowhere; an uppercase one is read lowercase", async () => {
    expect((await GET(new Request("https://x.test"), params("not-a-uuid"))).status).toBe(404);
    expect(getContact).not.toHaveBeenCalled();
    const LETTERED = "abcdef12-1111-4111-8111-11111111111a";
    getContact.mockResolvedValueOnce({ id: LETTERED, first_name: null, last_name: null });
    const body = await (await GET(new Request("https://x.test"), params(LETTERED.toUpperCase()))).json();
    expect(listContactPlaces).toHaveBeenCalledWith(client, A, LETTERED);
    expect(body.subject.id).toBe(LETTERED);
  });

  it("answers today in the ACCOUNT's zone (mutation: compute it in UTC -> FAILS)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T03:30:00Z"));
    const body = await (await GET(new Request("https://x.test"), params())).json();
    expect(body.today).toBe("2026-10-11");
  });

  it("an unreadable account zone is logged and today falls back to the resolved zone, never a failure", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T03:30:00Z"));
    accountRead.mockResolvedValueOnce({ data: null, error: { message: "boom", code: "XX000" } });
    const res = await GET(new Request("https://x.test"), params());
    expect(res.status).toBe(200);
    expect((await res.json()).today).toBe("2026-10-12"); // renderZone(undefined) resolves UTC in this stub
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain(A);
  });

  it("never sends created_by to the browser", async () => {
    const text = await (await GET(new Request("https://x.test"), params())).text();
    expect(text).not.toContain("created_by");
    expect(text).not.toContain("SECRETsub");
  });

  it("an unreadable places read is a 500 the card shows as its error, logged", async () => {
    listContactPlaces.mockRejectedValueOnce(Object.assign(new Error("places read failed"), { code: "PGRST301" }));
    const res = await GET(new Request("https://x.test"), params());
    expect(res.status).toBe(500);
    const logged = String(vi.mocked(console.error).mock.calls[0]?.[0]);
    expect(logged).toContain("places read");
    expect(logged).toContain(A);
  });
});

describe("F-118 part 1 (plan Task 6): BIS's open of this card is logged", () => {
  beforeEach(() => { access.mockResolvedValue({ userId: "u", isAgency: true, role: "owner", canManage: true }); });
  it("logged after the proof, with the same access object (mutation: hard-code { isAgency: false } -> FAILS)", async () => {
    await GET(new Request("https://x.test"), params());
    expect(noteOpenedApi).toHaveBeenCalledTimes(1);
    expect(noteOpenedApi).toHaveBeenCalledWith({ userId: "u", isAgency: true, role: "owner", canManage: true }, A, { kind: "contact", recordId: S });
  });
  it("a 404 logs nothing (mutation: move the call above the proof -> FAILS)", async () => {
    getContact.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://x.test"), params())).status).toBe(404);
    expect(noteOpenedApi).not.toHaveBeenCalled();
  });
  it("no live visit: 404, and the first data read never ran (mutation: ignore the false -> FAILS)", async () => {
    noteOpenedApi.mockResolvedValueOnce(false);
    const res = await GET(new Request("https://x.test"), params());
    expect(res.status).toBe(404);
    expect(listContactPlaces).not.toHaveBeenCalled();
  });
  it("the write rejects: a status >= 500, and the first data read never ran (mutation: try/catch around the call -> FAILS)", async () => {
    noteOpenedApi.mockRejectedValueOnce(new Error("db down"));
    const status = await GET(new Request("https://x.test"), params()).then((r) => r.status, () => 500);
    expect(status).toBeGreaterThanOrEqual(500);
    expect(listContactPlaces).not.toHaveBeenCalled();
  });
});
