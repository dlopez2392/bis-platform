import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback } from "./db";
import { CONSENT_METHODS } from "../consent";

/**
 * 0062 (D-016): a hard bounce or a spam complaint is a consent-ledger STOP on
 * the email channel, written through 0055's one write path. withRollback
 * only, so it runs on the local PG18 replica (`pre` / `post`) as well as on
 * the CI project.
 *
 * RED BEFORE APPLY (the replica's `pre`): every test here. The two methods
 * are not in consent_events_method_check yet, so each append raises 23514
 * naming THAT constraint, the shape test finds the wrong constraint name, and
 * the parity test finds the TypeScript list two methods longer than the
 * database's.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ADDR = "dan@example.com";

async function account(c: Client, label: string): Promise<string> {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  return (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name) values ($1, $2, $3) returning id",
    [agency!.id, `org_SUP_${label}_${RUN}`, `Suppression ${label}`])).rows[0]!.id;
}

type Out = { outcome: string; event_id: string | null; prior_action: string | null; prior_method: string | null };

/** One call of 0055's function on the EMAIL channel, as service_role (its only grantee). The 2 ms sleep keeps
 *  consecutive calls in different milliseconds (consent-writes-schema.test.ts's own reason). Inside a
 *  savepoint, so a refusal by a CHECK surfaces as ITSELF (23514 naming the constraint) rather than as the
 *  25P02 the next statement would meet in an aborted transaction. */
async function append(c: Client, a: {
  account: string; action: string; method: string; guard?: string; expect?: string | null;
  ref?: string | null; actor?: string | null; note?: string | null;
}): Promise<Out> {
  await c.query("select pg_sleep(0.002)");
  await c.query("savepoint call");
  try {
    await c.query("set local role service_role");
    const { rows: [row] } = await c.query<Out>(
      `select outcome, event_id, prior_action, prior_method
         from public.append_consent_event($1, 'email', $2, $3, $4, $5, $6, null, $7, $8, $9, '{}'::jsonb, null)`,
      [a.account, ADDR, a.action, a.method, a.guard ?? "none", a.expect ?? null, a.actor ?? null, a.note ?? null, a.ref ?? null]);
    await c.query("reset role");
    await c.query("release savepoint call");
    return row!;
  } catch (e) {
    await c.query("rollback to savepoint call");
    throw e;
  }
}

/** One statement expected to fail, inside a savepoint so the transaction survives. */
async function refused(c: Client, sql: string, p: unknown[]): Promise<unknown> {
  await c.query("savepoint probe");
  try {
    await c.query(sql, p);
    return null;
  } catch (e) {
    return e;
  } finally {
    await c.query("rollback to savepoint probe");
  }
}

const INSERT = "insert into consent_events (account_id, channel, address, action, method) values ($1, $2, $3, $4, $5)";

describe("0062 email_bounce / email_complaint: what the ledger accepts", () => {
  it("a hard bounce and a complaint each land as a revoked email row through append_consent_event (mutation: leave either method out of consent_events_method_check → 23514, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "land");
      expect(await append(c, { account: a, action: "revoked", method: "email_bounce", ref: "email_bounce:m1" }))
        .toMatchObject({ outcome: "appended", prior_action: null });
      expect(await append(c, { account: a, action: "revoked", method: "email_complaint", ref: "email_complaint:m2" }))
        .toMatchObject({ outcome: "appended", prior_action: "revoked", prior_method: "email_bounce" });
      const { rows } = await c.query("select channel, address, action, method, source_ref from consent_events where account_id = $1 order by occurred_at", [a]);
      expect(rows).toEqual([
        { channel: "email", address: ADDR, action: "revoked", method: "email_bounce", source_ref: "email_bounce:m1" },
        { channel: "email", address: ADDR, action: "revoked", method: "email_complaint", source_ref: "email_complaint:m2" },
      ]);
    }));

  it("both methods are email STOPS only: on the sms channel, or as any action but revoked, the row is refused naming consent_events_suppression_shape_check (mutation: drop that constraint → the sms bounce inserts, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "shape");
      const shape = { code: "23514", constraint: "consent_events_suppression_shape_check" };
      expect(await refused(c, INSERT, [a, "sms", "+19562921696", "revoked", "email_bounce"])).toMatchObject(shape);
      expect(await refused(c, INSERT, [a, "email", ADDR, "granted", "email_complaint"])).toMatchObject(shape);
      expect(await refused(c, INSERT, [a, "email", ADDR, "held", "email_bounce"])).toMatchObject(shape);
      // The shape the webhook writes is accepted, and an unrelated method on sms is untouched:
      await c.query(INSERT, [a, "email", ADDR, "revoked", "email_complaint"]);
      await c.query(INSERT, [a, "sms", "+19562921696", "revoked", "keyword"]);
    }));

  it("consent.ts's CONSENT_METHODS is exactly the method CHECK's list, read from the live constraint (the TypeScript twin; mutation: drop 'email_complaint' from either side → FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [r] } = await c.query<{ def: string }>(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'consent_events_method_check' and conrelid = 'public.consent_events'::regclass");
      const fromDb = [...r!.def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]!);
      expect([...fromDb].sort()).toEqual([...CONSENT_METHODS].sort());
    }));
});

