import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * S-06 part 2 (owner ruling 2026-10-17, amending G15): the forwarding address is made on CLICK. The
 * action proves the caller (requireAccountAccess) and the customer (getContact on the REQUEST client,
 * so RLS answers null for one the caller may not see) before the one service write, ensureReplyToken,
 * scoped to the route's own ids.
 */
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const CONTACT = "22222222-2222-4222-8222-222222222222";
const TOKEN = "0123456789abcdef01234567";
const REQUEST = vi.hoisted(() => ({ tag: "request-db" }));
const SERVICE = vi.hoisted(() => ({ tag: "service-db" }));

const requireAccountAccess = vi.fn(async (_a: string) => ({ userId: "user_1", isAgency: false, role: "staff", canManage: false }));
vi.mock("@/lib/auth", () => ({ requireAccountAccess: (a: string) => requireAccountAccess(a) }));
const dbForRequest = vi.fn(async () => REQUEST);
vi.mock("@/lib/db", () => ({ dbForRequest: () => dbForRequest() }));
const getContact = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ id: CONTACT }));
const getInboundSettings = vi.fn(async (..._a: unknown[]): Promise<{ mode: "off" | "bis" | "own_domain"; domain: string | null }> => ({ mode: "bis", domain: null }));
const ensureReplyToken = vi.fn(async (..._a: unknown[]) => ({ conversationId: "cv1", token: TOKEN }));
const serviceDb = vi.fn(() => SERVICE);
vi.mock("@bis/db", () => ({
  getContact: (...a: unknown[]) => getContact(...a),
  getInboundSettings: (...a: unknown[]) => getInboundSettings(...a),
  ensureReplyToken: (...a: unknown[]) => ensureReplyToken(...a),
  serviceDb: () => serviceDb(),
}));

const { getForwardingAddressAction } = await import("./forwarding-actions");

describe("getForwardingAddressAction (S-06 part 2: made on click, never on view)", () => {
  beforeEach(() => {
    for (const f of [requireAccountAccess, dbForRequest, getContact, getInboundSettings, ensureReplyToken, serviceDb]) f.mockClear();
    getContact.mockResolvedValue({ id: CONTACT });
    getInboundSettings.mockResolvedValue({ mode: "bis", domain: null });
    ensureReplyToken.mockResolvedValue({ conversationId: "cv1", token: TOKEN });
  });

  it("a refused caller never reaches the database (mutation: read the contact before requireAccountAccess -> FAILS)", async () => {
    const denied = new Error("REDIRECT:/dashboard");
    requireAccountAccess.mockRejectedValueOnce(denied);
    await expect(getForwardingAddressAction(ACCOUNT, CONTACT)).rejects.toBe(denied);
    expect(requireAccountAccess).toHaveBeenCalledWith(ACCOUNT);
    expect(dbForRequest).not.toHaveBeenCalled();
    expect(getContact).not.toHaveBeenCalled();
    expect(serviceDb).not.toHaveBeenCalled();
    expect(ensureReplyToken).not.toHaveBeenCalled();
  });

  it("an id that is not a uuid is refused before any read (mutation: drop the check -> getContact called, FAILS)", async () => {
    expect(await getForwardingAddressAction(ACCOUNT, "not-an-id")).toEqual({ ok: false });
    expect(getContact).not.toHaveBeenCalled();
    expect(ensureReplyToken).not.toHaveBeenCalled();
  });

  it("a customer the REQUEST client cannot see (RLS answers null): no write at all (mutation: drop the null check -> FAILS)", async () => {
    getContact.mockResolvedValue(null);
    expect(await getForwardingAddressAction(ACCOUNT, CONTACT)).toEqual({ ok: false });
    expect(getContact).toHaveBeenCalledWith(REQUEST, ACCOUNT, CONTACT);
    expect(getInboundSettings).not.toHaveBeenCalled();
    expect(ensureReplyToken).not.toHaveBeenCalled();
  });

  it("success: the token is made on the SERVICE client for the route's own ids, after the proof, and the address comes back (mutation: getContact on the service client -> FAILS)", async () => {
    expect(await getForwardingAddressAction(ACCOUNT, CONTACT)).toEqual({ ok: true, address: `r-${TOKEN}@reply.bis-rgv.com` });
    expect(getContact.mock.calls[0]![0]).toBe(REQUEST);
    expect(getInboundSettings).toHaveBeenCalledWith(SERVICE, ACCOUNT);
    // Fix round 2, Minor 4: a person clicked, so the conversation.created event is theirs ("user").
    expect(ensureReplyToken).toHaveBeenCalledWith(SERVICE, ACCOUNT, CONTACT, "user_1", undefined, "user");
    expect(ensureReplyToken.mock.invocationCallOrder[0]!).toBeGreaterThan(getContact.mock.invocationCallOrder[0]!);
  });

  it("an own domain answers on that domain", async () => {
    getInboundSettings.mockResolvedValue({ mode: "own_domain", domain: "reply.rio.com" });
    expect(await getForwardingAddressAction(ACCOUNT, CONTACT)).toEqual({ ok: true, address: `r-${TOKEN}@reply.rio.com` });
  });

  it("Replies off, or an own domain not set: no token is made (mutation: make it whatever the setting -> FAILS)", async () => {
    getInboundSettings.mockResolvedValue({ mode: "off", domain: null });
    expect(await getForwardingAddressAction(ACCOUNT, CONTACT)).toEqual({ ok: false });
    getInboundSettings.mockResolvedValue({ mode: "own_domain", domain: null });
    expect(await getForwardingAddressAction(ACCOUNT, CONTACT)).toEqual({ ok: false });
    expect(ensureReplyToken).not.toHaveBeenCalled();
  });

  it("a failed write is ok:false, logged by account with the error's kind and never the token (mutation: let it throw -> rejects, FAILS)", async () => {
    ensureReplyToken.mockRejectedValue(new Error(`ensureReplyToken write failed near ${TOKEN}`));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await getForwardingAddressAction(ACCOUNT, CONTACT)).toEqual({ ok: false });
      const logged = errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      expect(logged).toContain(`forwarding address: account ${ACCOUNT} could not be made: Error: ensureReplyToken write failed near [token]`);
      expect(logged).not.toContain(TOKEN);
    } finally { errors.mockRestore(); }
  });

  it("the module is a \"use server\" file and is on the service-client allow list as proven-target", () => {
    const src = readFileSync(path.resolve(__dirname, "./forwarding-actions.ts"), "utf8");
    expect(src).toMatch(/^"use server";/);
    const allow = readFileSync(path.resolve(__dirname, "../../in-account-service-reads.test.ts"), "utf8");
    expect(allow).toContain(`"app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/forwarding-actions.ts": "proven-target"`);
  });
});
