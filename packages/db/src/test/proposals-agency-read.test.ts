import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { withRollback } from "./db";

/**
 * 0089 (item 8b-2, spec 5.2; plan Task 1): one read for every account's pending suggestions, at most
 * p_per_account per account, newest first. The agency Work page calls it through the service role,
 * which bypasses RLS; no client role may execute it at all.
 *
 * The read is across EVERY account in the database, so each case reads only its own accounts' rows out
 * of the result and keeps the function's own order through WITH ORDINALITY (a filter on the outer query
 * must not be what orders the answer).
 *
 * ONE REFUSED STATEMENT PER withRollback: a refusal aborts the transaction (25P02), so every refusing
 * case below has its own block.
 */
const FN = "public.list_pending_proposals_for_agency";
const RUN = Math.random().toString(36).slice(2, 10);
const HEX = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
const DIGITS = () => Math.floor(Math.random() * 1e7).toString().padStart(7, "0");
const EXPIRES = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
/** Three account ids sharing one random prefix, so A < B < C as uuids (fixed tails ...0a, ...0b, ...0c). */
const ids = () => {
  const p = HEX();
  return { a: `${p}-0000-4000-8000-00000000000a`, b: `${p}-0000-4000-8000-00000000000b`, c: `${p}-0000-4000-8000-00000000000c` };
};
const one = async (c: Client, sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;

async function account(c: Client, id: string, tag: string) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  await c.query(
    "insert into accounts (id, agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,$3,$4,true)",
    [id, agency!.id, `org_par_${tag}_${RUN}_${HEX()}`, `PAR ${tag}`]);
  const phone = await one(c, "insert into phone_numbers (account_id, e164) values ($1,$2) returning id", [id, `+1999${DIGITS()}`]);
  return phone;
}

/** One proposals row on its own call (so the one-pending-per-call index never meets a sibling). */
async function proposal(c: Client, acct: string, phone: string, over: Record<string, unknown> = {}) {
  const call = await one(c, "insert into calls (account_id, phone_number_id) values ($1,$2) returning id", [acct, phone]);
  const r: Record<string, unknown> = {
    account_id: acct, source: "call", call_id: call, kind: "task", payload: { title: "Send the quote", dueAt: null },
    evidence: "I need a quote", expires_at: EXPIRES, ...over,
  };
  const cols = Object.keys(r);
  const vals = cols.map((k) => { const v = r[k]; return v !== null && typeof v === "object" ? JSON.stringify(v) : v; });
  return one(c, `insert into proposals (${cols.join(", ")}) values (${cols.map((k, i) =>
    k === "created_at" || k === "expires_at" || k === "decided_at" ? `$${i + 1}::timestamptz` : `$${i + 1}`).join(", ")}) returning id`, vals);
}
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** The function's answer for these accounts only, in the function's own order. */
async function read(c: Client, perAccount: number, accounts: string[]) {
  const { rows } = await c.query<{ id: string; account_id: string }>(
    `select t.id, t.account_id from ${FN}($1) with ordinality as t
      where t.account_id = any($2::uuid[]) order by t.ordinality`, [perAccount, accounts]);
  return rows;
}

async function refusal(c: Client, sql: string, args: unknown[] = []): Promise<string | undefined> {
  return (await refused(c, sql, args))?.code;
}
async function refused(c: Client, sql: string, args: unknown[] = []): Promise<{ code?: string; message: string } | undefined> {
  try {
    await c.query(sql, args);
    return undefined;
  } catch (e) {
    const { code, message } = e as { code?: string; message: string };
    return { code, message };
  }
}
/**
 * A client role's refusal must be the FUNCTION's, not the table's: with EXECUTE granted to anon, the
 * invoker body still fails 42501 on proposals (anon has no SELECT there), so the code alone cannot
 * tell a granted function from a refused one.
 */
const FN_REFUSED = { code: "42501", message: "permission denied for function list_pending_proposals_for_agency" };

