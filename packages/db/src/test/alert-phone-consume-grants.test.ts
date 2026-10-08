import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";
import { hashAlertCode } from "../alert-phone-verification";

/**
 * 0060 consume_alert_phone_verification(p_id): consumption stamps the
 * DATABASE's clock (D-107). withRollback only; nothing here commits.
 *
 * WHY IT EXISTS. 0036's `alert_phone_verifications_consumed_check` demands
 * `consumed_at >= created_at and consumed_at <= expires_at`. `created_at` and
 * `expires_at` are the database's `now()`; the consume used to send the APP
 * server's `new Date()`. An app clock even milliseconds behind the database's
 * stamped a `consumed_at` before `created_at`, and the CHECK refused a genuine
 * code (CI run 37517575687, 2026-10-06). The constraint's own comment says it
 * binds "only if the caller stamps the real time" — so the fix is that the
 * caller no longer stamps anything: this function does, with `now()`, the
 * same clock that wrote the row.
 *
 * RED BEFORE APPLY: every test here. has_function_privilege / ::regprocedure on
 * a function that does not exist raise 42883, and each behaviour case calls it.
 *
 * Seeds as the owner (inside the rollback), then calls the function as
 * service_role — the only role serviceDb() is, and the only one with EXECUTE.
 */
const FN = "public.consume_alert_phone_verification(uuid)";
const RUN = Math.random().toString(36).slice(2, 10);

async function seedVerification(
  c: Client, label: string, times?: { createdAt: string; expiresAt: string },
): Promise<string> {
  const { rows: [agency] } = await c.query("select id from agencies limit 1");
  const { rows: [account] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name) values ($1, $2, 'Fixture APC') returning id",
    [agency.id, `org_APC_${label}_${RUN}`]);
  const { rows: [v] } = times
    ? await c.query(
        `insert into public.alert_phone_verifications (account_id, phone, code_hash, created_at, expires_at)
         values ($1, '+15555550123', $2, ${times.createdAt}, ${times.expiresAt}) returning id`,
        [account.id, hashAlertCode("123456")])
    : await c.query(
        `insert into public.alert_phone_verifications (account_id, phone, code_hash)
         values ($1, '+15555550123', $2) returning id`,
        [account.id, hashAlertCode("123456")]);
  return v.id as string;
}

