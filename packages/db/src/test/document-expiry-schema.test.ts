import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * 0084 (S-07 3a, spec 3.2, 3.4; plan deviations 2-4): the expiry To-do's two columns, their
 * coherence, the same-account FK and its cascade, one To-do per document and expiry date, the
 * client-role guard extended to both columns, and the three documents indexes. Its own seed, in
 * document-requests-schema.test.ts's shape.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_dex_${RUN}`;
const ORG_B = `org_dexb_${RUN}`;
const OWNER = `u_dex_owner_${RUN}`;

async function attempt<T extends object = Record<string, unknown>>(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint s");
  try {
    const r = await c.query<T>(sql, args);
    await c.query("release savepoint s");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint s");
    throw e;
  }
}
async function one(c: Client, sql: string, args: unknown[]): Promise<string> {
  return (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
}

async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'DEX Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'DEX B',true) returning id", [agency!.id, ORG_B]);
  const owner = await one(c, "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [OWNER]);
  await c.query("insert into memberships (user_id, scope, account_id, role) values ($1,'account',$2,'owner')", [owner, acct]);
  const ana = await one(c, "insert into contacts (account_id, first_name) values ($1,'Ana') returning id", [acct]);
  const doc = await one(c,
    "insert into documents (account_id, contact_id, title, category, expires_on, source, created_by) values ($1,$2,'Seguro','insurance','2026-11-16','upload','user_seed') returning id",
    [acct, ana]);
  return { acct, acctB, ana, doc };
}
const task = (c: Client, acct: string, doc: string | null, on: string | null, contact: string | null = null) =>
  attempt<{ id: string }>(c,
    "insert into tasks (account_id, contact_id, title, document_expiry_id, document_expiry_on) values ($1,$2,'T',$3,$4::date) returning id",
    [acct, contact, doc, on]);

describe("0084: the expiry To-do's link (spec 3.2, 3.4)", () => {
  it("one To-do per document and expiry date; a new date is a new key (mutations: drop tasks_document_expiry_once -> the duplicate succeeds -> FAILS; make it unique on document_expiry_id alone -> the re-arm insert FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await task(c, s.acct, s.doc, "2026-11-16", s.ana);
      await expect(task(c, s.acct, s.doc, "2026-11-16", s.ana)).rejects.toMatchObject({ code: "23505", constraint: "tasks_document_expiry_once" });
      const rearmed = await task(c, s.acct, s.doc, "2027-11-16", s.ana);
      expect(rearmed.rows).toHaveLength(1);
    }));

  it("both columns or neither (mutation: drop tasks_document_expiry_coherent -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(task(c, s.acct, s.doc, null)).rejects.toMatchObject({ code: "23514", constraint: "tasks_document_expiry_coherent" });
      await expect(task(c, s.acct, null, "2026-11-16")).rejects.toMatchObject({ code: "23514", constraint: "tasks_document_expiry_coherent" });
    }));

  it("another account cannot link its To-do to this account's document (mutation: an FK on document_expiry_id alone -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(task(c, s.acctB, s.doc, "2026-11-16")).rejects.toMatchObject({ code: "23503", constraint: "tasks_document_expiry_fkey" });
    }));

  it("deleting the document deletes its expiry To-do (deviation 2; mutation: on delete no action -> the delete FAILS 23503)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const t = (await task(c, s.acct, s.doc, "2026-11-16", s.ana)).rows[0]!.id;
      await c.query("delete from documents where id = $1", [s.doc]);
      const { rows: [n] } = await c.query<{ n: string }>("select count(*)::text as n from tasks where id = $1", [t]);
      expect(n!.n).toBe("0");
    }));

  it("a signed-in insert cannot set either column and a signed-in update cannot change them; the rest of the row still updates (mutations: drop either new line from either branch of keep_task_links -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const t1 = (await task(c, s.acct, s.doc, "2026-11-16", s.ana)).rows[0]!.id;
      await actAs(c, { org_id: ORG, sub: OWNER });
      const { rows: [forged] } = await c.query<{ document_expiry_id: string | null; document_expiry_on: string | null }>(
        "insert into tasks (account_id, contact_id, title, document_expiry_id, document_expiry_on) values ($1,$2,'Forged',$3,'2027-01-01') returning document_expiry_id, document_expiry_on::text",
        [s.acct, s.ana, s.doc]);
      expect(forged).toEqual({ document_expiry_id: null, document_expiry_on: null });
      const { rows: [kept] } = await c.query<{ document_expiry_id: string; document_expiry_on: string; title: string }>(
        "update tasks set document_expiry_id = null, document_expiry_on = null, title = 'T2' where id = $1 returning document_expiry_id, document_expiry_on::text, title",
        [t1]);
      expect(kept).toEqual({ document_expiry_id: s.doc, document_expiry_on: "2026-11-16", title: "T2" });
    }));
});

describe("0084: the documents indexes (deviation 4)", () => {
  it.each([
    ["tasks_document_expiry_once", "CREATE UNIQUE INDEX tasks_document_expiry_once ON public.tasks USING btree (document_expiry_id, document_expiry_on) WHERE (document_expiry_id IS NOT NULL)"],
    ["documents_by_expiry", "CREATE INDEX documents_by_expiry ON public.documents USING btree (account_id, expires_on, id) WHERE ((deleted_at IS NULL) AND (expires_on IS NOT NULL))"],
    ["documents_expiry_window", "CREATE INDEX documents_expiry_window ON public.documents USING btree (expires_on) WHERE ((deleted_at IS NULL) AND (expires_on IS NOT NULL) AND (NOT owners_only))"],
    ["documents_live_by_created", "CREATE INDEX documents_live_by_created ON public.documents USING btree (account_id, created_at DESC, id DESC) WHERE (deleted_at IS NULL)"],
  ])("%s is exactly as designed (mutations: drop any predicate clause or column -> FAILS)", (name, def) =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ indexdef: string }>("select indexdef from pg_indexes where schemaname = 'public' and indexname = $1", [name]);
      expect(rows.map((r) => r.indexdef)).toEqual([def]);
    }));
});
