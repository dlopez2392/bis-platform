import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";
import { SCREENED_REASONS, screenedClass } from "../screened-calls";
import { FORWARD_KINDS } from "../forwarded-calls";

/**
 * 0099_billing_pause.sql (M7a PR-4, the non-payment pause) at the level that
 * can see it: real SQL in a rolled-back transaction. Money tier: every test
 * names the mutation that turns it red.
 *
 * RED BEFORE APPLY, legitimately: every test that touches the database. The
 * two columns and the table do not exist (42703 / 42P01, or an empty catalogue
 * read where a row is expected), and the two CHECKs still hold their 0039 and
 * 0059 value lists. Two halves would pass vacuously before apply and are
 * guarded so they cannot: the "anon holds nothing" read and the "VALIDATED"
 * read each first assert the object 0099 adds (the table, the two new values),
 * because 0039's and 0059's inline CHECKs were already validated and a missing
 * table has no grants. The screenedClass case is pure TypeScript: it is red
 * before the TS mirrors are widened, not before apply.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const orgId = (label: string) => `org_BPAUSE_${label}_${RUN}`;
const PRICE_IDS = { base: "price_t_base", voice_minutes: "price_t_vm", sms: "price_t_sms", ai_chats: "price_t_ai" };
const FEATURES = { voice_receptionist: true, web_concierge: true };
const ZERO = { voice_minutes: 0, sms: 0, ai_chats: 0 };

type Seeded = { a: string; b: string; plan: string };

async function seed(c: Client): Promise<Seeded> {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const mk = async (label: string) => (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,$3,true) returning id",
    [agency!.id, orgId(label), `Pause ${label}`])).rows[0]!.id;
  const a = await mk("A");
  const b = await mk("B");
  const plan = (await c.query<{ id: string }>(
    `insert into plans (agency_id, name, monthly_price_cents, features, allowances, overage_cents,
                        stripe_product_id, stripe_price_ids)
       values ($1, $2, 4900, $3, $4, $4, 'prod_t_pause', $5) returning id`,
    [agency!.id, `Pause plan ${RUN}`, JSON.stringify(FEATURES), JSON.stringify(ZERO), JSON.stringify(PRICE_IDS)],
  )).rows[0]!.id;
  return { a, b, plan };
}

/** One statement expected to fail, inside a savepoint so the transaction
 *  survives for the next one (a failed statement aborts a Postgres txn). */
async function refused(c: Client, sql: string, params: unknown[]): Promise<unknown> {
  await c.query("savepoint probe");
  try {
    await c.query(sql, params);
    return null;
  } catch (e) {
    return e;
  } finally {
    await c.query("rollback to savepoint probe");
  }
}

