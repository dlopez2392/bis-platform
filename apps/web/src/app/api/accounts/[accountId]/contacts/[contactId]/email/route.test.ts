import { describe, it, expect, vi, beforeEach } from "vitest";

const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ apiAccountAccess: access }));
const maybeSingle = vi.hoisted(() => vi.fn());
const client = vi.hoisted(() => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) }));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => client }));
const getContact = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), getContact }));
const readEmailView = vi.hoisted(() => vi.fn());
vi.mock("@/lib/consent/email-view", () => ({ readEmailView }));
/** F-085 (spec §7.3): the ledger client the view read takes AFTER getContact
 *  proved the contact — a stable sentinel, told apart from `client` by identity. */
const LEDGER = vi.hoisted(() => ({ tag: "ledger-db" }));
const ledgerDb = vi.hoisted(() => vi.fn(() => LEDGER));
vi.mock("@/lib/consent/ledger-db", () => ({ ledgerDb }));
vi.mock("@/lib/zone", () => ({ renderZone: async (z?: string) => ({ zone: z ?? "UTC", guessed: !z, label: z ?? "UTC" }) }));

import { GET } from "./route";

const params = { params: Promise.resolve({ accountId: "a1", contactId: "c1" }) };

beforeEach(() => {
  access.mockReset().mockResolvedValue({ userId: "u", isAgency: false });
  getContact.mockReset().mockResolvedValue({ id: "c1", email: "Ana@Example.com" });
  readEmailView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
  ledgerDb.mockClear();
  maybeSingle.mockReset().mockResolvedValue({ data: { timezone: "America/Chicago" }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET …/email — the Email row's own read (spec §6: its own loading and error)", () => {
  it("answers the view and the account's zone; the contact is read under the request's own RLS client and the ledger under the ledger client (mutation: read the contact under serviceDb → FAILS)", async () => {
    const res = await GET(new Request("https://x.test"), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ view: { kind: "allowed", newestId: null }, zone: "America/Chicago" });
    expect(getContact).toHaveBeenCalledWith(client, "a1", "c1");
    expect(readEmailView).toHaveBeenCalledWith(LEDGER, "a1", { id: "c1", email: "Ana@Example.com" });
  });

  it("the Email view reads the ledger through the ledger client, built only AFTER getContact found the contact (F-085, spec §7.3; mutation: pass db to readEmailView → FAILS)", async () => {
    await GET(new Request("https://x.test"), params);
    expect(readEmailView.mock.calls[0]![0]).toBe(LEDGER);
    expect(readEmailView.mock.calls[0]![0]).not.toBe(client);
    expect(ledgerDb.mock.invocationCallOrder[0]!).toBeGreaterThan(getContact.mock.invocationCallOrder[0]!);
  });

  it("a contact the caller cannot see answers 404 and reads nothing: no ledger client, no view (F-085; mutation: build the ledger client before the contact check → FAILS)", async () => {
    getContact.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://x.test"), params)).status).toBe(404);
    expect(ledgerDb).not.toHaveBeenCalled();
    expect(readEmailView).not.toHaveBeenCalled();
  });

  it("404 without access and for another account's contact; 500 on an unreadable ledger, never a guessed Allowed (fails closed; mutation: answer allowed in the catch → FAILS)", async () => {
    access.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://x.test"), params)).status).toBe(404);
    getContact.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://x.test"), params)).status).toBe(404);
    readEmailView.mockRejectedValueOnce(new Error("down"));
    expect((await GET(new Request("https://x.test"), params)).status).toBe(500);
  });
});
