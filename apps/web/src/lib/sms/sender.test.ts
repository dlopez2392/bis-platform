import { describe, it, expect, vi } from "vitest";
import { resolveSmsSender, refusesAlertLoop } from "./sender";

const a2p = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", () => ({ getA2pRegistration: a2p }));

/** Captures the arguments `.order()` was called with, so tests can assert on them. */
type OrderCall = { column: string; opts: { ascending: boolean } };

/** Minimal PostgREST stub for the phone_numbers lookup. */
function dbReturning(
  rows: { e164: string; created_at: string }[],
  captured?: { call?: OrderCall },
) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: (column: string, opts: { ascending: boolean }) => {
              if (captured) captured.call = { column, opts };
              return Promise.resolve({ data: rows, error: null });
            },
          }),
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
    const captured: { call?: OrderCall } = {};
    const gate = await resolveSmsSender(dbReturning([
      { e164: "+15550001111", created_at: "2026-01-01" },
      { e164: "+15559998888", created_at: "2026-06-01" },
    ], captured), "acc");
    expect(gate).toEqual({ ok: true, from: "+15550001111" });
    // Prove the result is ordering, not incidental array order: the DB read
    // must ask Postgres for ascending created_at, not just read data[0] of
    // whatever comes back. A refactor flipping this flag must fail loudly —
    // the sending number must not change under an account between two sends.
    expect(captured.call).toEqual({ column: "created_at", opts: { ascending: true } });
  });
});

describe("refusesAlertLoop", () => {
  it("refuses (true) when alert_phone equals the resolved sending number, logging both (mutation: invert the equality check → FAILS)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(refusesAlertLoop("acc_1", "+15551112222", "+15551112222")).toBe(true);
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("acc_1");
    expect(logged).toContain("+15551112222");
    spy.mockRestore();
  });

  it("does not refuse (false), and logs nothing, when the two numbers differ", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(refusesAlertLoop("acc_1", "+15551112222", "+15559998888")).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