describe("0062 through 0055's rules: who records a suppression and who lifts it", () => {
  it("a bounce lands OVER the customer's own unsubscribe under guard none (unless_customer_stopped would refuse it there, which is why recordEmailSuppression uses none), so it is recorded whatever stopped the address first; a retry of the same webhook (same source_ref) is a duplicate, not a second row (mutation: give email_bounce the staff stop's 'allowed address only' rule in append_consent_event → refused over one_click, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "over");
      await append(c, { account: a, action: "revoked", method: "one_click", guard: "unless_customer_stopped" });
      expect((await append(c, { account: a, action: "revoked", method: "email_bounce", guard: "unless_customer_stopped", ref: "email_bounce:m8" })).outcome).toBe("refused");
      const first = await append(c, { account: a, action: "revoked", method: "email_bounce", ref: "email_bounce:m9" });
      expect(first).toMatchObject({ outcome: "appended", prior_method: "one_click" });
      const retry = await append(c, { account: a, action: "revoked", method: "email_bounce", ref: "email_bounce:m9" });
      expect(retry).toMatchObject({ outcome: "duplicate", event_id: first.event_id });
      const { rows: [n] } = await c.query<{ n: number }>("select count(*)::int as n from consent_events where account_id = $1 and method = 'email_bounce'", [a]);
      expect(n!.n).toBe(1);
    }));

  it("staff cannot lift a bounce or a complaint: a staff Resume and a staff undo are refused over either, and a staff stop cannot land on top (choice 19's lists in 0055 do not name them; mutation: add email_bounce to the staff Resume list → the Resume appends, FAILS)", () =>
    withRollback(async (c) => {
      for (const method of ["email_bounce", "email_complaint"]) {
        const a = await account(c, `staff_${method}`);
        const stop = await append(c, { account: a, action: "revoked", method, ref: `${method}:s1` });
        expect(stop.outcome).toBe("appended");
        expect((await append(c, { account: a, action: "resubscribed", method: "staff", actor: "user_1", note: "Customer called", guard: "if_newest", expect: stop.event_id })).outcome).toBe("refused");
        expect((await append(c, { account: a, action: "resubscribed", method: "staff_undo", actor: "user_1", guard: "if_newest", expect: stop.event_id })).outcome).toBe("refused");
        expect((await append(c, { account: a, action: "revoked", method: "staff", actor: "user_1", guard: "if_newest", expect: stop.event_id })).outcome).toBe("refused");
      }
    }));

  it("the customer's own resubscribe (unsubscribe_page, if_stopped_or_held) lifts a bounce and a complaint, the same way it lifts an unsubscribe (mutation: refuse resubscribed over email_bounce → FAILS)", () =>
    withRollback(async (c) => {
      for (const method of ["email_bounce", "email_complaint"]) {
        const a = await account(c, `lift_${method}`);
        await append(c, { account: a, action: "revoked", method, ref: `${method}:l1` });
        expect(await append(c, { account: a, action: "resubscribed", method: "unsubscribe_page", guard: "if_stopped_or_held" }))
          .toMatchObject({ outcome: "appended", prior_action: "revoked", prior_method: method });
      }
    }));

  it("a resubscribe written WITH a suppression method is refused, whatever the guard: only the customer's own methods lift (0055's stray-method branch; mutation: let resubscribed/email_bounce through → appended, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "stray");
      await append(c, { account: a, action: "revoked", method: "one_click", guard: "unless_customer_stopped" });
      expect((await append(c, { account: a, action: "resubscribed", method: "email_bounce", guard: "none" })).outcome).toBe("refused");
    }));
});
