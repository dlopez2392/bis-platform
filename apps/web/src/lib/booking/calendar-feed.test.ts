import { describe, it, expect, vi, beforeEach } from "vitest";
const m = vi.hoisted(() => ({ claim: vi.fn(), list: vi.fn(), branding: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  claimCalendarFeedFetch: (...a: unknown[]) => m.claim(...a),
  listFeedBookings: (...a: unknown[]) => m.list(...a),
  getBranding: (...a: unknown[]) => m.branding(...a),
}));
import { loadCalendarFeed } from "./calendar-feed";
import { feedTokenHash } from "./feed-token";

const TOKEN = "T".repeat(43);
const OK = { status: "ok", feedId: "f1", accountId: "acc-B", userId: "u1", role: "owner", userLanguage: null };
const accountsDb = (language: string | null) => ({
  from: (t: string) => { if (t !== "accounts") throw new Error(t);
    return { select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: id === "acc-B" ? { language } : null, error: null }) }) }) }; },
}) as never;
const ROW = { id: "b1", status: "booked", starts_at: "2026-11-03T15:00:00Z", ends_at: "2026-11-03T16:00:00Z",
  updated_at: "2026-11-01T00:00:00Z", created_at: "2026-11-01T00:00:00Z", first_name: "Maria", rootId: "b1", depth: 0 };
beforeEach(() => {
  m.claim.mockReset(); m.list.mockReset().mockResolvedValue({ meetingType: "in_person", rows: [ROW], truncated: false });
  m.branding.mockReset().mockResolvedValue({ brandName: "Rio Roofing" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadCalendarFeed", () => {
  it("claims by the token's HASH, never the token (mutation: pass the token → FAILS)", async () => {
    m.claim.mockResolvedValue({ status: "not_found" });
    expect(await loadCalendarFeed(accountsDb(null), TOKEN, new Date(), null)).toEqual({ kind: "not_found" });
    expect(m.claim).toHaveBeenCalledWith(expect.anything(), feedTokenHash(TOKEN));
    expect(m.list).not.toHaveBeenCalled();
  });
  it("reads ONLY the account the claim names (second account: acc-B, never anything else) (mutation: read a fixed id → FAILS)", async () => {
    m.claim.mockResolvedValue(OK);
    const r = await loadCalendarFeed(accountsDb(null), TOKEN, new Date("2026-11-01T00:00:00Z"), "https://app.bis-rgv.com");
    expect(r.kind).toBe("ok");
    expect(m.list).toHaveBeenCalledWith(expect.anything(), "acc-B", { now: new Date("2026-11-01T00:00:00Z"), technicianUserId: null });
    expect(m.branding).toHaveBeenCalledWith(expect.anything(), "acc-B");
  });
  it("a Technician's feed is fenced to their own id; an Owner's and Staff's are not (mutation: always null → FAILS)", async () => {
    m.claim.mockResolvedValue({ ...OK, role: "technician", userId: "tech-1" });
    await loadCalendarFeed(accountsDb(null), TOKEN, new Date(), null);
    expect(m.list.mock.calls[0]![2]).toMatchObject({ technicianUserId: "tech-1" });
    m.claim.mockResolvedValue({ ...OK, role: "staff", userId: "s-1" });
    await loadCalendarFeed(accountsDb(null), TOKEN, new Date(), null);
    expect(m.list.mock.calls[1]![2]).toMatchObject({ technicianUserId: null });
  });
  it("speaks the person's language over the account's (mutation: account first → FAILS)", async () => {
    m.claim.mockResolvedValue({ ...OK, userLanguage: "es" });
    const r = await loadCalendarFeed(accountsDb("en"), TOKEN, new Date(), null);
    expect(r.kind === "ok" && r.body).toContain("SUMMARY:Cita: Maria");
    m.claim.mockResolvedValue({ ...OK, userLanguage: null });
    const r2 = await loadCalendarFeed(accountsDb("es"), TOKEN, new Date(), null);
    expect(r2.kind === "ok" && r2.body).toContain("SUMMARY:Cita: Maria");
  });
  it("passes the limit through", async () => {
    m.claim.mockResolvedValue({ status: "rate_limited", retryAfterSeconds: 42 });
    expect(await loadCalendarFeed(accountsDb(null), TOKEN, new Date(), null)).toEqual({ kind: "rate_limited", retryAfterSeconds: 42 });
  });
});
