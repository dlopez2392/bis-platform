import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { withRollback } from "./db";
import { CUSTOMER_STOP_METHODS, CONSENT_METHODS } from "../consent";

/**
 * 0055 (consent chain PR-2): the ledger's one write path, run as the role
 * that uses it. withRollback only, so it runs on the local PG18 replica
 * (`post`) as well as on the CI project.
 *
 * RED BEFORE APPLY (the replica's `pre`): every test here — the function,
 * the index, the constraint and the tasks column do not exist yet.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ADDR = "+19565550142";

async function account(c: Client, label: string): Promise<string> {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  return (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name) values ($1, $2, $3) returning id",
    [agency!.id, `org_CW_${label}_${RUN}`, `Consent writes ${label}`])).rows[0]!.id;
}

type Out = { outcome: string; event_id: string | null; prior_id: string | null; prior_action: string | null; prior_method: string | null };

/**
 * One call of the function, AS service_role (its only grantee). A refusal is
 * a returned row, not an error, so no savepoint is needed. The 2 ms sleep
 * keeps consecutive calls in different MILLISECONDS: the function orders the
 * newest row to the millisecond and then by restrictiveness (as consentStateOf
 * does), so two appends inside one millisecond would tie and the more
 * restrictive would read as newest, which is correct behaviour but not what
 * these tests are about (review R1-I1).
 */
async function append(c: Client, a: {
  account: string; action: string; method: string; guard?: string; expect?: string | null;
  address?: string; ref?: string | null; actor?: string | null; note?: string | null; at?: string | null;
  evidence?: Record<string, unknown>;
}): Promise<Out> {
  await c.query("select pg_sleep(0.002)");
  await c.query("set local role service_role");
  try {
    const { rows: [row] } = await c.query<Out>(
      `select outcome, event_id, prior_id, prior_action, prior_method
         from public.append_consent_event($1, 'sms', $2, $3, $4, $5, $6, null, $7, $8, $9, $10::jsonb, $11)`,
      [a.account, a.address ?? ADDR, a.action, a.method, a.guard ?? "none", a.expect ?? null,
       a.actor ?? null, a.note ?? null, a.ref ?? null, JSON.stringify(a.evidence ?? {}), a.at ?? null]);
    return row!;
  } finally {
    await c.query("reset role");
  }
}

async function refusedWith(c: Client, sql: string, params: unknown[]): Promise<unknown> {
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

describe("0055 append_consent_event: who may call it", () => {
  it("EXECUTE is service_role's alone — not anon, not authenticated, not PUBLIC (mutation: drop `revoke all … from public, anon, authenticated` → authenticated keeps EXECUTE, FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; x: boolean }>(
        `select r, has_function_privilege(r, 'public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz)', 'EXECUTE') as x
           from unnest(array['anon', 'authenticated', 'service_role']) r order by r`);
      expect(rows).toEqual([{ r: "anon", x: false }, { r: "authenticated", x: false }, { r: "service_role", x: true }]);
    }));

  it("runs as its CALLER (security invoker) with an empty search_path, so it writes with service_role's own grants (mutation: security definer → prosecdef true, FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [f] } = await c.query<{ prosecdef: boolean; proconfig: string[] | null }>(
        "select prosecdef, proconfig from pg_proc where oid = 'public.append_consent_event'::regproc");
      expect(f).toEqual({ prosecdef: false, proconfig: ['search_path=""'] });
    }));
});

