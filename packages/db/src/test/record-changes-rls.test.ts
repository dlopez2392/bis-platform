import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";

/**
 * 0111_record_changes.sql: who reads the change log (spec 9 Q2: Owners, Staff and the agency; Technicians none).
 * record_changes_read is events_read (0109's InitPlan form) renamed; record_changes_technician_none is 0068's
 * events_technician_none renamed.
 * RED BEFORE APPLY: every case, legitimately (public.record_changes does not exist). Replica only (withRollback).
 */
const RUN = Math.random().toString(36).slice(2, 10);
type Acct = { accountId: string; orgId: string; contactId: string };

/** An account with one contact and that contact's change rows: its insert (as the owner) and one edit by an Owner. */
async function seed(c: Client, label: string): Promise<Acct> {
  await actAsOwner(c);
  const orgId = `org_rc_rls_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Record changes RLS') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Record changes RLS', true) returning id`, [agency!.id, orgId]);
  const { rows: [ct] } = await c.query<{ id: string }>(
    "insert into public.contacts (account_id, first_name, phone, author_kind) values ($1, 'Rls', '+19565550123', 'person') returning id",
    [account!.id]);
  const a = { accountId: account!.id, orgId, contactId: ct!.id };
  await actAsMember(c, a.accountId, a.orgId, "owner");
  await c.query("update public.contacts set phone = '+19565550124' where id = $1", [a.contactId]);
  await actAsOwner(c);
  return a;
}
/** What the current caller reads, per account. */
async function visible(c: Client, a: Acct, b: Acct) {
  const { rows } = await c.query<{ account_id: string; n: number }>(
    "select account_id, count(*)::int as n from public.record_changes where account_id = any($1::uuid[]) group by account_id",
    [[a.accountId, b.accountId]]);
  const n = (id: string) => rows.find((r) => r.account_id === id)?.n ?? 0;
  return { a: n(a.accountId), b: n(b.accountId) };
}

describe("0111: record_changes RLS", () => {
  it("an Owner reads their own account's rows and none of another account's", () =>
    withRollback(async (c) => {
      const a = await seed(c, "own_a");
      const b = await seed(c, "own_b");
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect(await visible(c, a, b)).toEqual({ a: 2, b: 0 });
    }));

  it("Staff read the account's rows", () =>
    withRollback(async (c) => {
      const a = await seed(c, "staff_a");
      const b = await seed(c, "staff_b");
      await actAsMember(c, a.accountId, a.orgId, "staff");
      expect(await visible(c, a, b)).toEqual({ a: 2, b: 0 });
    }));

  it("a Technician reads none, even for a contact assigned to them (mutation: drop record_changes_technician_none -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seed(c, "tech_a");
      const b = await seed(c, "tech_b");
      const sub = await actAsMember(c, a.accountId, a.orgId, "technician");
      await actAsOwner(c);
      const { rows: [u] } = await c.query<{ id: string }>("select id from public.users where clerk_user_id = $1", [sub]);
      await c.query("update public.contacts set assigned_to = $2 where id = $1", [a.contactId, u!.id]);
      await actAs(c, { org_id: a.orgId, sub });
      // The control: the Technician does see the contact itself (contacts_technician_scope), so the zero below is
      // the history's own fence, not a contact they cannot reach.
      const { rows: seen } = await c.query("select id from public.contacts where id = $1", [a.contactId]);
      expect(seen).toHaveLength(1);
      expect(await visible(c, a, b)).toEqual({ a: 0, b: 0 });
    }));

  it("a signed-in client with no membership reads none", () =>
    withRollback(async (c) => {
      const a = await seed(c, "nomember_a");
      const b = await seed(c, "nomember_b");
      await actAs(c, { org_id: a.orgId, sub: `user_rc_nobody_${RUN}` });
      expect(await visible(c, a, b)).toEqual({ a: 0, b: 0 });
    }));

  it("the agency reads every account's rows", () =>
    withRollback(async (c) => {
      const a = await seed(c, "agency_a");
      const b = await seed(c, "agency_b");
      await actAs(c, { app_role: "agency_admin", sub: `u_rc_agency_${RUN}` });
      expect(await visible(c, a, b)).toEqual({ a: 2, b: 2 });
    }));

  it("anon reads nothing: no grant at all (42501)", () =>
    withRollback(async (c) => {
      await seed(c, "anon");
      await c.query("set local role anon");
      await expect(c.query("select count(*) from public.record_changes")).rejects.toMatchObject({ code: "42501" });
    }));
});
