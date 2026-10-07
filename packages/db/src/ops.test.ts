import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  recordHeartbeat, listHeartbeats, markAlerted, isHeartbeatKey, passHeartbeatKey, boundHeartbeatError,
  HEARTBEAT_KEYS, HEARTBEAT_ERROR_MAX_CHARS,
} from "./ops";

/**
 * Hermetic: a fake client, no network. What reaches the database is pinned
 * live in test/ops-heartbeats.test.ts and test/ops-heartbeats-grants.test.ts.
 */
function fakeRpc(impl: () => unknown) {
  const rpc = vi.fn(impl);
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("recordHeartbeat", () => {
  it("an ok sends p_ok true and no error text (mutation: send the outcome object → FAILS)", async () => {
    const f = fakeRpc(async () => ({ error: null }));
    await recordHeartbeat(f.db, "cron.tick", { ok: true });
    expect(f.rpc).toHaveBeenCalledTimes(1);
    expect(f.rpc).toHaveBeenCalledWith("record_heartbeat", { p_key: "cron.tick", p_ok: true, p_error: null });
  });

  it("an error sends p_ok false and the error text (mutation: drop p_error → FAILS)", async () => {
    const f = fakeRpc(async () => ({ error: null }));
    await recordHeartbeat(f.db, passHeartbeatKey("weeklyAgencyReport"), { ok: false, error: "Resend said 500" });
    expect(f.rpc).toHaveBeenCalledWith("record_heartbeat",
      { p_key: "cron.pass.weeklyAgencyReport", p_ok: false, p_error: "Resend said 500" });
  });

  it("never throws when the rpc answers an error: one console.error naming the key (mutation: throw on error → FAILS)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const f = fakeRpc(async () => ({ error: { code: "42501", message: "permission denied for function record_heartbeat" } }));
    await expect(recordHeartbeat(f.db, "voice.texml", { ok: true })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toContain("recordHeartbeat(voice.texml) failed: permission denied");
  });

  it("never throws when the rpc REJECTS (network down) (mutation: drop the try/catch → FAILS)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const f = fakeRpc(async () => { throw new Error("fetch failed"); });
    await expect(recordHeartbeat(f.db, "sms.inbound", { ok: false, error: "x" })).resolves.toBeUndefined();
    expect(String(log.mock.calls[0]![0])).toContain("recordHeartbeat(sms.inbound) failed: fetch failed");
  });

  it("never throws when the client throws SYNCHRONOUSLY (mutation: call db.rpc outside the try → FAILS)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const f = fakeRpc(() => { throw new TypeError("db.rpc is not a function"); });
    await expect(recordHeartbeat(f.db, "stripe.webhook", { ok: true })).resolves.toBeUndefined();
  });

  it("a key the CHECK would refuse is not sent at all, and is logged (mutation: drop the isHeartbeatKey guard → the rpc is called, FAILS)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const f = fakeRpc(async () => ({ error: null }));
    await recordHeartbeat(f.db, "cron pass/with spaces", { ok: true });
    expect(f.rpc).not.toHaveBeenCalled();
    expect(String(log.mock.calls[0]![0])).toContain("is not a heartbeat key");
  });

  it("a long error travels already bounded to 300 characters (mutation: send outcome.error as is → FAILS)", async () => {
    const f = fakeRpc(async () => ({ error: null }));
    await recordHeartbeat(f.db, "cron.tick", { ok: false, error: "e".repeat(5000) });
    const sent = (f.rpc.mock.calls[0] as unknown as [string, { p_error: string }])[1].p_error;
    expect(sent).toBe("e".repeat(HEARTBEAT_ERROR_MAX_CHARS));
  });
});

describe("boundHeartbeatError", () => {
  it("counts code points, so an emoji at the boundary is kept whole, never a lone surrogate (mutation: .slice(0, 300) → FAILS)", () => {
    const s = "x".repeat(299) + "\u{1F600}" + "tail";
    const cut = boundHeartbeatError(s);
    expect(Array.from(cut)).toHaveLength(300);
    expect(cut.endsWith("\u{1F600}")).toBe(true);
  });

  it("drops NUL, which Postgres text cannot hold and which fails the whole RPC (mutation: drop the replace → FAILS)", () => {
    expect(boundHeartbeatError("a\u0000b")).toBe("ab");
  });

  it("leaves a short message alone", () => {
    expect(boundHeartbeatError("Telnyx said 503")).toBe("Telnyx said 503");
  });
});

