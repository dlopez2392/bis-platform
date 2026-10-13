import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ apiAccountAccess: access }));
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
const readGroup = vi.hoisted(() => vi.fn());
const listGroupPlaces = vi.hoisted(() => vi.fn());
const serviceDb = vi.hoisted(() => vi.fn(() => { throw new Error("serviceDb must never be called here"); }));
vi.mock("@bis/db", () => ({ readGroup, listGroupPlaces, serviceDb }));
vi.mock("@/lib/zone", () => ({ renderZone: async (z?: string) => ({ zone: z ?? "UTC", guessed: !z, label: z ?? "UTC" }) }));

import { GET } from "./route";
import { placesLoadFrom } from "@/lib/contacts/places-load";

const A = "44444444-4444-4444-8444-444444444444";
const GR = "55555555-5555-4555-8555-555555555555";
const P = "66666666-6666-4666-8666-666666666666";
const U = "77777777-7777-4777-8777-777777777777";
const T = "2026-10-01T12:00:00.000Z";
const params = (groupId = GR) => ({ params: Promise.resolve({ accountId: A, groupId }) });
const PLACE = {
  id: P, account_id: A, contact_id: null, client_group_id: GR, label: "Casa", address: "1204 Nolana Ave",
  landmark: null, directions: null, city: null, region: null, postal_code: null, country: null,
  archived_at: null, created_by: "user_2abcSECRETsub", created_at: T, updated_at: T,
};
const UNIT = {
  id: U, account_id: A, place_id: P, name: "AC upstairs", make: null, model: null, serial: null, notes: null,
  installed_on: "2020-05-01", warranty_until: null, replaces_id: null, created_by: "user_2abcSECRETsub", created_at: T, updated_at: T,
};
const GROUP = { id: GR, kind: "household", name: "Familia García", billingAddress: "1 Main St" };
const noAuthor = (row: Record<string, unknown>) => { const copy = { ...row }; delete copy.created_by; return copy; };

beforeEach(() => {
  access.mockReset().mockResolvedValue({ userId: "u", isAgency: false, role: "owner", canManage: true });
  readGroup.mockReset().mockResolvedValue(GROUP);
  listGroupPlaces.mockReset().mockResolvedValue({ groups: [], places: [PLACE], placeCount: 1, equipment: [UNIT], equipmentCount: 1 });
  accountRead.mockReset().mockResolvedValue({ data: { timezone: "America/Chicago" }, error: null });
  accountFilters.length = 0;
  serviceDb.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {}).mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe("GET …/groups/[groupId]/places (S-03 part 2, C12: the group's own Properties read)", () => {
  it("answers the group as the subject, its own places and equipment with real counts, read on the request client", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T15:00:00Z"));
    const res = await GET(new Request("https://x.test"), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      subject: { id: GR, firstName: null, lastName: null },
      // The id, kind and name only: the billing address is the Details card's, not this read's.
      group: { id: GR, kind: "household", name: "Familia García" },
      today: "2026-10-12",
      groups: [],
      places: [noAuthor(PLACE)],
      placeCount: 1,
      equipment: [noAuthor(UNIT)],
      equipmentCount: 1,
    });
    expect(readGroup).toHaveBeenCalledWith(client, A, GR);
    expect(listGroupPlaces).toHaveBeenCalledWith(client, A, GR);
    expect(accountFilters).toEqual([["accounts.id", A]]);
    expect(serviceDb).not.toHaveBeenCalled();
  });

  it("the card's own parser takes the body as ready (the two halves agree on the shape)", async () => {
    const load = await placesLoadFrom(await GET(new Request("https://x.test"), params()));
    expect(load.status).toBe("ready");
  });

  it("404s with no access, reading nothing", async () => {
    access.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://x.test"), params())).status).toBe(404);
    expect(readGroup).not.toHaveBeenCalled();
    expect(listGroupPlaces).not.toHaveBeenCalled();
  });

  it("a group id that is not an id is a 404, read nowhere; an uppercase one is read lowercase", async () => {
    expect((await GET(new Request("https://x.test"), params("not-a-uuid"))).status).toBe(404);
    expect(readGroup).not.toHaveBeenCalled();
    const LETTERED = "abcdef12-1111-4111-8111-11111111111a";
    readGroup.mockResolvedValueOnce({ ...GROUP, id: LETTERED });
    const body = await (await GET(new Request("https://x.test"), params(LETTERED.toUpperCase()))).json();
    expect(readGroup).toHaveBeenCalledWith(client, A, LETTERED);
    expect(listGroupPlaces).toHaveBeenCalledWith(client, A, LETTERED);
    expect(body.subject.id).toBe(LETTERED);
  });

  it("a group the request client cannot see is a 404 and its places are never read (mutation: read the places before the group -> FAILS)", async () => {
    readGroup.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://x.test"), params())).status).toBe(404);
    expect(listGroupPlaces).not.toHaveBeenCalled();
    expect(accountRead).not.toHaveBeenCalled();
  });

  it("never sends created_by to the browser (mutation: send the rows as read -> FAILS)", async () => {
    const text = await (await GET(new Request("https://x.test"), params())).text();
    expect(text).not.toContain("created_by");
    expect(text).not.toContain("SECRETsub");
  });

  it("an unreadable places read is a 500, logged with the ids only (mutation: let it throw -> FAILS)", async () => {
    listGroupPlaces.mockRejectedValueOnce(Object.assign(new Error("listGroupPlaces places read failed"), { code: "PGRST301" }));
    const res = await GET(new Request("https://x.test"), params());
    expect(res.status).toBe(500);
    const logged = String(vi.mocked(console.error).mock.calls[0]?.[0]);
    expect(logged).toContain("group places read");
    expect(logged).toContain(A);
    expect(logged).toContain(GR);
    expect(logged).not.toContain("García");
  });

  it("an unreadable group read is a 500 too, never a 404 that would read as 'not yours' (mutation: catch only the places read -> FAILS)", async () => {
    readGroup.mockRejectedValueOnce(new Error("readGroup failed: boom"));
    expect((await GET(new Request("https://x.test"), params())).status).toBe(500);
    expect(listGroupPlaces).not.toHaveBeenCalled();
  });
});