describe("0055 append_consent_event: the guards", () => {
  it("unless_customer_stopped: the customer's own stop refuses, a HELD address does not — a stop outranks a hold (mutation: `unless_customer_stopped` → `if_allowed` semantics → the held case refuses, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "us");
      const hold = await append(c, { account: a, action: "held", method: "free_text" });
      const stop = await append(c, { account: a, action: "revoked", method: "keyword", guard: "unless_customer_stopped" });
      expect([hold.outcome, stop.outcome, stop.prior_action]).toEqual(["appended", "appended", "held"]);
      const again = await append(c, { account: a, action: "revoked", method: "carrier_block", guard: "unless_customer_stopped" });
      expect(again).toMatchObject({ outcome: "refused", event_id: null, prior_id: stop.event_id, prior_action: "revoked" });
    }));

  it("unless_customer_stopped: a STAFF stop does not refuse the customer's own STOP — it is recorded over it, so only the customer can lift it (danlo 2026-09-28, review R2-I3; mutation: `when 'unless_customer_stopped' then v_prior_action is distinct from 'revoked'` → the keyword stop is refused, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "usst");
      const staff = await append(c, { account: a, action: "revoked", method: "staff", actor: "user_1", guard: "if_newest", expect: null });
      const own = await append(c, { account: a, action: "revoked", method: "keyword", guard: "unless_customer_stopped" });
      expect(own).toMatchObject({ outcome: "appended", prior_id: staff.event_id, prior_action: "revoked", prior_method: "staff" });
      // …and once it is the customer's own, a second customer stop is refused:
      expect((await append(c, { account: a, action: "revoked", method: "backfill_telnyx", guard: "unless_customer_stopped" })).outcome).toBe("refused");
      // A confirmed free-text stop is staff's, not the customer's, so it does not refuse either:
      const b = await account(c, "usft");
      const hold = await append(c, { account: b, action: "held", method: "free_text" });
      await append(c, { account: b, action: "revoked", method: "free_text", actor: "user_1", guard: "if_newest", expect: hold.event_id });
      expect((await append(c, { account: b, action: "revoked", method: "keyword", guard: "unless_customer_stopped" })).outcome).toBe("appended");
    }));

  it("if_allowed: a hold lands only on an allowed address (mutation: `when 'if_allowed' then v_prior_action is distinct from 'held'` → the hold over a keyword stop appends, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "ia");
      expect((await append(c, { account: a, action: "held", method: "free_text", guard: "if_allowed" })).outcome).toBe("appended");
      expect((await append(c, { account: a, action: "held", method: "free_text", guard: "if_allowed" })).outcome).toBe("refused");
      const b = await account(c, "ib");
      await append(c, { account: b, action: "revoked", method: "keyword" });
      expect((await append(c, { account: b, action: "held", method: "free_text", guard: "if_allowed" })).outcome).toBe("refused");
      // `held` has a state rule of its own that refuses the same priors, which
      // would mask the guard (review R1-N2). An action with NO state rule
      // leaves only the guard to refuse it:
      expect((await append(c, { account: b, action: "granted", method: "form", guard: "if_allowed" })).outcome).toBe("refused");
    }));

  it("if_stopped_or_held: START lifts a stop or a hold, and an allowed address with NO rows is refused, not appended — the plpgsql NULL guard (memory bis-plpgsql-null-guard; mutation: `if not v_ok` without coalesce → NULL is not taken and the insert runs, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "sh");
      expect((await append(c, { account: a, action: "resubscribed", method: "start_keyword", guard: "if_stopped_or_held" })).outcome).toBe("refused");
      await append(c, { account: a, action: "revoked", method: "keyword" });
      expect((await append(c, { account: a, action: "resubscribed", method: "start_keyword", guard: "if_stopped_or_held" })).outcome).toBe("appended");
    }));

  it("if_empty: any row at all, a grant included, refuses the first-text grant (mutation: test only deciding rows → a second grant appends, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "ie");
      expect((await append(c, { account: a, action: "granted", method: "inbound_text", guard: "if_empty" })).outcome).toBe("appended");
      expect((await append(c, { account: a, action: "granted", method: "inbound_text", guard: "if_empty" })).outcome).toBe("refused");
    }));

  it("if_newest: the expected id must still be the newest deciding row, and null means 'there is none' (mutation: `v_prior_id is not distinct from p_expect_id` → `p_expect_id is null or v_prior_id = p_expect_id` → the stale null appends, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "in");
      // The customer's STOP then START: the address is allowed again, so a staff
      // stop is permitted by choice 19's state rule, and only the compare-and-set
      // can refuse a stale one (review R1-N1: over a stop, the state rule would
      // refuse it anyway and mask the mutation).
      await append(c, { account: a, action: "revoked", method: "keyword" });
      const start = await append(c, { account: a, action: "resubscribed", method: "start_keyword" });
      // A stale "no row yet" click, made before the STOP and the START landed:
      expect((await append(c, { account: a, action: "revoked", method: "staff", actor: "user_1", guard: "if_newest", expect: null })).outcome).toBe("refused");
      // The right id:
      expect((await append(c, { account: a, action: "revoked", method: "staff", actor: "user_1", guard: "if_newest", expect: start.event_id })).outcome).toBe("appended");
      // The same id again, now stale — asked with an action no state rule touches, so only the compare-and-set answers:
      expect((await append(c, { account: a, action: "granted", method: "form", guard: "if_newest", expect: start.event_id })).outcome).toBe("refused");
    }));

  it("an unknown guard raises 22023 and writes nothing (mutation: drop the guard check → the CASE yields NULL and the call silently refuses, FAILS on the code)", () =>
    withRollback(async (c) => {
      const a = await account(c, "ug");
      await c.query("set local role service_role");
      const e = await refusedWith(c,
        "select * from public.append_consent_event($1, 'sms', $2, 'revoked', 'keyword', 'whenever', null, null, null, null, null, '{}'::jsonb, null)", [a, ADDR]);
      await c.query("reset role");
      expect(e).toMatchObject({ code: "22023", message: expect.stringMatching(/unknown guard whenever/) });
    }));

  it("unless_customer_stopped matches CUSTOMER_STOP_METHODS exactly, method by method (review I2: nothing else pinned that 0055's hardcoded list agrees with consent.ts's export; mutation: 0055's list drops 'carrier_block' or gains 'backfill_0049' → the corresponding method's row FAILS)", () =>
    withRollback(async (c) => {
      for (const method of CONSENT_METHODS) {
        const a = await account(c, `pm_${method}`);
        const actor = method === "staff" || method === "staff_undo" ? "user_1" : null;
        if (method === "free_text") {
          // free_text's own state rule needs a hold to land on, whatever the guard:
          const hold = await append(c, { account: a, action: "held", method: "free_text", guard: "if_allowed" });
          await append(c, { account: a, action: "revoked", method, actor, guard: "if_newest", expect: hold.event_id });
        } else {
          // Every other method's first write lands on a fresh (allowed) address under guard 'none':
          // 'staff' and 'backfill_0049' each require this to be true anyway (their own state rule),
          // and every other method has no state rule at all for 'revoked', so 'none' is the only way
          // to land the row this test needs regardless of which methods CUSTOMER_STOP_METHODS names.
          await append(c, { account: a, action: "revoked", method, actor, guard: "none" });
        }
        const again = await append(c, { account: a, action: "revoked", method: "keyword", guard: "unless_customer_stopped" });
        expect(again.outcome).toBe(CUSTOMER_STOP_METHODS.includes(method) ? "refused" : "appended");
      }
    }));
});

