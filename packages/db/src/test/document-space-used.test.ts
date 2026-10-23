import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember } from "./db";

/**
 * 0078, the space-used line's read (spec 4.2 item 4; plan deviation 1). As the table owner inside a
 * rolled-back transaction unless a case switches role. A refused statement runs under a savepoint
 * (`attempt`), so one refusal does not abort the rest of the case (25P02).
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_su_${RUN}`;
const FN = "public.document_space_used(uuid)";

async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint attempt");
  try { const r = await c.query(sql, args); await c.query("release savepoint attempt"); return r; }
  catch (e) { await c.query("rollback to savepoint attempt"); throw e; }
}

async function seed(c: Client) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'SU Co',true) returning id", [agency!.id, ORG]);
  const other = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'SU B',true) returning id", [agency!.id, `${ORG}_b`]);
  const ana = await one("insert into contacts (account_id, first_name) values ($1,'Ana') returning id", [acct]);
  const bea = await one("insert into contacts (account_id, first_name) values ($1,'Bea') returning id", [other]);
  return { acct, other, ana, bea };
}

/** A document on a contact, as the table owner; `ownersOnly` and `trashed` set directly. */
async function doc(c: Client, acct: string, contact: string, o: { ownersOnly?: boolean; trashed?: boolean } = {}) {
  const { rows: [d] } = await c.query<{ id: string }>(
    `insert into documents (account_id, contact_id, title, category, source, created_by, owners_only, deleted_at, deleted_by)
     values ($1,$2,'File','other','upload','user_su',$3,$4,$5) returning id`,
    [acct, contact, o.ownersOnly ?? false, o.trashed ? new Date().toISOString() : null, o.trashed ? "user_su" : null]);
  return d!.id;
}

/** A version row of `bytes`, ready (hashed) or still uploading. */
async function version(c: Client, acct: string, documentId: string, bytes: number, ready: boolean) {
  const { rows: [v] } = await c.query<{ id: string }>("select gen_random_uuid() as id");
  await c.query(
    `insert into document_versions (id, document_id, account_id, storage_path, bytes, content_type, uploaded_by, status, sha256)
     values ($1,$2,$3,$4,$5,'application/pdf','user_su',$6,$7)`,
    [v!.id, documentId, acct, `${acct}/${documentId}/${v!.id}`, bytes, ready ? "ready" : "uploading", ready ? "c".repeat(64) : null]);
  return v!.id;
}

const used = async (c: Client, acct: string) =>
  Number((await attempt(c, "select public.document_space_used($1::uuid) as n", [acct])).rows[0]!.n);

