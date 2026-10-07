import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashAlertCode, verifyAlertPhoneCode } from "../alert-phone-verification";

vi.mock("../accounts", () => ({ setAlertPhone: vi.fn(async () => {}) }));

/**
 * D-107, the app half: verifyAlertPhoneCode must never send ITS OWN clock as
 * `consumed_at`.
 *
 * 0036's consumed_check compares `consumed_at` with `created_at`, and
 * `created_at` is the database's now(). When the consume sent the app
 * server's `new Date()`, a server clock even milliseconds behind the
 * database's tripped `consumed_at >= created_at` and refused a genuine code
 * (CI run 37517575687). The fix is that the database stamps it, through
 * 0060's consume_alert_phone_verification(p_id). The live proof — the same
 * flow with the app clock deliberately behind — is in
 * src/test/alert-phone-verification-flow.test.ts ("the app server's clock").
 * This file is the hermetic half: it runs with no credentials and records
 * every request verifyAlertPhoneCode makes, so it fails BY NAME on the old
 * `.update({ consumed_at: new Date().toISOString() })`.
 *
 * A recording stand-in for the PostgREST builder, not a model of Postgres:
 * it answers the lookup with one live row whose hash matches, and the consume
 * with "one row consumed". It asserts only what was SENT.
 */
type Call = { table?: string; fn?: string; method: string; args: unknown[] };

function recordingDb(consumeResult: boolean) {
  const calls: Call[] = [];
  const row = { id: "11111111-1111-4111-8111-111111111111", code_hash: hashAlertCode("123456"), attempts: 0 };
  const builder = (table: string) => {
    let verb = "select";
    const b: Record<string, unknown> = {};
    const chain = new Proxy(b, {
      get(_t, prop: string) {
        if (prop === "then") {
          const result = verb === "select"
            ? { data: [row], error: null }
            : { data: [{ id: row.id }], error: null };
          return (resolve: (v: unknown) => void) => resolve(result);
        }
        return (...args: unknown[]) => {
          calls.push({ table, method: prop, args });
          if (prop === "update" || prop === "insert" || prop === "upsert" || prop === "delete") verb = prop;
          return chain;
        };
      },
    });
    return chain;
  };
  const db = {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: unknown) => {
      calls.push({ fn, method: "rpc", args: [args] });
      return Promise.resolve({ data: consumeResult, error: null });
    },
  } as unknown as SupabaseClient;
  return { db, calls, row };
}

describe("verifyAlertPhoneCode — who stamps consumed_at", () => {
  it("never sends the app server's clock as consumed_at; the database stamps it through consume_alert_phone_verification (mutation: restore `.update({ consumed_at: new Date().toISOString() })` → FAILS)", async () => {
    const { db, calls, row } = recordingDb(true);
    expect(await verifyAlertPhoneCode(db, "acct", "+15555550123", "123456", "user_test")).toBe("verified");

    const writesOfConsumedAt = calls.filter((c) =>
      c.method === "update" && Object.prototype.hasOwnProperty.call(c.args[0] ?? {}, "consumed_at"));
    expect(writesOfConsumedAt).toEqual([]);
    expect(calls.filter((c) => c.method === "rpc")).toEqual([
      { fn: "consume_alert_phone_verification", method: "rpc", args: [{ p_id: row.id }] },
    ]);
  });

  it("reports expired, and writes no number, when the database consumes nothing (raced, or expired by the DATABASE's clock) (mutation: ignore the rpc's false → 'verified', FAILS)", async () => {
    const { setAlertPhone } = await import("../accounts");
    vi.mocked(setAlertPhone).mockClear();
    const { db } = recordingDb(false);
    expect(await verifyAlertPhoneCode(db, "acct", "+15555550123", "123456", "user_test")).toBe("expired");
    expect(setAlertPhone).not.toHaveBeenCalled();
  });
});