describe("isHeartbeatKey (the TS twin of ops_heartbeats_key_check; live parity in test/ops-heartbeats.test.ts)", () => {
  it("takes every spec key and a camelCase pass key (mutation: [a-z0-9_.-] → the pass key is refused, FAILS)", () => {
    for (const k of Object.values(HEARTBEAT_KEYS)) expect(isHeartbeatKey(k), k).toBe(true);
    expect(isHeartbeatKey(passHeartbeatKey("appointmentConfirms"))).toBe(true);
  });

  it("refuses empty, 81 characters, a trailing newline, spaces, slashes and non-ASCII letters (mutation: drop the $ anchor or the {1,80} bound → FAILS)", () => {
    for (const k of ["", "a".repeat(81), "cron.tick\n", "cron tick", "cron/tick", "café"]) {
      expect(isHeartbeatKey(k), JSON.stringify(k)).toBe(false);
    }
    expect(isHeartbeatKey("a".repeat(80))).toBe(true);
  });
});

describe("listHeartbeats", () => {
  it("reads every row ordered by key, and maps snake_case to HeartbeatRow (mutation: drop the order → FAILS)", async () => {
    const order = vi.fn(async () => ({
      data: [{ key: "cron.tick", last_ok_at: "2026-10-01T12:00:00+00:00", last_error_at: null, last_error: null,
               consecutive_failures: 0, alerted_at: null }],
      error: null,
    }));
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));
    const rows = await listHeartbeats({ from } as unknown as SupabaseClient);
    expect(from).toHaveBeenCalledWith("ops_heartbeats");
    expect(select).toHaveBeenCalledWith("key, last_ok_at, last_error_at, last_error, consecutive_failures, alerted_at");
    expect(order).toHaveBeenCalledWith("key", { ascending: true });
    expect(rows).toEqual([{ key: "cron.tick", lastOkAt: "2026-10-01T12:00:00+00:00", lastErrorAt: null, lastError: null,
                            consecutiveFailures: 0, alertedAt: null }]);
  });

  it("throws on a read error (its callers catch) (mutation: return [] on error → FAILS)", async () => {
    const order = vi.fn(async () => ({ data: null, error: { message: "permission denied for table ops_heartbeats" } }));
    const db = { from: () => ({ select: () => ({ order }) }) } as unknown as SupabaseClient;
    await expect(listHeartbeats(db)).rejects.toThrow("listHeartbeats failed: permission denied for table ops_heartbeats");
  });
});

describe("markAlerted", () => {
  function fakeUpdate(error: { message: string } | null = null) {
    const eq = vi.fn(async () => ({ error }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    return { db: { from } as unknown as SupabaseClient, from, update, eq };
  }

  it("sets alerted_at to the given moment for that key only, and nothing else (mutation: also write updated_at → FAILS)", async () => {
    const f = fakeUpdate();
    await markAlerted(f.db, "cron.pass.reminders", new Date("2026-10-01T12:00:00Z"));
    expect(f.from).toHaveBeenCalledWith("ops_heartbeats");
    expect(f.update).toHaveBeenCalledWith({ alerted_at: "2026-10-01T12:00:00.000Z" });
    expect(f.eq).toHaveBeenCalledWith("key", "cron.pass.reminders");
  });

  it("null clears it (the recovered email has gone)", async () => {
    const f = fakeUpdate();
    await markAlerted(f.db, "cron.tick", null);
    expect(f.update).toHaveBeenCalledWith({ alerted_at: null });
  });

  it("throws on a write error (mutation: swallow it → FAILS)", async () => {
    const f = fakeUpdate({ message: "boom" });
    await expect(markAlerted(f.db, "cron.tick", null)).rejects.toThrow("markAlerted(cron.tick) failed: boom");
  });
});