describe("document_space_used: the quota's own sum (spec 4.2 item 4, 3.5)", () => {
  it("counts ready AND uploading versions, trashed documents included, and never another account's (mutations: `and v.status = 'ready'` -> FAILS; drop the account filter -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const trashed = await doc(c, s.acct, s.ana, { trashed: true });
      const live = await doc(c, s.acct, s.ana);
      const theirs = await doc(c, s.other, s.bea);
      await version(c, s.acct, trashed, 100, true);
      await version(c, s.acct, live, 30, false);
      await version(c, s.other, theirs, 1000, true);
      await actAsMember(c, s.acct, ORG, "owner");
      expect(await used(c, s.acct)).toBe(130);
    }));

  it("equals the used figure reserve_document_version answers, which already counts the 25 bytes it just reserved (mutation: sum only documents with deleted_at is null -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const trashed = await doc(c, s.acct, s.ana, { trashed: true });
      await version(c, s.acct, trashed, 700, true);
      const live = await doc(c, s.acct, s.ana);
      // As the table owner (reserve is service_role only; the owner holds every privilege).
      const r = (await c.query<{ r: { status: string; used: number } }>(
        "select public.reserve_document_version($1::uuid,$2::uuid,25::bigint,'application/pdf','x.pdf','user_su') as r", [s.acct, live])).rows[0]!.r;
      expect(r.status).toBe("ok");
      await actAsMember(c, s.acct, ORG, "staff");
      expect(await used(c, s.acct)).toBe(Number(r.used));
      expect(Number(r.used)).toBe(725);
    }));

  it("is the ACCOUNT's number for every member: a Staff member counts an Owners-only file they cannot read (mutation: security invoker -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const secret = await doc(c, s.acct, s.ana, { ownersOnly: true });
      await version(c, s.acct, secret, 50, true);
      await actAsMember(c, s.acct, ORG, "staff");
      // Positive control: RLS really hides the file from this Staff member.
      const { rows: [seen] } = await c.query<{ n: string }>("select count(*) as n from document_versions");
      expect(Number(seen!.n)).toBe(0);
      expect(await used(c, s.acct)).toBe(50);
    }));

  it("the agency reads any account (mutation: drop app.is_agency() from the guard -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const d = await doc(c, s.other, s.bea);
      await version(c, s.other, d, 64, true);
      await actAs(c, { app_role: "agency_admin", sub: `user_agency_${RUN}` });
      expect(await used(c, s.other)).toBe(64);
    }));

  it("refuses a member of another account and a token whose organisation matches no account (mutations: drop the coalesce on app.is_agency() -> FAILS on the first; drop the coalesce on current_account_id -> FAILS on the second)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAsMember(c, s.other, `${ORG}_b`, "owner");
      await expect(attempt(c, "select public.document_space_used($1::uuid)", [s.acct])).rejects.toMatchObject({ code: "42501" });
      await c.query("reset role");
      await actAs(c, { org_id: `org_nobody_${RUN}`, sub: `user_nobody_${RUN}` });
      await expect(attempt(c, "select public.document_space_used($1::uuid)", [s.acct])).rejects.toMatchObject({ code: "42501" });
    }));

  it("a NULL account raises 22004 before it reads anything (mutation: drop the null guard -> FAILS)", () =>
    withRollback(async (c) => {
      await expect(attempt(c, "select public.document_space_used(null::uuid)")).rejects.toMatchObject({ code: "22004" });
    }));

  it("executable by authenticated only, SECURITY DEFINER, STABLE, search_path pg_catalog, pg_temp (0096) (mutation: grant execute to anon -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; ok: boolean }>(
        `select r, has_function_privilege(r, '${FN}', 'EXECUTE') as ok
           from (values ('anon'), ('authenticated'), ('service_role')) v(r) order by 1`);
      expect(rows).toEqual([{ r: "anon", ok: false }, { r: "authenticated", ok: true }, { r: "service_role", ok: false }]);
      const { rows: [f] } = await c.query<{ prosecdef: boolean; provolatile: string; proconfig: string[] }>(
        `select prosecdef, provolatile, proconfig from pg_proc where oid = '${FN}'::regprocedure`);
      expect(f).toEqual({ prosecdef: true, provolatile: "s", proconfig: ['search_path=pg_catalog, pg_temp'] });
    }));
});

/** A version row created at an explicit instant (one transaction's now() is one instant for every row). */
async function versionAt(c: Client, acct: string, documentId: string, at: string, ready = true) {
  const { rows: [v] } = await c.query<{ id: string }>("select gen_random_uuid() as id");
  await c.query(
    `insert into document_versions (id, document_id, account_id, storage_path, bytes, content_type, uploaded_by, status, sha256, created_at)
     values ($1,$2,$3,$4,10,'application/pdf','user_up',$5,$6,$7)`,
    [v!.id, documentId, acct, `${acct}/${documentId}/${v!.id}`, ready ? "ready" : "uploading", ready ? "c".repeat(64) : null, at]);
  return v!.id;
}
const timelineIds = async (c: Client) =>
  (await attempt(c, "select id from public.document_version_timeline order by created_at desc, id desc")).rows.map((r) => (r as { id: string }).id);

