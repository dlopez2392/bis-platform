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
  m.claim.mockReset(); m.list.mockReset().mockResolvedValue({ meetingType: "in_person", rows: [ROW], truncated: false, capped: { upcoming: false, past: false } });
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

describe("loadCalendarFeed — what a failure says (final review m4, m5)", () => {
  it.each([
    [{ upcoming: true, past: false }, ["more than 1500 upcoming"], ["more than 300 past"]],
    [{ upcoming: false, past: true }, ["more than 300 past"], ["more than 1500 upcoming"]],
    [{ upcoming: true, past: true }, ["more than 1500 upcoming", "more than 300 past"], []],
  ] as const)("names the cap that was hit: %o (mutation: one sentence for both → FAILS)", async (capped, said, unsaid) => {
    m.claim.mockResolvedValue(OK);
    m.list.mockResolvedValue({ meetingType: "in_person", rows: [ROW], truncated: true, capped });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    err.mockClear();
    await loadCalendarFeed(accountsDb(null), TOKEN, new Date(), null);
    const logged = err.mock.calls.flat().map(String).join("\n");
    for (const s of said) expect(logged).toContain(s);
    for (const s of unsaid) expect(logged).not.toContain(s);
    expect(logged).toContain("f1");
    expect(logged).not.toContain(TOKEN);
  });
  it("a read that fails after the claim names the feed, never the token (mutation: rethrow the bare error → FAILS)", async () => {
    m.claim.mockResolvedValue(OK);
    m.list.mockRejectedValue(new Error("listFeedBookings: upcoming read failed: boom"));
    const e = await loadCalendarFeed(accountsDb(null), TOKEN, new Date(), null).then(() => null, (x: unknown) => x as Error);
    expect(e?.message).toMatch(/^calendar feed f1: .*boom/);
    expect(e?.message).not.toContain(TOKEN);
  });
});