const RECON_SQL = `insert into billing_reconciliations
  (account_id, meter, window_start, window_end, bis_settled, bis_in_flight, bis_held, stripe_total, verdict)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
type Recon = {
  account: string; meter: string; start: string; end: string;
  settled: number; inFlight: number; held: number; stripe: number | string; verdict: string;
};
const P1 = { start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z" };
const P2 = { start: "2026-10-01T00:00:00Z", end: "2026-10-26T08:00:00Z" };
const recon = (account: string, over: Partial<Recon> = {}): unknown[] => {
  const r: Recon = {
    account, meter: "sms", start: P1.start, end: P1.end,
    settled: 10, inFlight: 0, held: 0, stripe: 10, verdict: "match", ...over,
  };
  return [r.account, r.meter, r.start, r.end, r.settled, r.inFlight, r.held, r.stripe, r.verdict];
};

async function tableExists(c: Client): Promise<boolean> {
  const { rows: [r] } = await c.query<{ t: string | null }>(
    "select to_regclass('public.billing_reconciliations')::text as t");
  return r!.t !== null;
}

/** The quoted values of a CHECK, read from the live catalogue. */
async function checkValues(c: Client, table: string, conname: string): Promise<{ values: string[]; validated: boolean }> {
  const { rows } = await c.query<{ def: string; convalidated: boolean }>(
    `select pg_get_constraintdef(oid) as def, convalidated from pg_constraint
      where conrelid = $1::regclass and conname = $2`, [`public.${table}`, conname]);
  expect(rows, `${conname} exists exactly once`).toHaveLength(1);
  const values = (rows[0]!.def.match(/'[a-z-]+'/g) ?? []).map((v) => v.slice(1, -1)).sort();
  return { values, validated: rows[0]!.convalidated };
}

describe("0099 account_billing: pause_lifted_at, stripe_checked_at", () => {
  it("pause_lifted_at and stripe_checked_at are nullable timestamptz with no default (mutation: add `default now()` to stripe_checked_at → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name, data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'account_billing'
            and column_name in ('pause_lifted_at', 'stripe_checked_at')
          order by column_name`);
      expect(rows).toEqual([
        { column_name: "pause_lifted_at", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
        { column_name: "stripe_checked_at", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
      ]);
    }));

  it("a complimentary row cannot carry a lift stamp (mutation: drop account_billing_lift_check → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      // Positive control first: a billed (not complimentary) row takes a stamp,
      // so the refusal below is the CHECK and not the column being refused.
      await c.query(
        "insert into account_billing (account_id, plan_id, pause_lifted_at, stripe_checked_at) values ($1, $2, now(), now())",
        [s.b, s.plan]);
      expect(await refused(c,
        "insert into account_billing (account_id, plan_id, complimentary, pause_lifted_at) values ($1, $2, true, now())",
        [s.a, s.plan])).toMatchObject({ code: "23514", constraint: "account_billing_lift_check" });
      // And the same through an update of an existing complimentary row.
      await c.query("insert into account_billing (account_id, plan_id, complimentary) values ($1, $2, true)", [s.a, s.plan]);
      expect(await refused(c, "update account_billing set pause_lifted_at = now() where account_id = $1", [s.a]))
        .toMatchObject({ code: "23514", constraint: "account_billing_lift_check" });
    }));
});

describe("0099 billing_reconciliations: RLS, grants and policy", () => {
  it("billing_reconciliations: RLS on, exactly one SELECT policy for the agency (mutation: add `or account_id = app.current_account_id()` → FAILS)", () =>
    withRollback(async (c) => {
      expect(await tableExists(c), "0099 creates billing_reconciliations").toBe(true);
      const { rows: [rls] } = await c.query<{ relrowsecurity: boolean }>(
        "select relrowsecurity from pg_class where oid = 'public.billing_reconciliations'::regclass");
      expect(rls!.relrowsecurity).toBe(true);
      const { rows } = await c.query<{
        policyname: string; permissive: string; roles: string[]; cmd: string; qual: string; with_check: string | null;
      }>(
        `select policyname, permissive, roles::text[] as roles, cmd, qual, with_check from pg_policies
          where schemaname = 'public' and tablename = 'billing_reconciliations'`);
      expect(rows.map(({ qual: _q, ...r }) => r)).toEqual([{
        policyname: "billing_reconciliations_agency_read", permissive: "PERMISSIVE",
        roles: ["authenticated"], cmd: "SELECT", with_check: null,
      }]);
      expect(rows[0]!.qual).toMatch(/app\.is_agency\(\)/);
      expect(rows[0]!.qual).not.toMatch(/account_id|current_account_id/);
    }));

  it("a client reads no reconciliation row, the agency reads it (mutation: policy `using (true)` → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query(RECON_SQL, recon(s.a));
      // The client is account A itself (client_access_enabled, org claim), so a
      // tenant-shaped policy would show it this row; only the agency may.
      await actAs(c, { org_id: orgId("A") });
      const { rows: [client] } = await c.query<{ n: string }>("select count(*)::text as n from billing_reconciliations");
      expect(client!.n).toBe("0");
      await actAs(c, { app_role: "agency_admin" });
      const { rows: agency } = await c.query<{ account_id: string }>(
        "select account_id from billing_reconciliations where account_id = $1", [s.a]);
      expect(agency).toEqual([{ account_id: s.a }]);
    }));

  it("anon and authenticated hold SELECT at most, MAINTAIN included (mutation: enumerated revoke instead of `revoke all` → FAILS)", () =>
    withRollback(async (c) => {
      expect(await tableExists(c), "0099 creates billing_reconciliations").toBe(true);
      const { rows } = await c.query(
        `select grantee, privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'billing_reconciliations'
            and grantee in ('anon', 'authenticated')
          order by grantee, privilege_type`);
      expect(rows).toEqual([{ grantee: "authenticated", privilege_type: "SELECT" }]);
      const { rows: [maint] } = await c.query<{ auth: boolean; anon: boolean }>(
        `select has_table_privilege('authenticated', 'public.billing_reconciliations', 'MAINTAIN') as auth,
                has_table_privilege('anon', 'public.billing_reconciliations', 'MAINTAIN') as anon`);
      expect(maint).toEqual({ auth: false, anon: false });
      // service_role keeps Supabase's default privileges: the nightly step writes.
      const { rows: [svc] } = await c.query<Record<string, boolean>>(
        `select has_table_privilege('service_role', 'public.billing_reconciliations', 'SELECT') as sel,
                has_table_privilege('service_role', 'public.billing_reconciliations', 'INSERT') as ins,
                has_table_privilege('service_role', 'public.billing_reconciliations', 'UPDATE') as upd,
                has_table_privilege('service_role', 'public.billing_reconciliations', 'DELETE') as del`);
      expect(svc).toEqual({ sel: true, ins: true, upd: true, del: true });
    }));
});