describe("document_version_timeline: a row per NEW version (owner ruling R2; plan deviation 6)", () => {
  it("every ready version after a document's first, with its document's title, category, record and trash state; never the first, never one still uploading (mutations: drop the exists clause -> FAILS; drop `v.status = 'ready'` -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const d = await doc(c, s.acct, s.ana, { trashed: true });
      await versionAt(c, s.acct, d, "2026-10-01T10:00:00Z");
      const second = await versionAt(c, s.acct, d, "2026-10-05T10:00:00Z");
      await versionAt(c, s.acct, d, "2026-10-06T10:00:00Z", false);
      const lone = await doc(c, s.acct, s.ana);
      await versionAt(c, s.acct, lone, "2026-10-02T10:00:00Z");
      await actAsMember(c, s.acct, ORG, "owner");
      expect(await timelineIds(c)).toEqual([second]);
      const { rows: [row] } = await attempt(c,
        "select document_id, account_id, uploaded_by, title, category, contact_id, client_group_id, deleted_at is not null as trashed from public.document_version_timeline where id = $1", [second]);
      expect(row).toEqual({ document_id: d, account_id: s.acct, uploaded_by: "user_up", title: "File", category: "other", contact_id: s.ana, client_group_id: null, trashed: true });
    }));

  it("runs under the CALLER's RLS: a Staff member never sees an Owners-only file's new version, another account sees none (mutation: drop `security_invoker = true` -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const secret = await doc(c, s.acct, s.ana, { ownersOnly: true });
      await versionAt(c, s.acct, secret, "2026-10-01T10:00:00Z");
      const shown = await versionAt(c, s.acct, secret, "2026-10-03T10:00:00Z");
      await actAsMember(c, s.acct, ORG, "owner");
      expect(await timelineIds(c)).toEqual([shown]);                 // positive control: the Owner sees it
      await c.query("reset role");
      await actAsMember(c, s.acct, ORG, "staff");
      expect(await timelineIds(c)).toEqual([]);
      await c.query("reset role");
      await actAsMember(c, s.other, `${ORG}_b`, "owner");
      expect(await timelineIds(c)).toEqual([]);
    }));

  it("a Technician sees a TEAM file's new version only on a customer assigned to them (review m3: team-visible files, so only the Technician fence can hide them; mutation: drop policy documents_technician_scope -> FAILS on the unassigned leg)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const bo = (await c.query<{ id: string }>("insert into contacts (account_id, first_name) values ($1,'Bo') returning id", [s.acct])).rows[0]!.id;
      const theirs = await doc(c, s.acct, bo);                       // owners_only false: the team may see it
      await versionAt(c, s.acct, theirs, "2026-10-01T10:00:00Z");
      await versionAt(c, s.acct, theirs, "2026-10-02T10:00:00Z");
      const mine = await doc(c, s.acct, s.ana);
      await versionAt(c, s.acct, mine, "2026-10-01T11:00:00Z");
      const mineNew = await versionAt(c, s.acct, mine, "2026-10-02T11:00:00Z");
      const sub = await actAsMember(c, s.acct, ORG, "technician");
      expect(await timelineIds(c)).toEqual([]);                      // nothing assigned: neither customer's file
      await c.query("reset role");
      await c.query("update contacts set assigned_to = (select id from users where clerk_user_id = $1) where id = $2", [sub, s.ana]);
      await actAs(c, { org_id: ORG, sub });
      expect(await timelineIds(c)).toEqual([mineNew]);               // assigned Ana: hers only, never Bo's
    }));

  it("SELECT for authenticated and service_role and nothing else; anon nothing; the view is security_invoker (mutations: grant insert to authenticated, or leave the default grants -> FAILS; drop service_role from the grant -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ k: string }>(
        `select r || ' ' || p as k from (values ('anon'), ('authenticated')) v(r)
          cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) x(p)
         where has_table_privilege(r, 'public.document_version_timeline', p) order by 1`);
      expect(rows.map((r) => r.k)).toEqual(["authenticated SELECT"]);
      // Review m4: service_role reads it too (the orchestrator's read-only checks), and writes nothing.
      const { rows: [svc] } = await c.query<{ sel: boolean; ins: boolean }>(
        "select has_table_privilege('service_role', 'public.document_version_timeline', 'SELECT') as sel, has_table_privilege('service_role', 'public.document_version_timeline', 'INSERT') as ins");
      expect(svc).toEqual({ sel: true, ins: false });
      const { rows: [o] } = await c.query<{ opts: string[] | null }>(
        "select c.reloptions as opts from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'document_version_timeline'");
      expect(o!.opts).toEqual(["security_invoker=true"]);
    }));
});
