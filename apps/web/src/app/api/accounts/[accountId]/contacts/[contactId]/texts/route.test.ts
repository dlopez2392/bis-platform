import { describe, it, expect, vi, beforeEach } from "vitest";

const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ apiAccountAccess: access }));
const maybeSingle = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ dbForRequest: async () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) }) }));
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
  it("answers the view, the account's zone and the stored phone, read under the request's own client (mutation: drop the zone → FAILS)", async () => {
    const res = await GET(new Request("https://x.test"), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ view: { kind: "allowed", newestId: null }, zone: "America/Chicago", phone: "+19562921696" });
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
});
