import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * Staff and roles (spec §5, §7, §11). Owner-only capabilities are refused in
 * Postgres by RESTRICTIVE policies calling app.is_account_owner(). A refused
 * DELETE/UPDATE under RLS is not an error: the row is simply not matched, so
 * every refusal is asserted as rowCount 0 AND the row read back as the owner.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_roles_${RUN}`;
const SUB = {
  owner: `user_roles_owner_${RUN}`, staff: `user_roles_staff_${RUN}`,
  none: `user_roles_none_${RUN}`, removed: `user_roles_removed_${RUN}`,
} as const;
type Actor = keyof typeof SUB | "agency";
const claimsFor = (a: Actor) => (a === "agency" ? { app_role: "agency_admin", sub: `user_roles_agency_${RUN}` } : { org_id: ORG, sub: SUB[a] });

async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Roles Co',true) returning id",
    [agency!.id, ORG])).rows[0]!.id;
  const user = async (sub: string) => (await c.query<{ id: string }>(
    "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [sub])).rows[0]!.id;
  const [owner, staff, removed] = [await user(SUB.owner), await user(SUB.staff), await user(SUB.removed)];
  await user(SUB.none);
  await c.query(
    `insert into memberships (user_id, scope, account_id, role)
     values ($1,'account',$4,'owner'), ($2,'account',$4,'staff'), ($3,'account',$4,'owner')`, [owner, staff, removed, acct]);
  await c.query("delete from memberships where user_id = $1", [removed]); // removal deletes the row (spec §5)
  const contact = (await c.query<{ id: string }>(
    "insert into contacts (account_id, first_name) values ($1,'Del') returning id", [acct])).rows[0]!.id;
  const calendar = (await c.query<{ id: string }>(
    "insert into calendars (account_id, public_id) values ($1,$2) returning id", [acct, `roles-${RUN}`])).rows[0]!.id;
  const plan = (await c.query<{ id: string }>(
    `insert into plans (agency_id, name, monthly_price_cents, features, allowances, overage_cents, stripe_product_id, stripe_price_ids)
     values ($1, $2, 4900, '{"voice_receptionist":true,"web_concierge":true}', '{"voice_minutes":1,"sms":1,"ai_chats":1}', '{"voice_minutes":1,"sms":1,"ai_chats":1}', 'prod_roles',
             '{"base":"price_b","voice_minutes":"price_v","sms":"price_s","ai_chats":"price_a"}') returning id`,
    [agency!.id, `Roles ${RUN}`])).rows[0]!.id;
  await c.query("insert into account_billing (account_id, plan_id) values ($1,$2)", [acct, plan]);
  await c.query("insert into usage_events (account_id, meter, quantity, occurred_at, source_ref) values ($1,'sms',1,now(),$2)",
    [acct, `message:roles-${RUN}`]);
  return { acct, contact, calendar };
}

const ALLOWED: Record<Actor, boolean> = { owner: true, staff: false, none: false, removed: false, agency: true };

describe("owner-only capabilities, by actor (mutation: drop any one restrictive policy -> the staff row for that surface FAILS)", () => {
  for (const actor of Object.keys(ALLOWED) as Actor[]) {
    const n = ALLOWED[actor] ? 1 : 0;
    it(`${actor}: contact delete matches ${n}`, () => withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor(actor));
      expect((await c.query("delete from contacts where id = $1", [s.contact])).rowCount).toBe(n);
      await c.query("reset role");
      expect((await c.query("select 1 from contacts where id = $1", [s.contact])).rowCount).toBe(1 - n);
    }));
    it(`${actor}: calendar settings update matches ${n}`, () => withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor(actor));
      expect((await c.query("update calendars set buffer_minutes = 15, updated_at = now() where id = $1", [s.calendar])).rowCount).toBe(n);
      await c.query("reset role");
      // buffer_minutes defaults to 0, so 15 is only there if the update landed.
      const { rows: [cal] } = await c.query<{ buffer_minutes: number }>("select buffer_minutes from calendars where id = $1", [s.calendar]);
      expect(cal!.buffer_minutes).toBe(n ? 15 : 0);
    }));
    it(`${actor}: account_billing and usage_events read ${n} row(s) each`, () => withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor(actor));
      expect((await c.query("select 1 from account_billing where account_id = $1", [s.acct])).rowCount).toBe(n);
      expect((await c.query("select 1 from usage_events where account_id = $1", [s.acct])).rowCount).toBe(n);
    }));
  }
});

describe("Staff keeps the working surfaces (mutation: make a restrictive policy FOR ALL -> FAILS)", () => {
  it("staff still reads and updates contacts and reads the calendar", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("staff"));
    expect((await c.query("update contacts set first_name = 'Kept' where id = $1", [s.contact])).rowCount).toBe(1);
    expect((await c.query("select 1 from calendars where id = $1", [s.calendar])).rowCount).toBe(1);
  }));
});

describe("the NULL guard (memory: plpgsql NULL guard)", () => {
  it("is_account_owner is FALSE, never NULL, for a client token with no membership (mutation: drop either coalesce -> FAILS with null)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor("none"));
      const { rows: [r] } = await c.query("select app.is_account_owner($1) as o, app.account_role($1) as r", [s.acct]);
      expect(r).toEqual({ o: false, r: null });
    }));
  it("a token with an org claim but no sub at all is refused (mutation: account_role matches any member of the account, ignoring sub -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, { org_id: ORG });
    expect((await c.query("delete from contacts where id = $1", [s.contact])).rowCount).toBe(0);
  }));
  it("a member of ANOTHER account is not an owner here (mutation: drop the account_id predicate in account_role -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
      const other = (await c.query<{ id: string }>(
        "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Other',true) returning id",
        [agency!.id, `${ORG}_b`])).rows[0]!.id;
      await actAs(c, claimsFor("owner"));
      const { rows: [r] } = await c.query("select app.is_account_owner($1) as here, app.is_account_owner($2) as there", [s.acct, other]);
      expect(r).toEqual({ here: true, there: false });
    }));
});

/**
 * The owner check is pinned to the account the token is in, not only to "is an Owner somewhere".
 * Today the permissive tenant policy also pins it, so to see the restrictive policy's own predicate
 * each case adds, inside the rolled-back transaction, a deliberately broad permissive policy (the
 * kind a later migration could add by mistake). The caller is an Owner of BOTH accounts, with a
 * token for the first; the second account's row must stay out of reach.
 */
describe("owner-only policies are pinned to the token's account (defence in depth)", () => {
  async function ownerOfTwo(c: Client) {
    const s = await seed(c);
    const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
    const b = (await c.query<{ id: string }>(
      "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Roles B',true) returning id",
      [agency!.id, `${ORG}_two`])).rows[0]!.id;
    await c.query(
      "insert into memberships (user_id, scope, account_id, role) select id, 'account', $2, 'owner' from users where clerk_user_id = $1",
      [SUB.owner, b]);
    const contact = (await c.query<{ id: string }>("insert into contacts (account_id, first_name) values ($1,'Bea') returning id", [b])).rows[0]!.id;
    const calendar = (await c.query<{ id: string }>(
      "insert into calendars (account_id, public_id) values ($1,$2) returning id", [b, `roles-two-${RUN}`])).rows[0]!.id;
    const { rows: [plan] } = await c.query<{ plan_id: string }>("select plan_id from account_billing where account_id = $1", [s.acct]);
    await c.query("insert into account_billing (account_id, plan_id) values ($1,$2)", [b, plan!.plan_id]);
    await c.query("insert into usage_events (account_id, meter, quantity, occurred_at, source_ref) values ($1,'sms',1,now(),$2)",
      [b, `message:roles-two-${RUN}`]);
    return { b, contact, calendar };
  }
  // FOR ALL, not FOR DELETE/UPDATE: a DELETE or UPDATE with a WHERE only reaches rows the SELECT
  // policies show, so a broad policy that is not also a SELECT policy would grant nothing to test.
  const broad = (table: string) =>
    `create policy zz_broad_${table} on public.${table} for all to authenticated using (true) with check (true)`;

  it("contacts: an Owner of both cannot delete the other account's contact (mutation: drop the account_id predicate from contacts_owner_delete -> FAILS)", () =>
    withRollback(async (c) => {
      const t = await ownerOfTwo(c);
      await c.query(broad("contacts"));
      await actAs(c, claimsFor("owner"));
      expect((await c.query("delete from contacts where id = $1", [t.contact])).rowCount).toBe(0);
    }));
  it("calendars: an Owner of both cannot change the other account's calendar settings (mutation: drop the account_id predicate from calendars_owner_update -> FAILS)", () =>
    withRollback(async (c) => {
      const t = await ownerOfTwo(c);
      await c.query(broad("calendars"));
      await actAs(c, claimsFor("owner"));
      expect((await c.query("update calendars set buffer_minutes = 15 where id = $1", [t.calendar])).rowCount).toBe(0);
    }));
  it("billing: an Owner of both reads neither the other account's billing row nor its usage (mutation: drop the account_id predicate from account_billing_owner_read or usage_events_owner_read -> FAILS)", () =>
    withRollback(async (c) => {
      const t = await ownerOfTwo(c);
      await c.query(broad("account_billing"));
      await c.query(broad("usage_events"));
      await actAs(c, claimsFor("owner"));
      const billing = await c.query("select 1 from account_billing where account_id = $1", [t.b]);
      const usage = await c.query("select 1 from usage_events where account_id = $1", [t.b]);
      expect([billing.rowCount, usage.rowCount]).toEqual([0, 0]);
    }));
});

describe("team visibility (spec §5 grants)", () => {
  // The none and removed users exist with no membership here: they are the rows a wrong policy would leak.
  it("a client reads its own company's memberships and users, nothing else (mutation: users_member_read USING (true) -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor("staff"));
      const { rows } = await c.query<{ clerk_user_id: string }>("select clerk_user_id from users order by 1");
      expect(rows.map((r) => r.clerk_user_id).sort()).toEqual([SUB.owner, SUB.staff].sort());
      const { rows: m } = await c.query<{ account_id: string; role: string }>("select account_id, role from memberships order by role");
      expect(m).toEqual([{ account_id: s.acct, role: "owner" }, { account_id: s.acct, role: "staff" }]);
    }));
  // ONE refused statement per withRollback: after the first refusal the transaction is aborted (25P02).
  it("a client cannot write memberships (mutation: grant update on memberships to authenticated -> FAILS, matches 0 rows instead)", () =>
    withRollback(async (c) => {
      await seed(c);
      await actAs(c, claimsFor("owner"));
      await expect(c.query("update memberships set role = 'owner'"))
        .rejects.toMatchObject({ code: "42501", message: "permission denied for table memberships" });
    }));
  it("a client cannot write users (mutation: grant insert on users to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      await seed(c);
      await actAs(c, claimsFor("owner"));
      // The message, not just 42501: with the grant back, RLS still refuses the insert with 42501 (no insert policy).
      await expect(c.query("insert into users (clerk_user_id, email) values ('x','x@example.com')"))
        .rejects.toMatchObject({ code: "42501", message: "permission denied for table users" });
    }));
  it("users.language accepts en, es and NULL only (mutation: drop the check -> FAILS)", () => withRollback(async (c) => {
    await c.query("insert into users (clerk_user_id, email, language) values ($1, 'l@example.com', 'es')", [`user_lang_${RUN}`]);
    await expect(c.query("insert into users (clerk_user_id, email, language) values ($1, 'f@example.com', 'fr')", [`user_lang_fr_${RUN}`]))
      .rejects.toMatchObject({ code: "23514" });
  }));
  it("memberships.role is owner|staff only (mutation: keep 'admin' in the check -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    const u = (await c.query<{ id: string }>("insert into users (clerk_user_id, email) values ($1,'a@example.com') returning id", [`user_admin_${RUN}`])).rows[0]!.id;
    await expect(c.query("insert into memberships (user_id, scope, account_id, role) values ($1,'account',$2,'admin')", [u, s.acct]))
      .rejects.toMatchObject({ code: "23514" });
  }));
});