describe("0099 billing_reconciliations: shape", () => {
  it("the row cascades with its account (mutation: `on delete restrict` → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query(RECON_SQL, recon(s.a));
      const { rows: [fk] } = await c.query<{ confdeltype: string }>(
        `select confdeltype from pg_constraint
          where conrelid = 'public.billing_reconciliations'::regclass and contype = 'f'`);
      expect(fk!.confdeltype).toBe("c");
      await c.query("delete from accounts where id = $1", [s.a]);
      const { rows: left } = await c.query("select 1 from billing_reconciliations where account_id = $1", [s.a]);
      expect(left).toEqual([]);
    }));

  it("CHECKs refuse a bad meter, verdict, window and negative count (mutation: drop billing_reconciliations_verdict_check → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      // Positive control: every verdict and meter the app writes is accepted.
      const verdicts = ["match", "held_at_stripe", "held_missing", "stripe_over", "stripe_under", "ambiguous"];
      const meters = ["voice_minutes", "sms", "ai_chats"];
      for (const [i, verdict] of verdicts.entries()) {
        await c.query(RECON_SQL, recon(s.a, { meter: meters[i % 3]!, verdict, start: `2026-0${i + 1}-01T00:00:00Z`, end: `2026-0${i + 1}-02T00:00:00Z`, stripe: "12.5" }));
      }
      const bad = (over: Partial<Recon>) => refused(c, RECON_SQL, recon(s.b, over));
      expect(await bad({ meter: "minutes" })).toMatchObject({ code: "23514", constraint: "billing_reconciliations_meter_check" });
      expect(await bad({ verdict: "mismatch" })).toMatchObject({ code: "23514", constraint: "billing_reconciliations_verdict_check" });
      expect(await bad({ end: P1.start })).toMatchObject({ code: "23514", constraint: "billing_reconciliations_window_check" });
      expect(await bad({ end: "2026-08-31T00:00:00Z" })).toMatchObject({ code: "23514", constraint: "billing_reconciliations_window_check" });
      expect(await bad({ settled: -1 })).toMatchObject({ code: "23514", constraint: "billing_reconciliations_settled_check" });
      expect(await bad({ inFlight: -1 })).toMatchObject({ code: "23514", constraint: "billing_reconciliations_in_flight_check" });
      expect(await bad({ held: -1 })).toMatchObject({ code: "23514", constraint: "billing_reconciliations_held_check" });
      expect(await bad({ stripe: "-0.5" })).toMatchObject({ code: "23514", constraint: "billing_reconciliations_stripe_check" });
    }));

  it("one row per (account, meter, period): a second period inserts, the same period twice is a 23505 on billing_reconciliations_pkey (mutation: key on (account_id, meter) → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query(RECON_SQL, recon(s.a, { start: P1.start, end: P1.end }));
      await c.query(RECON_SQL, recon(s.a, { start: P2.start, end: P2.end }));
      // A different meter in the same period is its own row too.
      await c.query(RECON_SQL, recon(s.a, { meter: "voice_minutes", start: P2.start, end: P2.end }));
      expect(await refused(c, RECON_SQL, recon(s.a, { start: P2.start, end: "2026-10-27T08:00:00Z", verdict: "stripe_over" })))
        .toMatchObject({ code: "23505", constraint: "billing_reconciliations_pkey" });
      const { rows } = await c.query<{ n: string }>(
        "select count(*)::text as n from billing_reconciliations where account_id = $1", [s.a]);
      expect(rows[0]!.n).toBe("3");
    }));
});

