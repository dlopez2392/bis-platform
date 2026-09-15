import { describe, it, expect, vi } from "vitest";
import { resolveSmsSender, refusesAlertLoop } from "./sender";

const a2p = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", () => ({ getA2pRegistration: a2p }));

/** Captures the arguments `.order()` and `.in()` were called with, so tests
 *  can assert on them. */
type OrderCall = { column: string; opts: { ascending: boolean } };
type InCall = { column: string; values: string[] };

/** Minimal PostgREST stub for the phone_numbers lookup. Rows carry `status`
 *  now — finding 2 (alert-send-report): the query asks for `testing` OR
 *  `live`, not `live` alone, because `refusesAlertLoop` needs every number
 *  this account OWNS, matching `api/sms/inbound/route.ts`'s own definition
 *  of "owned" (testing or live), not just the one resolved to send FROM. */
function dbReturning(
  rows: { e164: string; status: string; created_at: string }[],
  captured?: { order?: OrderCall; in?: InCall },
) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: (column: string, values: string[]) => {
            if (captured) captured.in = { column, values };
            return {
              order: (orderColumn: string, opts: { ascending: boolean }) => {
                if (captured) captured.order = { column: orderColumn, opts };
                return Promise.resolve({ data: rows, error: null });
              },
            };
          },
        }),
      }),
    }),
  } as never;
}

describe("resolveSmsSender", () => {
  it("refuses when A2P is not approved, whatever the numbers say", async () => {
    a2p.mockResolvedValue({ status: "pending", brandId: "B", campaignId: "C", updatedAt: null });
    const gate = await resolveSmsSender(
      dbReturning([{ e164: "+15551112222", status: "live", created_at: "2026-01-01" }]), "acc",
    );
    expect(gate).toEqual({ ok: false, reason: "a2p_not_approved" });
  });

  it("FAILS CLOSED when the account read returns null", async () => {
    // The assertion this function exists for. A missing or RLS-invisible row
    // must never resolve to "cleared to text" — texting without a valid
    // registration is what gets a client's number carrier-blocked.
    a2p.mockResolvedValue(null);
    const gate = await resolveSmsSender(
      dbReturning([{ e164: "+15551112222", status: "live", created_at: "2026-01-01" }]), "acc",
    );
    expect(gate).toEqual({ ok: false, reason: "a2p_not_approved" });
  });

  it("refuses when approved but no live number exists", async () => {
    a2p.mockResolvedValue({ status: "approved", brandId: "B", campaignId: "C", updatedAt: null });
    const gate = await resolveSmsSender(dbReturning([]), "acc");
    expect(gate).toEqual({ ok: false, reason: "no_live_number" });
  });

  // A `testing` row alone (mid-provisioning, no `live` row yet) must still
  // refuse — `from` can only ever be a LIVE number.
  it("refuses when only a testing-status row exists — testing is owned, not sendable", async () => {
    a2p.mockResolvedValue({ status: "approved", brandId: "B", campaignId: "C", updatedAt: null });
    const gate = await resolveSmsSender(
      dbReturning([{ e164: "+15551112222", status: "testing", created_at: "2026-01-01" }]), "acc",
    );
    expect(gate).toEqual({ ok: false, reason: "no_live_number" });
  });

  it("returns the OLDEST live number when approved", async () => {
    a2p.mockResolvedValue({ status: "approved", brandId: "B", campaignId: "C", updatedAt: null });
    const captured: { order?: OrderCall; in?: InCall } = {};
    const gate = await resolveSmsSender(dbReturning([
      { e164: "+15550001111", status: "live", created_at: "2026-01-01" },
      { e164: "+15559998888", status: "live", created_at: "2026-06-01" },
    ], captured), "acc");
    expect(gate).toEqual({ ok: true, from: "+15550001111", ownedNumbers: ["+15550001111", "+15559998888"] });
    // Prove the result is ordering, not incidental array order: the DB read
    // must ask Postgres for ascending created_at, not just read data[0] of
    // whatever comes back. A refactor flipping this flag must fail loudly —
    // the sending number must not change under an account between two sends.
    expect(captured.order).toEqual({ column: "created_at", opts: { ascending: true } });
  });

  // Finding 2 (alert-send-report follow-up review): resolveSmsSender's own
  // query is where ownedNumbers comes from — "one more predicate on a query
  // already being made," not a second round trip. `from` still ignores the
  // testing row (mutation: pick the testing row for `from` → FAILS, since it
  // would no longer equal the live one below), but `ownedNumbers` carries it.
  it("includes a testing-status row in ownedNumbers, but never as `from` (mutation: fold testing into `from` → FAILS)", async () => {
    a2p.mockResolvedValue({ status: "approved", brandId: "B", campaignId: "C", updatedAt: null });
    const captured: { order?: OrderCall; in?: InCall } = {};
    const gate = await resolveSmsSender(dbReturning([
      { e164: "+15550001111", status: "testing", created_at: "2026-01-01" },
      { e164: "+15559998888", status: "live", created_at: "2026-06-01" },
    ], captured), "acc");
    expect(gate).toEqual({
      ok: true, from: "+15559998888", ownedNumbers: ["+15550001111", "+15559998888"],
    });
    // The query asks Postgres for both statuses, not just "live" — the
    // predicate this finding adds.
    expect(captured.in).toEqual({ column: "status", values: ["testing", "live"] });
  });
});

describe("refusesAlertLoop", () => {
  it("refuses (true) when alert_phone equals the resolved sending number (mutation: invert the equality check → FAILS)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(refusesAlertLoop("acc_1", "+15551112222", ["+15551112222"])).toBe(true);
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("acc_1");
    expect(logged).toContain("+15551112222");
    spy.mockRestore();
  });

  it("does not refuse (false), and logs nothing, when alert_phone matches none of the owned numbers", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(refusesAlertLoop("acc_1", "+15551112222", ["+15559998888"])).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // THE finding: the old signature only ever compared against the single
  // resolved `from`. A second owned number (e.g. one still `testing`) was an
  // unguarded loop even though api/sms/inbound/route.ts treats it as owned
  // too. Passing the FULL owned list is what closes that — alert_phone here
  // is deliberately NOT the first entry, so a mutation that only checks
  // ownedNumbers[0] fails this.
  it("refuses when alert_phone matches ANY owned number, not only the one resolved to send from (mutation: compare against ownedNumbers[0] only → FAILS)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(refusesAlertLoop("acc_1", "+15559998888", ["+15551112222", "+15559998888"])).toBe(true);
    spy.mockRestore();
  });
});