describe("0055 append_consent_event: spec §3's two rules and choice 19's staff rules, whatever the guard", () => {
  it("hold_released lands only on a held address — a keyword STOP that landed in between cannot be undone by a stale release (mutation: drop the hold_released rule → the release after the stop appends, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "hr");
      const hold = await append(c, { account: a, action: "held", method: "free_text" });
      const stop = await append(c, { account: a, action: "revoked", method: "keyword", guard: "unless_customer_stopped" });
      expect((await append(c, { account: a, action: "hold_released", method: "staff", actor: "user_1", guard: "none" })).outcome).toBe("refused");
      expect((await append(c, { account: a, action: "hold_released", method: "staff", actor: "user_1", guard: "if_newest", expect: hold.event_id })).outcome).toBe("refused");
      expect(stop.outcome).toBe("appended");
      const b = await account(c, "hr2");
      const h2 = await append(c, { account: b, action: "held", method: "free_text" });
      expect((await append(c, { account: b, action: "hold_released", method: "staff", actor: "user_1", guard: "if_newest", expect: h2.event_id })).outcome).toBe("appended");
    }));

  it("held lands only on an allowed address, or as a staff undo of a free-text confirmation or a release — never over a customer's keyword STOP (mutation: drop `v_prior_method = 'free_text'` → the undo over a keyword stop appends, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "hd");
      const kw = await append(c, { account: a, action: "revoked", method: "keyword" });
      expect((await append(c, { account: a, action: "held", method: "staff_undo", actor: "user_1", guard: "if_newest", expect: kw.event_id })).outcome).toBe("refused");
      const b = await account(c, "hd2");
      await append(c, { account: b, action: "held", method: "free_text" });
      const confirm = await append(c, { account: b, action: "revoked", method: "free_text", actor: "user_1", guard: "unless_customer_stopped" });
      expect((await append(c, { account: b, action: "held", method: "staff_undo", actor: "user_1", guard: "if_newest", expect: confirm.event_id })).outcome).toBe("appended");
    }));

  it("choice 19 at the write path: a staff stop lands only on an allowed address, a confirmed free-text stop only on a hold, a Resume only over a stop staff made, an Undo only over a staff stop — EVEN WHEN p_expect_id names the customer's own STOP (review R3-C1; mutation: delete any one of the four staff branches → its case appends, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "c19");
      const kw = await append(c, { account: a, action: "revoked", method: "keyword" });
      const overKw = [
        await append(c, { account: a, action: "revoked", method: "staff", actor: "user_1", guard: "if_newest", expect: kw.event_id }),
        await append(c, { account: a, action: "revoked", method: "free_text", actor: "user_1", guard: "if_newest", expect: kw.event_id }),
        await append(c, { account: a, action: "resubscribed", method: "staff", actor: "user_1", note: "asked", guard: "if_newest", expect: kw.event_id }),
        await append(c, { account: a, action: "resubscribed", method: "staff_undo", actor: "user_1", guard: "if_newest", expect: kw.event_id }),
      ];
      expect(overKw.map((o) => o.outcome)).toEqual(["refused", "refused", "refused", "refused"]);
      // Each of the four where it belongs appends:
      const b = await account(c, "c19b");
      const stop = await append(c, { account: b, action: "revoked", method: "staff", actor: "user_1", guard: "if_newest", expect: null });
      const undo = await append(c, { account: b, action: "resubscribed", method: "staff_undo", actor: "user_1", guard: "if_newest", expect: stop.event_id });
      const hold = await append(c, { account: b, action: "held", method: "free_text", guard: "if_allowed" });
      const confirm = await append(c, { account: b, action: "revoked", method: "free_text", actor: "user_1", guard: "if_newest", expect: hold.event_id });
      const resume = await append(c, { account: b, action: "resubscribed", method: "staff", actor: "user_1", note: "Customer asked on the phone", guard: "if_newest", expect: confirm.event_id });
      expect([stop, undo, hold, confirm, resume].map((o) => o.outcome)).toEqual(["appended", "appended", "appended", "appended", "appended"]);
      // A staff stop over a HOLD is refused too: a hold is decided by Confirm stop / Not a stop, never overwritten.
      const h2 = await append(c, { account: b, action: "held", method: "free_text", guard: "if_allowed" });
      expect((await append(c, { account: b, action: "revoked", method: "staff", actor: "user_1", guard: "if_newest", expect: h2.event_id })).outcome).toBe("refused");
    }));
});

