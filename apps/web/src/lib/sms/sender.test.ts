import { describe, it, expect, vi } from "vitest";
import { resolveSmsSender } from "./sender";

const a2p = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", () => ({ getA2pRegistration: a2p }));

/** Minimal PostgREST stub for the phone_numbers lookup. */
function dbReturning(rows: { e164: string; created_at: string }[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }),
        }),
      }),
    }),
  } as never;
}

describe("resolveSmsSender", () => {
  it("refuses when A2P is not approved, whatever the numbers say", async () => {
    a2p.mockResolvedValue({ status: "pending", brandId: "B", campaignId: "C", updatedAt: null });
    const gate = await resolveSmsSender(dbReturning([{ e164: "+15551112222", created_at: "2026-01-01" }]), "acc");
    expect(gate).toEqual({ ok: false, reason: "a2p_not_approved" });
  });

  it("FAILS CLOSED when the account read returns null", async () => {
    // The assertion this function exists for. A missing or RLS-invisible row
    // must never resolve to "cleared to text" — texting without a valid
    // registration is what gets a client's number carrier-blocked.
    a2p.mockResolvedValue(null);
    const gate = await resolveSmsSender(dbReturning([{ e164: "+15551112222", created_at: "2026-01-01" }]), "acc");
    expect(gate).toEqual({ ok: false, reason: "a2p_not_approved" });
  });

  it("refuses when approved but no live number exists", async () => {
    a2p.mockResolvedValue({ status: "approved", brandId: "B", campaignId: "C", updatedAt: null });
    const gate = await resolveSmsSender(dbReturning([]), "acc");
    expect(gate).toEqual({ ok: false, reason: "no_live_number" });
  });

  it("returns the OLDEST live number when approved", async () => {
    a2p.mockResolvedValue({ status: "approved", brandId: "B", campaignId: "C", updatedAt: null });
    const gate = await resolveSmsSender(dbReturning([
      { e164: "+15550001111", created_at: "2026-01-01" },
      { e164: "+15559998888", created_at: "2026-06-01" },
    ]), "acc");
    expect(gate).toEqual({ ok: true, from: "+15550001111" });
  });
});
