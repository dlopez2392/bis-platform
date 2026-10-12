import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * 0072 (S-02 follow-up G9): contacts.company_name is read-only. The client
 * role lost UPDATE (company_name); a before insert or update trigger puts
 * any direct write back to the derived value (app.company_name_for), so only
 * the group sync (0069 section 6) decides it; reconcile_business_groups() is
 * gone. As the table owner inside a rolled-back transaction.
 */
const RUN = Math.random().toString(36).slice(2, 10);

// Local to this file on purpose: importing one test file from another would register its tests twice.
async function seedAccount(c: Client, org: string) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const { rows: [a] } = await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Read Only Co',true) returning id",
    [agency!.id, org]);
  return a!.id;
}
const contact = async (c: Client, acct: string, first: string) =>
  (await c.query<{ id: string }>("insert into contacts (account_id, first_name) values ($1,$2) returning id", [acct, first])).rows[0]!.id;
const group = async (c: Client, acct: string, kind: string, name: string) =>
  (await c.query<{ id: string }>(
    "insert into client_groups (account_id, kind, name) values ($1,$2,$3) returning id", [acct, kind, name])).rows[0]!.id;
const member = async (c: Client, acct: string, g: string, ct: string, primary = false) =>
  (await c.query<{ id: string }>(
    "insert into client_group_members (account_id, client_group_id, contact_id, is_primary) values ($1,$2,$3,$4) returning id",
    [acct, g, ct, primary])).rows[0]!.id;
const companyOf = async (c: Client, ct: string) =>
  (await c.query<{ company_name: string | null }>("select company_name from contacts where id = $1", [ct])).rows[0]!.company_name;
const call = async (c: Client, sql: string, args: unknown[]) => (await c.query<{ r: unknown }>(`select ${sql} as r`, args)).rows[0]!.r;

/**
 * What a build from before 0072 could leave in the column: a value the sync never set (the over-long
 * names reconcile skipped, 0069 section 8). 0072 makes that unwritable, so the test lifts the trigger
 * for one statement, as the table owner, inside the rolled-back transaction.
 */
async function legacyWrite(c: Client, ct: string, value: string | null) {
  await c.query("alter table public.contacts disable trigger contacts_company_name_derived");
  await c.query("update contacts set company_name = $2 where id = $1", [ct, value]);
  await c.query("alter table public.contacts enable trigger contacts_company_name_derived");
}

/** One statement expected to fail, inside a savepoint so the transaction survives for the next one. */
async function refused(c: Client, run: () => Promise<unknown>): Promise<unknown> {
  await c.query("savepoint probe");
  try {
    await run();
    return null;
  } catch (e) {
    return e;
  } finally {
    await c.query("rollback to savepoint probe");
  }
}