describe("0055 append_consent_event: m1/m2 (review, orchestrator fixes made directly in 0055 since it is not applied anywhere yet)", () => {
  it("revoked/backfill_0049 lands only on an allowed address, exactly like a staff stop — never over an existing stop, whatever the guard (review m1, B1: before the fix, guard 'none' let a backfill land over a customer's keyword STOP, and staff could then Resume through it, bypassing choice 19; mutation: delete the `elsif p_action = 'revoked' and p_method = 'backfill_0049'` branch → the over-a-stop case appends, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "b1");
      const kw = await append(c, { account: a, action: "revoked", method: "keyword" });
      expect((await append(c, { account: a, action: "revoked", method: "backfill_0049", guard: "none" })).outcome).toBe("refused");
      expect((await append(c, { account: a, action: "revoked", method: "backfill_0049", guard: "unless_customer_stopped" })).outcome).toBe("refused");
      expect((await append(c, { account: a, action: "revoked", method: "backfill_0049", guard: "if_newest", expect: kw.event_id })).outcome).toBe("refused");
      // A fresh (allowed) address still gets it, and staff can still Resume it (unchanged rule, proven still true):
      const b = await account(c, "b1b");
      const backfill = await append(c, { account: b, action: "revoked", method: "backfill_0049", guard: "none" });
      expect(backfill.outcome).toBe("appended");
      expect((await append(c, { account: b, action: "resubscribed", method: "staff", actor: "user_1", note: "Customer asked", guard: "if_newest", expect: backfill.event_id })).outcome).toBe("appended");
    }));

  it("resubscribed is refused for every method outside start_keyword, staff, staff_undo and unsubscribe_page, whatever the guard — a stray method can never lift a stop (review m1, B2, R1-N10: before the fix, resubscribed/form under guard 'none' lifted a customer's keyword STOP, breaking choice 28 (\"a grant never lifts a stop\"); mutation: drop the `elsif p_action = 'resubscribed' and p_method not in (...)` branch → the 'form' case appends, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "b2");
      await append(c, { account: a, action: "revoked", method: "keyword" });
      const strayMethods = CONSENT_METHODS.filter((m) => !["start_keyword", "staff", "staff_undo", "unsubscribe_page"].includes(m));
      for (const method of strayMethods) {
        expect((await append(c, { account: a, action: "resubscribed", method, guard: "none" })).outcome).toBe("refused");
      }
      // The allow-list itself still works: start_keyword and unsubscribe_page need only their guard
      // (staff and staff_undo keep their own dedicated rules, proven in the describe block above).
      expect((await append(c, { account: a, action: "resubscribed", method: "start_keyword", guard: "if_stopped_or_held" })).outcome).toBe("appended");
      const b = await account(c, "b2b");
      await append(c, { account: b, action: "revoked", method: "keyword" });
      expect((await append(c, { account: b, action: "resubscribed", method: "unsubscribe_page", guard: "if_stopped_or_held" })).outcome).toBe("appended");
    }));

  it("a future p_occurred_at is refused outright, whatever the guard — a stop dated ahead of now can never outrank a real event that has not happened yet; a past time (every real backfill's own shape) still works (review m2, B11: a stop dated now+4 min would otherwise outrank a real START; mutation: drop `v_ok := v_ok and (p_occurred_at is null or p_occurred_at <= clock_timestamp())` → the future stop appends, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "b11");
      const future = new Date(Date.now() + 4 * 60 * 1000).toISOString();
      expect((await append(c, { account: a, action: "revoked", method: "backfill_telnyx", guard: "none", at: future })).outcome).toBe("refused");
      expect((await append(c, { account: a, action: "revoked", method: "backfill_telnyx", guard: "none", at: "2026-01-01T10:00:00Z" })).outcome).toBe("appended");
    }));
});