describe("0060 consume_alert_phone_verification: the shape and the grants", () => {
  it("EXECUTE is service_role's alone — not anon, not authenticated, not PUBLIC (mutation: drop `revoke all … from public, anon, authenticated` → authenticated keeps EXECUTE by name, FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; x: boolean }>(
        `select r, has_function_privilege(r, '${FN}', 'EXECUTE') as x
           from unnest(array['anon', 'authenticated', 'public', 'service_role']) r order by r`);
      expect(rows).toEqual([
        { r: "anon", x: false }, { r: "authenticated", x: false },
        { r: "public", x: false }, { r: "service_role", x: true },
      ]);
    }));

  it("takes (p_id uuid), returns boolean, runs as its CALLER with an empty search_path (0057's shape; mutation: security definer → prosecdef true, FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select pg_get_function_identity_arguments(p.oid) as args,
                pg_get_function_result(p.oid) as result,
                p.prosecdef as secdef, p.proconfig as cfg
           from pg_proc p where p.oid = '${FN}'::regprocedure`);
      // INVOKER, not DEFINER: the function writes with service_role's own
      // table grants, so it bypasses nothing service_role could not already
      // do, and there is no definer-side guard standing in for RLS that a
      // NULL could silently open (bis-plpgsql-null-guard).
      expect(rows).toEqual([{ args: "p_id uuid", result: "boolean", secdef: false, cfg: ['search_path=""'] }]);
    }));
});

describe("0060 consume_alert_phone_verification: what it stamps", () => {
  it("stamps the DATABASE's now(), the clock that wrote created_at — never a caller's (mutation: set consumed_at = now() - interval '1 millisecond', an app clock 1ms behind → 23514 consumed_check, FAILS)", () =>
    withRollback(async (c) => {
      // Inside one transaction created_at IS now(), so this is the tightest
      // skew there is: a stamp even one tick behind the row's own clock is
      // refused by the CHECK, which is exactly D-107's failure.
      const id = await seedVerification(c, "stamp");
      await c.query("set local role service_role");
      const { rows: [r] } = await c.query(`select public.consume_alert_phone_verification($1) as ok`, [id]);
      expect(r.ok).toBe(true);
      const { rows: [row] } = await c.query(
        `select consumed_at = now() as at_db_now, consumed_at >= created_at as after_created
           from public.alert_phone_verifications where id = $1`, [id]);
      expect(row).toEqual({ at_db_now: true, after_created: true });
    }));

  it("is a compare-and-swap: a second consume of the same row returns false and leaves the first stamp alone (mutation: drop `consumed_at is null` → second call returns true, FAILS)", () =>
    withRollback(async (c) => {
      const id = await seedVerification(c, "cas");
      await c.query("set local role service_role");
      const first = await c.query(`select public.consume_alert_phone_verification($1) as ok`, [id]);
      const { rows: [stamp1] } = await c.query(
        `select consumed_at from public.alert_phone_verifications where id = $1`, [id]);
      const second = await c.query(`select public.consume_alert_phone_verification($1) as ok`, [id]);
      const { rows: [stamp2] } = await c.query(
        `select consumed_at from public.alert_phone_verifications where id = $1`, [id]);
      expect([first.rows[0].ok, second.rows[0].ok]).toEqual([true, false]);
      expect(stamp2.consumed_at).toEqual(stamp1.consumed_at);
    }));

  it("refuses a row the DATABASE's clock calls expired — false and still unconsumed, not a check-violation error (mutation: drop `expires_at > now()` → the stamp lands past expires_at, 23514, FAILS)", () =>
    withRollback(async (c) => {
      // Expired ten minutes ago by the database's clock. An app clock running
      // behind would still call this row live, which is how it reaches the
      // consume at all; the database is the one clock that decides.
      const id = await seedVerification(c, "expired", {
        createdAt: "now() - interval '20 minutes'", expiresAt: "now() - interval '10 minutes'",
      });
      await c.query("set local role service_role");
      const { rows: [r] } = await c.query(`select public.consume_alert_phone_verification($1) as ok`, [id]);
      expect(r.ok).toBe(false);
      const { rows: [row] } = await c.query(
        `select consumed_at from public.alert_phone_verifications where id = $1`, [id]);
      expect(row.consumed_at).toBeNull();
    }));

  it("returns false for an id that matches no row (mutation: return true unconditionally → FAILS)", () =>
    withRollback(async (c) => {
      await c.query("set local role service_role");
      const { rows: [r] } = await c.query(
        `select public.consume_alert_phone_verification('00000000-0000-0000-0000-000000000000') as ok`);
      expect(r.ok).toBe(false);
    }));
});

// ONE refused statement per withRollback: after the first, the transaction is
// aborted (25P02). Code AND message: if the function were executable, the
// invoker's UPDATE would still be refused by 0036's TABLE grant, with a
// different message — so the message proves it is the FUNCTION grant.
describe("0060 consume_alert_phone_verification: refused, as each role would meet it", () => {
  it("a client session (no app_role claim, like a real client token) cannot call it: 42501 permission denied for function (mutation: grant execute to authenticated → FAILS on the message: 'permission denied for table alert_phone_verifications')", () =>
    withRollback(async (c) => {
      await actAs(c, { org_id: "org_apc_test_client", sub: "user_apc_test" });
      await expect(c.query(`select public.consume_alert_phone_verification(gen_random_uuid())`))
        .rejects.toMatchObject({ code: "42501", message: "permission denied for function consume_alert_phone_verification" });
    }));

  it("the agency's own session cannot call it either — the verify path is serviceDb() only: 42501 permission denied for function", () =>
    withRollback(async (c) => {
      await actAs(c, { app_role: "agency_admin", sub: "user_apc_test" });
      await expect(c.query(`select public.consume_alert_phone_verification(gen_random_uuid())`))
        .rejects.toMatchObject({ code: "42501", message: "permission denied for function consume_alert_phone_verification" });
    }));

  it("anon cannot call it: 42501 permission denied for function (mutation: drop anon from the revoke → FAILS)", () =>
    withRollback(async (c) => {
      await c.query("set local role anon");
      await expect(c.query(`select public.consume_alert_phone_verification(gen_random_uuid())`))
        .rejects.toMatchObject({ code: "42501", message: "permission denied for function consume_alert_phone_verification" });
    }));
});