describe("0072: the client role cannot write company_name", () => {
  it("authenticated is refused UPDATE (company_name) with 42501, while the same caller still updates first_name (mutation: grant update (company_name) back -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_ro_${RUN}`);
      const ct = await contact(c, a, "Ana");
      await actAs(c, { app_role: "agency_admin", sub: `user_ro_agency_${RUN}` });
      // Positive control first: the row is visible and writable to this caller, so a refusal below is the grant.
      expect((await c.query("update contacts set first_name = 'Ana Maria' where id = $1", [ct])).rowCount).toBe(1);
      expect(await refused(c, () => c.query("update contacts set company_name = 'Acme Roofing' where id = $1", [ct])))
        .toMatchObject({ code: "42501", message: "permission denied for table contacts" });
    }));

  it("neither anon nor authenticated holds UPDATE on company_name; first_name stays the control", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select r as role,
                has_column_privilege(r, 'public.contacts', 'company_name', 'UPDATE') as company_name,
                has_column_privilege(r, 'public.contacts', 'first_name', 'UPDATE') as first_name
           from unnest(array['anon','authenticated']) r order by r`);
      expect(rows).toEqual([
        { role: "anon", company_name: false, first_name: false },
        { role: "authenticated", company_name: false, first_name: true },
      ]);
    }));
});

describe("0072: a direct write ends at the derived value, for every role", () => {
  it("the table owner's direct UPDATE is put back to the contact's business, and to NULL without one (mutation: drop trigger contacts_company_name_derived -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_ro_${RUN}`);
      const ct = await contact(c, a, "Ana");
      await member(c, a, await group(c, a, "business", "Acme Roofing"), ct, true);
      expect(await companyOf(c, ct)).toBe("Acme Roofing"); // positive control: the sync set it
      await c.query("update contacts set company_name = 'Beta Pools' where id = $1", [ct]);
      expect(await companyOf(c, ct)).toBe("Acme Roofing");
      await c.query("update contacts set company_name = null where id = $1", [ct]);
      expect(await companyOf(c, ct)).toBe("Acme Roofing");
      const lone = await contact(c, a, "Luis");
      await c.query("update contacts set company_name = 'Beta Pools' where id = $1", [lone]);
      expect(await companyOf(c, lone)).toBeNull();
    }));

  it("service_role's direct UPDATE is put back too: only the sync sets the column", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_ro_${RUN}`);
      const ct = await contact(c, a, "Ana");
      await member(c, a, await group(c, a, "business", "Acme Roofing"), ct, true);
      await c.query("set local role service_role");
      expect((await c.query("update contacts set company_name = 'Beta Pools' where id = $1", [ct])).rowCount).toBe(1);
      expect(await companyOf(c, ct)).toBe("Acme Roofing");
    }));

  it("the owner's insert carrying company_name starts at the derived value: NULL for a new contact", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_ro_${RUN}`);
      const { rows: [own] } = await c.query<{ company_name: string | null }>(
        "insert into contacts (account_id, first_name, company_name) values ($1,'Ana','Acme Roofing') returning company_name", [a]);
      expect(own).toEqual({ company_name: null });
    }));

  // Its own transaction, and the trigger's FIRST firing in it: plpgsql builds a simple expression once per
  // transaction and checks EXECUTE on app.company_name_for only then, so an owner insert earlier in the
  // same transaction would let an invoker function pass here (measured on the replica, 2026-10-12).
  it("the client role's insert carrying company_name is accepted and starts NULL (mutation: drop security definer from app.company_name_derived -> FAILS 42501)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_ro_${RUN}`);
      await actAs(c, { app_role: "agency_admin", sub: `user_ro_agency_${RUN}` });
      const { rows: [theirs] } = await c.query<{ company_name: string | null }>(
        "insert into contacts (account_id, first_name, company_name) values ($1,'Luis','Beta Pools') returning company_name", [a]);
      expect(theirs).toEqual({ company_name: null });
    }));

  it("an upsert that lands on an existing contact ends at that contact's business, whatever it sent", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_ro_${RUN}`);
      const ct = await contact(c, a, "Ana");
      await member(c, a, await group(c, a, "business", "Acme Roofing"), ct, true);
      await c.query(
        `insert into contacts (id, account_id, first_name, company_name) values ($1,$2,'Ana','Beta Pools')
           on conflict (id) do update set company_name = excluded.company_name, first_name = excluded.first_name`, [ct, a]);
      expect(await companyOf(c, ct)).toBe("Acme Roofing");
      await c.query(
        `insert into contacts (id, account_id, first_name, company_name) values ($1,$2,'Ana',null)
           on conflict (id) do update set company_name = excluded.company_name`, [ct, a]);
      expect(await companyOf(c, ct)).toBe("Acme Roofing");
    }));
});

describe("0072: the group sync still decides the column", () => {
  it("add, main swap, rename, set_contacts_business and remove each still land in company_name (mutation: make the trigger keep the old value -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_ro_${RUN}`);
      const ct = await contact(c, a, "Ana");
      const acme = await group(c, a, "business", "Acme Roofing");
      const mAcme = await member(c, a, acme, ct, true);
      expect(await companyOf(c, ct)).toBe("Acme Roofing");
      const beta = await group(c, a, "business", "Beta Pools");
      const mBeta = await member(c, a, beta, ct);
      // Two statements: client_group_members_one_primary is checked row by row.
      await c.query("update client_group_members set is_primary = false where contact_id = $1", [ct]);
      await c.query("update client_group_members set is_primary = true where id = $1", [mBeta]);
      expect(await companyOf(c, ct)).toBe("Beta Pools");
      await c.query("update client_groups set name = 'Beta Pools & Spas' where id = $1", [beta]);
      expect(await companyOf(c, ct)).toBe("Beta Pools & Spas");
      await c.query("set local role service_role");
      const [r] = await call(c, "public.set_contacts_business($1,$2::uuid[],$3::text[])", [a, [ct], ["Gamma Lawn"]]) as Array<{ status: string }>;
      expect(r!.status).toBe("ok");
      expect(await companyOf(c, ct)).toBe("Gamma Lawn");
      await c.query("reset role");
      await c.query("delete from client_group_members where contact_id = $1 and id <> $2", [ct, mAcme]);
      expect(await companyOf(c, ct)).toBe("Acme Roofing");
      await c.query("delete from client_group_members where id = $1", [mAcme]);
      expect(await companyOf(c, ct)).toBeNull();
    }));
});