describe("0089: list_pending_proposals_for_agency (spec 5.2)", () => {
  it("returns at most p_per_account pending rows per account, newest first, for every account at once (mutations: <= -> < FAILS; drop the partition by FAILS)", () =>
    withRollback(async (c) => {
      const acc = ids();
      const pa = await account(c, acc.a, "a");
      const pb = await account(c, acc.b, "b");
      const pc = await account(c, acc.c, "c");
      await proposal(c, acc.a, pa, { created_at: ago(180) });
      const a2 = await proposal(c, acc.a, pa, { created_at: ago(120) });
      const a3 = await proposal(c, acc.a, pa, { created_at: ago(60) });
      // B's only row is the OLDEST of all, so a cap without partition by keeps A's two and loses it.
      const b1 = await proposal(c, acc.b, pb, { created_at: ago(240) });
      // C holds a row, but not a pending one: C answers nothing.
      await proposal(c, acc.c, pc, { created_at: ago(30), status: "dismissed", decided_at: ago(10), decided_by: "u_par" });

      expect(await read(c, 2, [acc.a, acc.b, acc.c])).toEqual([
        { id: a3, account_id: acc.a },
        { id: a2, account_id: acc.a },
        { id: b1, account_id: acc.b },
      ]);
    }));

  it("leaves out a pending row past expires_at and every decided row (mutation: drop the expires_at filter FAILS)", () =>
    withRollback(async (c) => {
      const acc = ids();
      const pa = await account(c, acc.a, "a");
      const fresh = await proposal(c, acc.a, pa, { created_at: ago(300) });
      // Every row below is NEWER than the fresh one, so a filter that let any through would show it first.
      await proposal(c, acc.a, pa, { created_at: ago(200), expires_at: ago(1) });
      await proposal(c, acc.a, pa, {
        created_at: ago(190), status: "accepted", applied_payload: { title: "Send the quote", dueAt: null },
        decided_at: ago(5), decided_by: "u_par" });
      await proposal(c, acc.a, pa, { created_at: ago(180), status: "dismissed", decided_at: ago(5), decided_by: "u_par" });
      await proposal(c, acc.a, pa, {
        created_at: ago(170), status: "expired", expired_reason: "aged", decided_at: ago(5), decided_by: "system" });

      expect(await read(c, 50, [acc.a])).toEqual([{ id: fresh, account_id: acc.a }]);
    }));

  it("a tie on created_at is broken by id, so the cap never returns a different row on a second call (mutation: drop id desc FAILS)", () =>
    withRollback(async (c) => {
      const acc = ids();
      const pa = await account(c, acc.a, "a");
      const at = ago(60);
      const p = HEX();
      const lo = `${p}-0000-4000-8000-000000000001`;
      const hi = `${p}-0000-4000-8000-000000000002`;
      // The smaller id goes in FIRST: without id desc, the tie keeps the scan's order and the first
      // row read (the smaller id) would win.
      await proposal(c, acc.a, pa, { id: lo, created_at: at });
      await proposal(c, acc.a, pa, { id: hi, created_at: at });

      const first = await read(c, 1, [acc.a]);
      const second = await read(c, 1, [acc.a]);
      expect(first).toEqual([{ id: hi, account_id: acc.a }]);
      expect(second).toEqual([{ id: hi, account_id: acc.a }]);
    }));

  it("refuses 0 (mutation: drop the guard FAILS)", () =>
    withRollback(async (c) => {
      expect(await refusal(c, `select * from ${FN}(0)`)).toBe("22023");
    }));

  it("refuses null (mutation: drop the guard FAILS)", () =>
    withRollback(async (c) => {
      expect(await refusal(c, `select * from ${FN}(null)`)).toBe("22023");
    }));

  it("only service_role may execute it: no client role and not PUBLIC holds EXECUTE (mutation: grant execute ... to authenticated FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [p] } = await c.query<{ oid: string | null }>(
        `select to_regprocedure('${FN}(integer)')::oid::text as oid`);
      expect(p!.oid).toMatch(/^[0-9]+$/);
      const { rows } = await c.query<{ role: string; can: boolean }>(
        `select r as role, has_function_privilege(r, '${FN}(integer)', 'execute') as can
           from unnest(array['anon', 'authenticated', 'service_role']) r order by r`);
      expect(rows).toEqual([
        { role: "anon", can: false },
        { role: "authenticated", can: false },
        { role: "service_role", can: true },
      ]);
      // Every EXECUTE grant besides the owner's: exactly service_role (PUBLIC would read as grantee 0).
      const { rows: grants } = await c.query<{ grantee: string }>(
        `select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee
           from pg_proc p cross join lateral aclexplode(p.proacl) a
          where p.oid = '${FN}(integer)'::regprocedure and a.grantee <> p.proowner and a.privilege_type = 'EXECUTE'
          order by 1`);
      expect(grants).toEqual([{ grantee: "service_role" }]);
    }));

  it("authenticated calling it is refused EXECUTE on the function itself (mutation: grant execute ... to authenticated FAILS)", () =>
    withRollback(async (c) => {
      await c.query("set local role authenticated");
      expect(await refused(c, `select * from ${FN}(50)`)).toEqual(FN_REFUSED);
    }));

  it("anon calling it is refused EXECUTE on the function itself (mutation: grant execute ... to anon FAILS)", () =>
    withRollback(async (c) => {
      await c.query("set local role anon");
      expect(await refused(c, `select * from ${FN}(50)`)).toEqual(FN_REFUSED);
    }));

  it("it is security invoker with search_path pg_catalog, pg_temp (0096), stable plpgsql, returning setof proposals (mutation: security definer FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{
        prosecdef: boolean; proconfig: string[] | null; provolatile: string; lang: string; proretset: boolean; ret: string;
      }>(
        `select p.prosecdef, p.proconfig, p.provolatile, l.lanname as lang, p.proretset, p.prorettype::regtype::text as ret
           from pg_proc p join pg_language l on l.oid = p.prolang
          where p.oid = '${FN}(integer)'::regprocedure`);
      expect(rows).toEqual([
        { prosecdef: false, proconfig: ['search_path=pg_catalog, pg_temp'], provolatile: "s", lang: "plpgsql", proretset: true, ret: "proposals" },
      ]);
    }));
});
