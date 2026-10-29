import { describe, it, expect, vi, beforeEach } from "vitest";

const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ apiAccountAccess: access }));
const noteOpenedApi = vi.hoisted(() => vi.fn());
vi.mock("@/lib/access-log/note", () => ({ noteOpenedApi }));
const client = vi.hoisted(() => ({ tag: "request-db" }));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => client }));
const getContact = vi.hoisted(() => vi.fn());
const listContactRelationships = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", () => ({ getContact, listContactRelationships }));

import { GET } from "./route";

const S = "11111111-1111-4111-8111-111111111111";
const HIDDEN = "22222222-2222-4222-8222-222222222222";
const params = { params: Promise.resolve({ accountId: "a1", contactId: S }) };
const ROW = {
  id: "33333333-3333-4333-8333-333333333333", account_id: "a1", contact_id: HIDDEN, related_contact_id: S, label_key: "parent",
  custom_label: null, contact_form: "f", related_form: null, contact_can_pick_up: true, contact_is_emergency: false,
  related_can_pick_up: false, related_is_emergency: false, created_at: "2026-10-11T00:00:00Z", updated_at: "2026-10-11T00:00:00Z",
};

beforeEach(() => {
  access.mockReset().mockResolvedValue({ userId: "u", isAgency: false });
  noteOpenedApi.mockReset().mockResolvedValue(true);
  getContact.mockReset().mockResolvedValue({ id: S, first_name: "Sofía", last_name: "Ramírez" });
  listContactRelationships.mockReset().mockResolvedValue({ rows: [ROW], people: [] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET …/relationships (spec §6: the card's own read)", () => {
  it("answers the subject and the views, read on the request's own client", async () => {
    const res = await GET(new Request("https://x.test"), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subject).toEqual({ firstName: "Sofía", lastName: "Ramírez" });
    expect(body.views).toHaveLength(1);
    expect(listContactRelationships).toHaveBeenCalledWith(client, "a1", S);
  });
  it("a person the caller cannot read reaches the browser with no name and no id (C5; mutation: send the raw rows -> FAILS)", async () => {
    const res = await GET(new Request("https://x.test"), params);
    const text = await res.text();
    expect(text).not.toContain(HIDDEN);
    expect(JSON.parse(text).views[0].person).toBeNull();
  });
  it("a record id in another case still finds its relationships (PostgREST echoes ids lowercase; mutation: skip the lowercase -> FAILS)", async () => {
    // An id with hex LETTERS: S is all digits, so S.toUpperCase() === S and could not tell cases apart.
    const LETTERED = "abcdef12-1111-4111-8111-11111111111a";
    listContactRelationships.mockResolvedValueOnce({ rows: [{ ...ROW, related_contact_id: LETTERED }], people: [] });
    const upper = { params: Promise.resolve({ accountId: "a1", contactId: LETTERED.toUpperCase() }) };
    const body = await (await GET(new Request("https://x.test"), upper)).json();
    expect(body.views).toHaveLength(1);
    expect(body.views[0].namedSide).toBe("a");
  });
  it("404 without access or for a contact the caller cannot see, reading nothing else (mutation: skip the contact read -> FAILS)", async () => {
    getContact.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://x.test"), params)).status).toBe(404);
    expect(listContactRelationships).not.toHaveBeenCalled();
    access.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://x.test"), params)).status).toBe(404);
  });
  it("a contact id that is not an id is a 404, read nowhere", async () => {
    const bad = { params: Promise.resolve({ accountId: "a1", contactId: "not-a-uuid" }) };
    expect((await GET(new Request("https://x.test"), bad)).status).toBe(404);
    expect(getContact).not.toHaveBeenCalled();
  });
  it("a failed read is a 500 the card shows as its error state", async () => {
    listContactRelationships.mockRejectedValueOnce(new Error("boom"));
    expect((await GET(new Request("https://x.test"), params)).status).toBe(500);
  });
});

describe("F-118 part 1 (plan Task 6): BIS's open of this card is logged", () => {
  beforeEach(() => { access.mockResolvedValue({ userId: "u", isAgency: true }); });
  it("logged after the proof, with the same access object (mutation: hard-code { isAgency: false } -> FAILS)", async () => {
    await GET(new Request("https://x.test"), params);
    expect(noteOpenedApi).toHaveBeenCalledTimes(1);
    expect(noteOpenedApi).toHaveBeenCalledWith({ userId: "u", isAgency: true }, "a1", { kind: "contact", recordId: S });
  });
  it("a 404 logs nothing (mutation: move the call above the proof -> FAILS)", async () => {
    getContact.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://x.test"), params)).status).toBe(404);
    expect(noteOpenedApi).not.toHaveBeenCalled();
  });
  it("no live visit: 404, and the first data read never ran (mutation: ignore the false -> FAILS)", async () => {
    noteOpenedApi.mockResolvedValueOnce(false);
    const res = await GET(new Request("https://x.test"), params);
    expect(res.status).toBe(404);
    expect(listContactRelationships).not.toHaveBeenCalled();
  });
  it("the write rejects: a status >= 500, and the first data read never ran (mutation: try/catch around the call -> FAILS)", async () => {
    noteOpenedApi.mockRejectedValueOnce(new Error("db down"));
    const status = await GET(new Request("https://x.test"), params).then((r) => r.status, () => 500);
    expect(status).toBeGreaterThanOrEqual(500);
    expect(listContactRelationships).not.toHaveBeenCalled();
  });
});