describe("0099 the two widened call-record CHECKs", () => {
  it("forwarded_calls takes billing-paused and plan-no-voice, still refuses anything else (mutation: leave plan-no-voice out → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const sql = "insert into forwarded_calls (account_id, called_e164, kind) values ($1, '+19565550100', $2)";
      await c.query(sql, [s.a, "billing-paused"]);
      await c.query(sql, [s.a, "plan-no-voice"]);
      expect(await refused(c, sql, [s.a, "made-up"]))
        .toMatchObject({ code: "23514", constraint: "forwarded_calls_kind_check" });
    }));

  it("screened_calls takes billing-paused and plan-no-voice, still refuses anything else (mutation: leave plan-no-voice out → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const sql = "insert into screened_calls (account_id, called_e164, reason) values ($1, '+19565550100', $2)";
      await c.query(sql, [s.a, "billing-paused"]);
      await c.query(sql, [s.a, "plan-no-voice"]);
      expect(await refused(c, sql, [s.a, "made-up"]))
        .toMatchObject({ code: "23514", constraint: "screened_calls_reason_check" });
    }));

  it("both widened CHECKs are VALIDATED (mutation: drop the `validate constraint` lines → FAILS)", () =>
    withRollback(async (c) => {
      const fwd = await checkValues(c, "forwarded_calls", "forwarded_calls_kind_check");
      const scr = await checkValues(c, "screened_calls", "screened_calls_reason_check");
      // Guard: 0039's and 0059's inline CHECKs were already validated, so the
      // validated flag alone would pass before 0099. These must be 0099's.
      expect(fwd.values).toContain("plan-no-voice");
      expect(scr.values).toContain("plan-no-voice");
      expect({ fwd: fwd.validated, scr: scr.validated }).toEqual({ fwd: true, scr: true });
    }));

  it("ScreenedReason and FORWARD_KINDS mirror the CHECKs (mutation: drop a value from the TS list → FAILS)", () =>
    withRollback(async (c) => {
      expect((await checkValues(c, "forwarded_calls", "forwarded_calls_kind_check")).values)
        .toEqual([...FORWARD_KINDS].sort());
      expect((await checkValues(c, "screened_calls", "screened_calls_reason_check")).values)
        .toEqual([...SCREENED_REASONS].sort());
    }));
});

describe("0099 screenedClass for the two billing reasons", () => {
  it("billing-paused and plan-no-voice are `screened`, never `misconfigured`: the pause has its own work-queue line, the line-down banner is for OUR faults (mutation: classify billing-paused as misconfigured → FAILS)", () => {
    expect(SCREENED_REASONS).toContain("billing-paused");
    expect(SCREENED_REASONS).toContain("plan-no-voice");
    expect(screenedClass("billing-paused")).toBe("screened");
    expect(screenedClass("plan-no-voice")).toBe("screened");
  });
});
