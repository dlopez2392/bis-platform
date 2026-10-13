import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAsMember } from "./db";
import {
  DOCUMENT_QUOTA_BYTES, DOCUMENT_MAX_BYTES, DOCUMENT_CONTENT_TYPES, DOCUMENT_CATEGORIES, DOCUMENT_SOURCES, DOCUMENT_TITLE_MAX,
} from "../document-rules";

/**
 * 0077, the document vault's schema (spec section 3). As the table owner inside a rolled-back
 * transaction unless a case switches role. A refused statement runs under a savepoint (`attempt`), so
 * one refusal does not abort the rest of the case (25P02).
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_dv_${RUN}`;
const RESERVE = "public.reserve_document_version(uuid,uuid,bigint,text,text,text)";

async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint attempt");
  try { const r = await c.query(sql, args); await c.query("release savepoint attempt"); return r; }
  catch (e) { await c.query("rollback to savepoint attempt"); throw e; }
}

async function seed(c: Client) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'DV Co',true) returning id", [agency!.id, ORG]);
  const other = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'DV B',true) returning id", [agency!.id, `${ORG}_b`]);
  const ana = await one("insert into contacts (account_id, first_name) values ($1,'Ana') returning id", [acct]);
  const bea = await one("insert into contacts (account_id, first_name) values ($1,'Bea') returning id", [other]);
  const casa = await one("insert into client_groups (account_id, kind, name) values ($1,'household','Casa') returning id", [acct]);
  return { acct, other, ana, bea, casa };
}

const doc = (c: Client, acct: string, over: Record<string, unknown> = {}) => {
  const row = { contact_id: null, client_group_id: null, title: "Contract", category: "contract", source: "upload",
    scan_status: "skipped", created_by: "user_dv", ...over };
  return attempt(c, `insert into documents (account_id, contact_id, client_group_id, title, category, source, scan_status, created_by)
    values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [acct, row.contact_id, row.client_group_id, row.title, row.category, row.source, row.scan_status, row.created_by])
    .then((r) => (r.rows[0] as { id: string }).id);
};

const reserve = async (c: Client, a: unknown[]) =>
  (await attempt(c, `select public.reserve_document_version($1::uuid,$2::uuid,$3::bigint,$4::text,$5::text,$6::text) as r`, a)).rows[0]!.r as
    { status: string; version_id?: string; storage_path?: string; used?: number };

describe("the documents bucket (spec section 3.1)", () => {
  it("exists, private, 25 MiB, exactly the six types in document-rules' order (mutation: public = true in 0077 -> FAILS)", () => withRollback(async (c) => {
    const { rows } = await c.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'documents'");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.public).toBe(false);
    expect(Number(rows[0]!.file_size_limit)).toBe(DOCUMENT_MAX_BYTES);
    expect(rows[0]!.allowed_mime_types).toEqual([...DOCUMENT_CONTENT_TYPES]);
  }));

  it("no storage.objects policy names the documents bucket: only the service role reaches its objects (mutation: add a select policy for authenticated naming 'documents' -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ policyname: string }>(
        `select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and (coalesce(qual, '') || coalesce(with_check, '')) like '%documents%'`);
      expect(rows).toEqual([]);
    }));
});

describe("documents and document_versions: checks (spec sections 3.2, 3.3)", () => {
  it("exactly one record (mutation: drop documents_one_record -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await expect(doc(c, s.acct)).rejects.toMatchObject({ code: "23514", constraint: "documents_one_record" });
    await expect(doc(c, s.acct, { contact_id: s.ana, client_group_id: s.casa }))
      .rejects.toMatchObject({ code: "23514", constraint: "documents_one_record" });
    expect(await doc(c, s.acct, { contact_id: s.ana })).toMatch(/^[0-9a-f-]{36}$/);
    expect(await doc(c, s.acct, { client_group_id: s.casa })).toMatch(/^[0-9a-f-]{36}$/);
  }));

  it("a record from another account is refused by the same-account key (mutation: make documents_contact_fkey reference contacts(id) alone -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(doc(c, s.acct, { contact_id: s.bea })).rejects.toMatchObject({ code: "23503", constraint: "documents_contact_fkey" });
    }));

  it("the category, source and scan_status sets are closed and match document-rules (mutation: add 'receipt' to documents_category_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      for (const category of DOCUMENT_CATEGORIES) await doc(c, s.acct, { contact_id: s.ana, category });
      await expect(doc(c, s.acct, { contact_id: s.ana, category: "receipt" }))
        .rejects.toMatchObject({ code: "23514", constraint: "documents_category_check" });
      for (const source of DOCUMENT_SOURCES) await doc(c, s.acct, { contact_id: s.ana, source });
      await expect(doc(c, s.acct, { contact_id: s.ana, source: "customer" }))
        .rejects.toMatchObject({ code: "23514", constraint: "documents_source_check" });
      for (const scan of ["skipped", "pending", "clean", "infected"]) await doc(c, s.acct, { contact_id: s.ana, scan_status: scan });
      await expect(doc(c, s.acct, { contact_id: s.ana, scan_status: "unknown" }))
        .rejects.toMatchObject({ code: "23514", constraint: "documents_scan_status_check" });
      const { rows } = await c.query<{ d: string }>(
        "select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'documents_category_check'");
      for (const k of DOCUMENT_CATEGORIES) expect(rows[0]!.d).toContain(`'${k}'`);
    }));

  it("a title is 1 to 200 characters with no edge space; a blank creator is refused (mutation: drop documents_title_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      for (const title of ["", " Contract", "Contract\t", "x".repeat(DOCUMENT_TITLE_MAX + 1)]) {
        await expect(doc(c, s.acct, { contact_id: s.ana, title })).rejects.toMatchObject({ code: "23514", constraint: "documents_title_check" });
      }
      expect(await doc(c, s.acct, { contact_id: s.ana, title: "x".repeat(DOCUMENT_TITLE_MAX) })).toBeTruthy();
      await expect(doc(c, s.acct, { contact_id: s.ana, created_by: " " }))
        .rejects.toMatchObject({ code: "23514", constraint: "documents_created_by_check" });
    }));

  it("trash is coherent: deleted_at and deleted_by together (mutation: drop documents_trash_coherent -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    const id = await doc(c, s.acct, { contact_id: s.ana });
    await expect(attempt(c, "update documents set deleted_at = now() where id = $1", [id]))
      .rejects.toMatchObject({ code: "23514", constraint: "documents_trash_coherent" });
    await attempt(c, "update documents set deleted_at = now(), deleted_by = 'user_dv' where id = $1", [id]);
  }));

  it("a version's path is account/document/version and never a file name (mutation: drop document_versions_path_shape -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await doc(c, s.acct, { contact_id: s.ana });
      await expect(attempt(c, `insert into document_versions (document_id, account_id, storage_path, bytes, content_type, uploaded_by, status)
        values ($1,$2,$3,10,'application/pdf','user_dv','uploading')`, [id, s.acct, `${s.acct}/${id}/contract.pdf`]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_versions_path_shape" });
    }));

  it("a ready version carries its hash; the type set is the bucket's (mutation: drop document_versions_ready_hashed -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await doc(c, s.acct, { contact_id: s.ana });
      const r = await reserve(c, [s.acct, id, 10, "application/pdf", "c.pdf", "user_dv"]);
      await expect(attempt(c, "update document_versions set status = 'ready' where id = $1", [r.version_id]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_versions_ready_hashed" });
      await expect(attempt(c, "update document_versions set content_type = 'image/svg+xml' where id = $1", [r.version_id]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_versions_content_type_check" });
    }));

  it("current_version_id names only a READY version of the SAME document (mutation: drop trigger documents_current_is_ready -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const a = await doc(c, s.acct, { contact_id: s.ana });
      const b = await doc(c, s.acct, { contact_id: s.ana });
      const va = await reserve(c, [s.acct, a, 10, "application/pdf", "a.pdf", "user_dv"]);
      const vb = await reserve(c, [s.acct, b, 10, "application/pdf", "b.pdf", "user_dv"]);
      await expect(attempt(c, "update documents set current_version_id = $1 where id = $2", [va.version_id, a]))
        .rejects.toMatchObject({ code: "23514" });
      await c.query("update document_versions set status = 'ready', sha256 = repeat('a', 64) where id in ($1, $2)", [va.version_id, vb.version_id]);
      // Another document's ready version: the trigger fires before the composite FK and refuses it.
      await expect(attempt(c, "update documents set current_version_id = $1 where id = $2", [vb.version_id, a]))
        .rejects.toMatchObject({ code: "23514" });
      await attempt(c, "update documents set current_version_id = $1 where id = $2", [va.version_id, a]);
    }));

  it("deleting a document takes its versions with it, the current one included (mutation: document_versions_document_fkey without on delete cascade -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await doc(c, s.acct, { contact_id: s.ana });
      // The shape the purge deletes: one READY version the document points at (the circular FK pair),
      // plus one still uploading.
      const ready = await reserve(c, [s.acct, id, 10, "application/pdf", "c.pdf", "user_dv"]);
      await c.query("update document_versions set status = 'ready', sha256 = repeat('a', 64) where id = $1", [ready.version_id]);
      await c.query("update documents set current_version_id = $1 where id = $2", [ready.version_id, id]);
      await reserve(c, [s.acct, id, 10, "application/pdf", "d.pdf", "user_dv"]);
      await attempt(c, "delete from documents where id = $1", [id]);
      expect((await c.query("select 1 from document_versions where document_id = $1", [id])).rowCount).toBe(0);
    }));

  it("a contact row cannot be deleted while a document row points at it (the backstop behind deviation 2's order; mutation: documents_contact_fkey on delete cascade -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await doc(c, s.acct, { contact_id: s.ana });
      await expect(attempt(c, "delete from contacts where id = $1", [s.ana])).rejects.toMatchObject({ code: "23503", constraint: "documents_contact_fkey" });
    }));
});

describe("who may write (spec section 3.4, 0053)", () => {
  it("authenticated holds SELECT and nothing else on both tables; anon holds nothing (mutation: grant insert on documents to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ k: string }>(
        `select r || ' ' || t || ' ' || p as k from (values ('anon'), ('authenticated')) v(r)
          cross join (values ('documents'), ('document_versions')) w(t)
          cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) x(p)
         where has_table_privilege(r, 'public.' || t, p) order by 1`);
      expect(rows.map((r) => r.k)).toEqual(["authenticated document_versions SELECT", "authenticated documents SELECT"]);
    }));

  it("reserve_document_version is executable by service_role only, and is SECURITY DEFINER (mutation: grant execute to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; ok: boolean }>(
        `select r, has_function_privilege(r, '${RESERVE}', 'EXECUTE') as ok
           from (values ('anon'), ('authenticated'), ('service_role')) v(r) order by 1`);
      expect(rows).toEqual([{ r: "anon", ok: false }, { r: "authenticated", ok: false }, { r: "service_role", ok: true }]);
      const { rows: [f] } = await c.query<{ prosecdef: boolean }>(`select prosecdef from pg_proc where oid = '${RESERVE}'::regprocedure`);
      expect(f!.prosecdef).toBe(true);
    }));

  it("a signed-in Owner cannot insert, even through the function (mutation: grant execute on reserve_document_version to authenticated -> FAILS on the second expect; grant insert AND add a permissive insert policy -> FAILS on the first)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAsMember(c, s.acct, ORG, "owner");
      await expect(attempt(c, "insert into documents (account_id, contact_id, title, category, source, scan_status, created_by) values ($1,$2,'X','other','upload','skipped','me')", [s.acct, s.ana]))
        .rejects.toMatchObject({ code: "42501" });
      await expect(reserve(c, [s.acct, s.ana, 10, "application/pdf", "x.pdf", "me"])).rejects.toMatchObject({ code: "42501" });
    }));
});

describe("mark_document_version_ready: one transaction (plan review minor 4)", () => {
  const MARK = "public.mark_document_version_ready(uuid,uuid,uuid,bigint,text)";
  const mark = async (c: Client, a: unknown[]) =>
    (await attempt(c, "select public.mark_document_version_ready($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::text) as r", a)).rows[0]!.r as
      { status: string; first?: boolean };
  it("the version turns ready AND becomes current together; first is true once (mutation: drop the documents update -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await doc(c, s.acct, { contact_id: s.ana });
      const r = await reserve(c, [s.acct, id, 10, "application/pdf", "c.pdf", "user_dv"]);
      expect(await mark(c, [s.acct, id, r.version_id, 10, "a".repeat(64)])).toEqual({ status: "ok", first: true });
      const { rows } = await c.query("select d.current_version_id = v.id as current, v.status from documents d join document_versions v on v.document_id = d.id where d.id = $1", [id]);
      expect(rows).toEqual([{ current: true, status: "ready" }]);
      expect(await mark(c, [s.acct, id, r.version_id, 10, "a".repeat(64)])).toEqual({ status: "not_found" });
    }));
  it("another document's version, or another account, changes nothing (mutation: drop `and document_id = p_document_id` -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const a = await doc(c, s.acct, { contact_id: s.ana });
      const b = await doc(c, s.acct, { contact_id: s.ana });
      const vb = await reserve(c, [s.acct, b, 10, "application/pdf", "b.pdf", "user_dv"]);
      expect(await mark(c, [s.acct, a, vb.version_id, 10, "a".repeat(64)])).toEqual({ status: "not_found" });
      expect(await mark(c, [s.other, b, vb.version_id, 10, "a".repeat(64)])).toEqual({ status: "not_found" });
      const { rows } = await c.query("select status from document_versions where id = $1", [vb.version_id]);
      expect(rows).toEqual([{ status: "uploading" }]);
    }));
  it("executable by service_role only; a NULL argument raises 22004 (mutation: grant execute to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; ok: boolean }>(
        `select r, has_function_privilege(r, '${MARK}', 'EXECUTE') as ok from (values ('anon'), ('authenticated'), ('service_role')) v(r) order by 1`);
      expect(rows).toEqual([{ r: "anon", ok: false }, { r: "authenticated", ok: false }, { r: "service_role", ok: true }]);
      const s = await seed(c);
      await expect(mark(c, [s.acct, null, null, 1, "x"])).rejects.toMatchObject({ code: "22004" });
    }));
});

describe("reserve_document_version: the quota (spec section 3.5)", () => {
  it("the SQL literals equal document-rules (mutation: change 5368709120 in 0077 -> FAILS)", () => withRollback(async (c) => {
    const { rows: [f] } = await c.query<{ d: string }>(`select pg_get_functiondef('${RESERVE}'::regprocedure) as d`);
    expect(f!.d).toContain(String(DOCUMENT_QUOTA_BYTES));
    expect(f!.d).toContain(String(DOCUMENT_MAX_BYTES));
    const { rows: [k] } = await c.query<{ d: string }>(
      "select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'document_versions_bytes_check'");
    expect(k!.d).toContain(String(DOCUMENT_MAX_BYTES));
  }));

  it("reserves an uploading version at account/document/version and answers its id (mutation: return storage_path without the version id -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await doc(c, s.acct, { contact_id: s.ana });
      const r = await reserve(c, [s.acct, id, 1000, "application/pdf", "c.pdf", "user_dv"]);
      expect(r.status).toBe("ok");
      expect(r.storage_path).toBe(`${s.acct}/${id}/${r.version_id}`);
      const { rows } = await c.query("select status, bytes from document_versions where id = $1", [r.version_id]);
      expect(rows).toEqual([{ status: "uploading", bytes: "1000" }]);
    }));

  it("counts ready AND uploading versions, trashed documents included, and refuses one byte past 5 GiB (mutation: sum only status = 'ready' -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const trashed = await doc(c, s.acct, { contact_id: s.ana });
      const live = await doc(c, s.acct, { contact_id: s.ana });
      // Fill to exactly the quota minus 10 bytes, half in a trashed document's READY version, half still uploading.
      const half = Math.floor((DOCUMENT_QUOTA_BYTES - 10) / 2);
      const put = async (d: string, bytes: number, ready: boolean) => {
        const vid = (await c.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id;
        await c.query(`insert into document_versions (id, document_id, account_id, storage_path, bytes, content_type, uploaded_by, status, sha256)
          values ($1,$2,$3,$4,$5,'application/pdf','user_dv',$6,$7)`,
          [vid, d, s.acct, `${s.acct}/${d}/${vid}`, bytes, ready ? "ready" : "uploading", ready ? "a".repeat(64) : null]);
      };
      // document_versions_bytes_check caps one row at 25 MiB, so the fill is many rows; drop the cap for the fill only.
      await c.query("alter table document_versions drop constraint document_versions_bytes_check");
      await put(trashed, half, true);
      await put(live, DOCUMENT_QUOTA_BYTES - 10 - half, false);
      await c.query("update documents set deleted_at = now(), deleted_by = 'user_dv' where id = $1", [trashed]);
      expect((await reserve(c, [s.acct, live, 11, "application/pdf", "x.pdf", "user_dv"])).status).toBe("over_quota");
      expect((await reserve(c, [s.acct, live, 10, "application/pdf", "x.pdf", "user_dv"])).status).toBe("ok");
    }));

  it("another account's usage never counts (mutation: drop `where v.account_id = p_account_id` -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    const theirs = await doc(c, s.other, { contact_id: s.bea });
    await c.query("alter table document_versions drop constraint document_versions_bytes_check");
    const vid = (await c.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id;
    await c.query(`insert into document_versions (id, document_id, account_id, storage_path, bytes, content_type, uploaded_by, status)
      values ($1,$2,$3,$4,$5,'application/pdf','user_dv','uploading')`, [vid, theirs, s.other, `${s.other}/${theirs}/${vid}`, DOCUMENT_QUOTA_BYTES]);
    const mine = await doc(c, s.acct, { contact_id: s.ana });
    expect((await reserve(c, [s.acct, mine, 1000, "application/pdf", "x.pdf", "user_dv"])).status).toBe("ok");
  }));

  it("over 25 MiB is too_large; a document of another account is not_found; a NULL argument raises 22004 (mutation: drop the null guard -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await doc(c, s.acct, { contact_id: s.ana });
      expect((await reserve(c, [s.acct, id, DOCUMENT_MAX_BYTES + 1, "application/pdf", "x.pdf", "user_dv"])).status).toBe("too_large");
      expect((await reserve(c, [s.other, id, 10, "application/pdf", "x.pdf", "user_dv"])).status).toBe("not_found");
      for (const i of [0, 1, 2, 3, 5]) {
        const args: unknown[] = [s.acct, id, 10, "application/pdf", "x.pdf", "user_dv"];
        args[i] = null;
        await expect(reserve(c, args)).rejects.toMatchObject({ code: "22004" });
      }
    }));
});