describe("0072: a value the sync never set is kept until something writes the column", () => {
  // Owner-visible behaviour, pinned: a stored value reconcile skipped (over 120 characters) survives every
  // write that does not change company_name, including one that sends the same value back and a household
  // change; a write that does change it ends at the derived value (NULL here, or the business's name).
  // A bare `before insert or update` (no OF company_name) cannot fail this test: the function's own
  // unchanged-value check also keeps the value on an unrelated edit. The trigger-definition pin below
  // catches that mutation instead.
  it("an unrelated edit, a same-value write and a household add leave it exactly as stored (mutation: recompute even when the value is unchanged -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_ro_${RUN}`);
      const ct = await contact(c, a, "Lo");
      const long = "L".repeat(130);
      await legacyWrite(c, ct, long);
      expect(await companyOf(c, ct)).toBe(long); // positive control: the legacy value is there
      await c.query("update contacts set first_name = 'Lola', updated_at = now() where id = $1", [ct]);
      expect(await companyOf(c, ct)).toBe(long);
      await c.query("update contacts set company_name = company_name, last_name = 'Q' where id = $1", [ct]);
      expect(await companyOf(c, ct)).toBe(long);
      await member(c, a, await group(c, a, "household", "Garcia"), ct, true);
      expect(await companyOf(c, ct)).toBe(long);
    }));

  it("a write that changes it ends at the derived value", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_ro_${RUN}`);
      const lone = await contact(c, a, "Lo");
      const withBiz = await contact(c, a, "Bea");
      await member(c, a, await group(c, a, "business", "Acme Roofing"), withBiz, true);
      await legacyWrite(c, lone, "L".repeat(130));
      await legacyWrite(c, withBiz, "Q".repeat(130));
      expect(await companyOf(c, withBiz)).toBe("Q".repeat(130)); // positive control
      await c.query("update contacts set company_name = 'Other' where id = any($1::uuid[])", [[lone, withBiz]]);
      expect(await companyOf(c, lone)).toBeNull();
      expect(await companyOf(c, withBiz)).toBe("Acme Roofing");
    }));
});

describe("0072: the objects", () => {
  it("the trigger fires before insert or update OF company_name only, and its function is a definer with an empty search_path executable by service_role only (mutation: bare `before insert or update` -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [t] } = await c.query<{ def: string | null }>(
        `select (select pg_get_triggerdef(oid) from pg_trigger
                  where tgrelid = 'public.contacts'::regclass and tgname = 'contacts_company_name_derived') as def`);
      expect(t!.def).toBe(
        "CREATE TRIGGER contacts_company_name_derived BEFORE INSERT OR UPDATE OF company_name ON public.contacts " +
        "FOR EACH ROW EXECUTE FUNCTION app.company_name_derived()");
      const { rows } = await c.query(
        `select p.prosecdef as definer, p.proconfig::text as config,
                has_function_privilege('service_role', p.oid, 'execute') as svc,
                has_function_privilege('authenticated', p.oid, 'execute') as auth,
                has_function_privilege('anon', p.oid, 'execute') as anon
           from pg_proc p where p.oid = to_regprocedure('app.company_name_derived()')`);
      expect(rows).toEqual([{ definer: true, config: '{"search_path=\\"\\""}', svc: true, auth: false, anon: false }]);
    }));

  it("reconcile_business_groups is gone, and every helper it shared with the write functions is still there (mutation: recreate it from 0069 section 8 -> FAILS; mutation: drop app.promote_primary -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ f: string; present: boolean }>(
        `select f, to_regprocedure(f) is not null as present from unnest($1::text[]) as f`,
        [["public.reconcile_business_groups(uuid)", "app.lock_contact(uuid,uuid)", "app.promote_primary(uuid)",
          "app.link_member(uuid,uuid,uuid,text,boolean)", "app.find_or_create_business(uuid,text)",
          "app.company_name_for(uuid)", "app.group_name_key(text)", "app.group_ws()", "app.sync_company_name()"]]);
      expect(Object.fromEntries(rows.map((r) => [r.f, r.present]))).toEqual({
        "public.reconcile_business_groups(uuid)": false,
        "app.lock_contact(uuid,uuid)": true, "app.promote_primary(uuid)": true,
        "app.link_member(uuid,uuid,uuid,text,boolean)": true, "app.find_or_create_business(uuid,text)": true,
        "app.company_name_for(uuid)": true, "app.group_name_key(text)": true, "app.group_ws()": true,
        "app.sync_company_name()": true,
      });
    }));
});