describe("0055 append_consent_event: order, idempotency and the lock", () => {
  it("rows written 2 ms apart in ONE transaction are ordered as written: occurred_at is clock_timestamp() after the lock, not now() (mutation: coalesce(p_occurred_at, now()) → both rows share the transaction's instant, the stop outranks the START, and the hold is refused, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "or");
      const one = await append(c, { account: a, action: "revoked", method: "keyword" });
      const two = await append(c, { account: a, action: "resubscribed", method: "start_keyword" });
      const { rows } = await c.query<{ id: string }>(
        "select id from consent_events where id in ($1, $2) order by occurred_at desc", [one.event_id, two.event_id]);
      expect(rows.map((r) => r.id)).toEqual([two.event_id, one.event_id]);
      expect((await append(c, { account: a, action: "held", method: "free_text", guard: "if_allowed" })).outcome).toBe("appended");
    }));

  it("the newest row is judged to the MILLISECOND, then by restrictiveness, as consentStateOf does in JavaScript: a resubscribe 0.3 ms after a stop in the same millisecond does NOT lift it (mutation: order by occurred_at itself → the resubscribe is newest and the second stop appends, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "ms");
      await append(c, { account: a, action: "revoked", method: "keyword", at: "2026-09-01T10:00:00.1231Z" });
      await append(c, { account: a, action: "resubscribed", method: "start_keyword", at: "2026-09-01T10:00:00.1234Z" });
      const probe = await append(c, { account: a, action: "revoked", method: "carrier_block", guard: "unless_customer_stopped" });
      expect(probe).toMatchObject({ outcome: "refused", prior_action: "revoked" });
    }));

  it("a second write from the same source is 'duplicate' with the FIRST row's id, and appends nothing; another action from the same source is its own row (mutation: drop the source_ref check → the unique index raises 23505 instead, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "du");
      const first = await append(c, { account: a, action: "revoked", method: "keyword", ref: "msg_1" });
      const again = await append(c, { account: a, action: "revoked", method: "keyword", ref: "msg_1" });
      expect(again).toEqual({ outcome: "duplicate", event_id: first.event_id, prior_id: null, prior_action: null, prior_method: null });
      const grant = await append(c, { account: a, action: "granted", method: "inbound_text", ref: "msg_1" });
      expect(grant.outcome).toBe("appended");
      const { rows: [n] } = await c.query<{ n: number }>("select count(*)::int as n from consent_events where account_id = $1", [a]);
      expect(n!.n).toBe(2);
    }));

  it("consent_events_source_once also refuses a direct duplicate insert (23505), so a write around the function cannot double a source (mutation: drop the index → the insert succeeds, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "ix");
      const insert = `insert into consent_events (account_id, channel, address, action, method, source_ref) values ($1, 'sms', $2, 'granted', 'form', 'sub_1')`;
      await c.query(insert, [a, ADDR]);
      expect(await refusedWith(c, insert, [a, ADDR])).toMatchObject({ code: "23505", constraint: "consent_events_source_once" });
    }));

  it("one address is written by one caller at a time: a second connection waits on the lock and times out, while another address does not wait (A2; mutation: drop pg_advisory_xact_lock → the second call on the same address returns at once, FAILS)", async () => {
    const holder = new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 });
    const waiter = new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 });
    await holder.connect();
    await waiter.connect();
    const acct = "00000000-0000-4000-8000-00000000c0de";   // never inserted: every call below is refused before any insert
    const call = `select outcome from public.append_consent_event($1, 'sms', $2, 'revoked', 'staff', 'if_newest', '00000000-0000-4000-8000-000000000001'::uuid, null, 'user_1', null, null, '{}'::jsonb, null)`;
    try {
      await holder.query("begin");
      await holder.query("set local role service_role");
      expect((await holder.query<{ outcome: string }>(call, [acct, ADDR])).rows[0]!.outcome).toBe("refused");
      await waiter.query("begin");
      await waiter.query("set local role service_role");
      await waiter.query("set local lock_timeout = '300ms'");
      const waited = await waiter.query(call, [acct, ADDR]).then(() => null, (e: unknown) => e);
      expect(waited).toMatchObject({ code: "55P03" });
      await waiter.query("rollback");
      await waiter.query("begin");
      await waiter.query("set local role service_role");
      await waiter.query("set local lock_timeout = '300ms'");
      expect((await waiter.query<{ outcome: string }>(call, [acct, "+19565550199"])).rows[0]!.outcome).toBe("refused");
    } finally {
      await waiter.query("rollback").catch(() => undefined);
      await holder.query("rollback").catch(() => undefined);
      await waiter.end();
      await holder.end();
    }
  });
});

describe("0055 tasks.consent_event_id", () => {
  it("is a nullable uuid, same-account by its composite key, one To-do per ledger row (mutation: a plain FK on consent_event_id → the crossed insert succeeds, FAILS; drop tasks_consent_event_once → the second To-do inserts, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "ta");
      const b = await account(c, "tb");
      const ev = await append(c, { account: a, action: "held", method: "free_text" });
      const { rows: [col] } = await c.query(
        `select data_type, is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'tasks' and column_name = 'consent_event_id'`);
      expect(col).toEqual({ data_type: "uuid", is_nullable: "YES" });
      const insert = "insert into tasks (account_id, title, consent_event_id) values ($1, 'x', $2)";
      expect(await refusedWith(c, insert, [b, ev.event_id])).toMatchObject({ code: "23503", constraint: "tasks_consent_event_fkey" });
      await c.query(insert, [a, ev.event_id]);
      expect(await refusedWith(c, insert, [a, ev.event_id])).toMatchObject({ code: "23505", constraint: "tasks_consent_event_once" });
      await c.query("insert into tasks (account_id, title) values ($1, 'plain')", [a]);
    }));
});
