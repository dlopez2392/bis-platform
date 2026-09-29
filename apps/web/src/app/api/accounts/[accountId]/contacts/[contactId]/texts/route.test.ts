import { describe, it, expect, vi, beforeEach } from "vitest";

const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ apiAccountAccess: access }));
const maybeSingle = vi.hoisted(() => vi.fn());
/** The request's own RLS client — a stable identity, so a test can prove
 *  getContact/readTextsView are read under THIS one, not serviceDb or some
 *  other client the route might reach for instead (review fix round 1, item 2). */
const client = vi.hoisted(() => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) }));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => client }));
const getContact = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), getContact }));
const readTextsView = vi.hoisted(() => vi.fn());
vi.mock("@/lib/consent/texts-view", () => ({ readTextsView }));
vi.mock("@/lib/zone", () => ({ renderZone: async (z?: string) => ({ zone: z ?? "UTC", guessed: !z, label: z ?? "UTC" }) }));

import { GET } from "./route";

const params = { params: Promise.resolve({ accountId: "a1", contactId: "c1" }) };

beforeEach(() => {
  access.mockReset().mockResolvedValue({ userId: "u", isAgency: false });
  getContact.mockReset().mockResolvedValue({ id: "c1", phone: "+19562921696", phone_country_unconfirmed: false });
  readTextsView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
  maybeSingle.mockReset().mockResolvedValue({ data: { timezone: "America/Chicago" }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET …/texts — the Texts row's own read (spec §6: its own loading and error)", () => {
  it("answers the view, the account's zone and the stored phone, read under the request's own client (mutation: drop the zone → FAILS; mutation: read under a different client → FAILS)", async () => {
    const res = await GET(new Request("https://x.test"), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ view: { kind: "allowed", newestId: null }, zone: "America/Chicago", phone: "+19562921696" });
    expect(getContact).toHaveBeenCalledWith(client, "a1", "c1");
    expect(readTextsView).toHaveBeenCalledWith(client, "a1", { id: "c1", phone: "+19562921696", phone_country_unconfirmed: false });
  });

  it("404 without access, and 404 for a contact that is not this account's (mutation: skip the contact read → FAILS)", async () => {
    access.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://x.test"), params)).status).toBe(404);
    getContact.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://x.test"), params)).status).toBe(404);
    expect(readTextsView).toHaveBeenCalledTimes(0);
  });

  it("an unreadable ledger is a 500 the row shows as its error line, never a guessed 'Allowed' (fails closed; mutation: answer allowed on error → FAILS)", async () => {
    readTextsView.mockRejectedValue(new Error("readConsentHistory failed: timeout"));
    expect((await GET(new Request("https://x.test"), params)).status).toBe(500);
  });

  it("a failed timezone read is logged but still answers 200 with the guessed-zone fallback, never a 500 over a non-fatal read (review fix round 1, item 3; mutation: swallow the error silently → FAILS)", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "relation timeout" } });
    // console.error's spy history is never cleared between tests in this
    // file (beforeEach re-spies but never .mockClear()s) — cleared here so
    // an earlier test's logged line can't make this assertion pass OR fail
    // for the wrong reason.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    errSpy.mockClear();
    const res = await GET(new Request("https://x.test"), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ view: { kind: "allowed", newestId: null }, zone: "UTC", phone: "+19562921696" });
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("timezone unreadable"));
  });
});
