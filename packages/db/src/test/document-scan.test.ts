import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember } from "./db";

/**
 * 0079, virus scanning's data (spec 3.2; plan deviations 1-3). As the table owner inside a rolled-back
 * transaction unless a case switches role. A refused statement runs under a savepoint (`attempt`), so
 * one refusal does not abort the rest of the case (25P02).
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_scan_${RUN}`;
const FN = "public.record_document_scan(uuid,uuid,text,text)";

async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint attempt");
  try { const r = await c.query(sql, args); await c.query("release savepoint attempt"); return r; }
  catch (e) { await c.query("rollback to savepoint attempt"); throw e; }
}

async function seed(c: Client) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Scan Co',true) returning id", [agency!.id, ORG]);
  const other = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Scan B',true) returning id", [agency!.id, `${ORG}_b`]);
  const ana = await one("insert into contacts (account_id, first_name) values ($1,'Ana') returning id", [acct]);
  const bea = await one("insert into contacts (account_id, first_name) values ($1,'Bea') returning id", [other]);
  return { acct, other, ana, bea };
}

/** A document on a contact, as the table owner. No scan_status column at all: 0080 dropped it. */
async function doc(c: Client, acct: string, contact: string, o: { ownersOnly?: boolean; title?: string } = {}) {
  const { rows: [d] } = await c.query<{ id: string }>(
    `insert into documents (account_id, contact_id, title, category, source, created_by, owners_only)
     values ($1,$2,$3,'insurance','upload','user_sc',$4) returning id`,
    [acct, contact, o.title ?? "Lease", o.ownersOnly ?? false]);
  return d!.id;
}

/** A version row, ready (hashed) or still uploading, with NO scan columns: 0079's defaults fill them. */
async function version(c: Client, acct: string, documentId: string, ready = true) {
  const { rows: [v] } = await c.query<{ id: string }>("select gen_random_uuid() as id");
  await c.query(
    `insert into document_versions (id, document_id, account_id, storage_path, bytes, content_type, uploaded_by, status, sha256)
     values ($1,$2,$3,$4,10,'application/pdf','user_sc',$5,$6)`,
    [v!.id, documentId, acct, `${acct}/${documentId}/${v!.id}`, ready ? "ready" : "uploading", ready ? "c".repeat(64) : null]);
  return v!.id;
}

const record = async (c: Client, acct: string, versionId: string, verdict: string, signature: string | null = null) =>
  (await attempt(c, "select public.record_document_scan($1::uuid,$2::uuid,$3,$4) as r", [acct, versionId, verdict, signature]))
    .rows[0]!.r as { status: string; attempts?: number; document_id?: string };
const state = async (c: Client, versionId: string) =>
  (await c.query<{ scan_status: string; scan_attempts: number; scanned: boolean; scan_signature: string | null }>(
    "select scan_status, scan_attempts, scanned_at is not null as scanned, scan_signature from document_versions where id = $1", [versionId])).rows[0]!;

describe("0079 columns: every version starts pending, part 1's included (spec 3.2)", () => {
  it("a version inserted with no scan columns is pending, 0 attempts, unscanned", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const d = await doc(c, s.acct, s.ana);
      const v = await version(c, s.acct, d);
      expect(await state(c, v)).toEqual({ scan_status: "pending", scan_attempts: 0, scanned: false, scan_signature: null });
    }));

  it("the coherence check refuses a scanned pending row, a signature on a clean one, and a clean uploading one (mutation: drop any one clause of document_versions_scan_coherent -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const d = await doc(c, s.acct, s.ana);
      const ready = await version(c, s.acct, d);
      const uploading = await version(c, s.acct, d, false);
      for (const [sql, id] of [
        ["update document_versions set scanned_at = now() where id = $1", ready],
        ["update document_versions set scan_status = 'clean', scanned_at = now(), scan_signature = 'X' where id = $1", ready],
        ["update document_versions set scan_status = 'clean', scanned_at = now() where id = $1", uploading],
      ] as const) {
        await expect(attempt(c, sql, [id])).rejects.toMatchObject({ code: "23514", constraint: "document_versions_scan_coherent" });
      }
      // scanned_at is set too so this probe trips ONLY the enum check: 'quarantined' alone also
      // breaks document_versions_scan_coherent's pending<=>scanned_at clause, and Postgres (9.5+)
      // fires multiple violated CHECK constraints in alphabetical order by name, so
      // "document_versions_scan_coherent" (c) sorts before "document_versions_scan_status_check" (s)
      // and would raise first (confirmed empirically against this migration: the bare update, with
      // scanned_at left null, raises scan_coherent, not scan_status_check).
      await expect(attempt(c, "update document_versions set scan_status = 'quarantined', scanned_at = now() where id = $1", [ready]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_versions_scan_status_check" });
    }));
});

describe("record_document_scan: a compare-and-set from pending (spec 3.2 bullet 5; plan deviation 3)", () => {
  it("clean: one attempt, scanned, no signature; a second verdict for the same version is stale (mutation: drop `scan_status = 'pending'` from the update -> the second answers ok -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const d = await doc(c, s.acct, s.ana);
      const v = await version(c, s.acct, d);
      expect(await record(c, s.acct, v, "clean")).toEqual({ status: "ok", attempts: 1, document_id: d });
      expect(await state(c, v)).toEqual({ scan_status: "clean", scan_attempts: 1, scanned: true, scan_signature: null });
      expect(await record(c, s.acct, v, "infected", "Eicar-Test-Signature")).toEqual({ status: "stale" });
      expect((await state(c, v)).scan_status).toBe("clean");
    }));

  it("error: adds an attempt and stays pending, unscanned (mutation: map 'error' to 'unscannable' -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const v = await version(c, s.acct, await doc(c, s.acct, s.ana));
      expect(await record(c, s.acct, v, "error")).toMatchObject({ status: "ok", attempts: 1 });
      expect(await record(c, s.acct, v, "error")).toMatchObject({ status: "ok", attempts: 2 });
      expect(await state(c, v)).toEqual({ scan_status: "pending", scan_attempts: 2, scanned: false, scan_signature: null });
    }));

  it("infected keeps the signature, trimmed and cut to 200; unscannable keeps none (mutation: drop left(...,200) -> the check refuses -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const d = await doc(c, s.acct, s.ana);
      const a = await version(c, s.acct, d);
      const b = await version(c, s.acct, d);
      await record(c, s.acct, a, "infected", `  ${"W".repeat(250)}  `);
      expect(await state(c, a)).toEqual({ scan_status: "infected", scan_attempts: 1, scanned: true, scan_signature: "W".repeat(200) });
      await record(c, s.acct, b, "unscannable");
      expect(await state(c, b)).toEqual({ scan_status: "unscannable", scan_attempts: 1, scanned: true, scan_signature: null });
    }));

  it("an unscannable verdict keeps clamd's named cause (a password) and none when it names none (owner ruling 2026-10-15; mutation: keep the old 'infected only' CASE -> the cause is lost -> FAILS; drop the nullif -> an empty cause trips the length check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const d = await doc(c, s.acct, s.ana);
      const locked = await version(c, s.acct, d);
      const blank = await version(c, s.acct, d);
      await record(c, s.acct, locked, "unscannable", " Heuristics.Encrypted.PDF ");
      await record(c, s.acct, blank, "unscannable", "  ");
      expect(await state(c, locked)).toEqual({ scan_status: "unscannable", scan_attempts: 1, scanned: true, scan_signature: "Heuristics.Encrypted.PDF" });
      expect((await state(c, blank)).scan_signature).toBeNull();
    }));

  it("never moves documents.current_version_id (dev 1; deviation 1: only the mint function in packages/db/src/documents.ts decides what opens; mutation: on a clean verdict also `update documents set current_version_id = p_version_id where id = v_document` -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const d = await doc(c, s.acct, s.ana);
      const older = await version(c, s.acct, d);
      const newer = await version(c, s.acct, d);
      await c.query("update documents set current_version_id = $1 where id = $2", [newer, d]);
      await record(c, s.acct, older, "clean");
      const current = async () =>
        (await c.query<{ current_version_id: string }>("select current_version_id from documents where id = $1", [d])).rows[0]!.current_version_id;
      expect(await current()).toBe(newer);
      await record(c, s.acct, newer, "infected", "Eicar-Test-Signature");
      expect(await current()).toBe(newer);
    }));

  it("'tried' stamps scan_tried_at and nothing else; a non-pending version is stale (re-review N2b; mutations: count 'tried' as an attempt -> FAILS; stamp a scanned version -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const v = await version(c, s.acct, await doc(c, s.acct, s.ana));
      expect(await record(c, s.acct, v, "tried")).toMatchObject({ status: "ok", attempts: 0 });
      const { rows: [t] } = await c.query<{ tried: boolean; scan_status: string; scan_attempts: number }>(
        "select scan_tried_at is not null as tried, scan_status, scan_attempts from document_versions where id = $1", [v]);
      expect(t).toEqual({ tried: true, scan_status: "pending", scan_attempts: 0 });
      await record(c, s.acct, v, "clean");
      expect(await record(c, s.acct, v, "tried")).toEqual({ status: "stale" });
    }));

  it("never an uploading version, never another account's (mutations: drop `status = 'ready'` -> FAILS; drop the account filter -> FAILS; the 'tried' pass obeys the same two filters, each pinned separately: drop `v.account_id = p_account_id` or `v.status = 'ready'` from its own update -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const d = await doc(c, s.acct, s.ana);
      const uploading = await version(c, s.acct, d, false);
      expect(await record(c, s.acct, uploading, "clean")).toEqual({ status: "stale" });
      expect(await record(c, s.acct, uploading, "tried")).toEqual({ status: "stale" });
      const { rows: [uploadingTried] } = await c.query<{ tried: boolean }>(
        "select scan_tried_at is not null as tried from document_versions where id = $1", [uploading]);
      expect(uploadingTried!.tried).toBe(false);
      const theirs = await version(c, s.other, await doc(c, s.other, s.bea));
      expect(await record(c, s.acct, theirs, "clean")).toEqual({ status: "stale" });
      expect((await state(c, theirs)).scan_status).toBe("pending");
      expect(await record(c, s.acct, theirs, "tried")).toEqual({ status: "stale" });
      const { rows: [theirsTried] } = await c.query<{ tried: boolean }>(
        "select scan_tried_at is not null as tried from document_versions where id = $1", [theirs]);
      expect(theirsTried!.tried).toBe(false);
    }));

  it("refuses nulls (22004), an infected verdict with no signature (22004) and an unknown verdict (22023) (mutation: drop the signature guard -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const v = await version(c, s.acct, await doc(c, s.acct, s.ana));
      await expect(record(c, s.acct, v, null as unknown as string)).rejects.toMatchObject({ code: "22004" });
      await expect(record(c, s.acct, v, "infected", "   ")).rejects.toMatchObject({ code: "22004" });
      await expect(record(c, s.acct, v, "maybe")).rejects.toMatchObject({ code: "22023" });
      expect((await state(c, v)).scan_attempts).toBe(0);
    }));

  it("executable by service_role only, SECURITY INVOKER, search_path pg_catalog, pg_temp (0096) (mutation: grant execute to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; ok: boolean }>(
        `select r, has_function_privilege(r, '${FN}', 'EXECUTE') as ok
           from (values ('anon'), ('authenticated'), ('service_role')) v(r) order by 1`);
      expect(rows).toEqual([{ r: "anon", ok: false }, { r: "authenticated", ok: false }, { r: "service_role", ok: true }]);
      const { rows: [f] } = await c.query<{ prosecdef: boolean; proconfig: string[] }>(
        `select prosecdef, proconfig from pg_proc where oid = '${FN}'::regprocedure`);
      expect(f).toEqual({ prosecdef: false, proconfig: ['search_path=pg_catalog, pg_temp'] });
    }));
});

const scanTimeline = async (c: Client) =>
  (await attempt(c, "select id, scan_status, title from public.document_scan_timeline order by scanned_at desc, id desc")).rows as
    { id: string; scan_status: string; title: string }[];

describe("document_scan_timeline: a row per removed version, under the caller's RLS (spec 3.5)", () => {
  it("infected and unscannable ready versions only, with their document's title (mutations: add 'clean' to the filter -> FAILS; drop `v.status = 'ready'` is caught by the coherence check, so the title join is the probe: join on v.id -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const d = await doc(c, s.acct, s.ana, { title: "Lease" });
      const bad = await version(c, s.acct, d);
      const unread = await version(c, s.acct, d);
      const good = await version(c, s.acct, d);
      await version(c, s.acct, d); // stays pending
      await record(c, s.acct, bad, "infected", "Eicar-Test-Signature");
      await record(c, s.acct, unread, "unscannable");
      await record(c, s.acct, good, "clean");
      await actAsMember(c, s.acct, ORG, "owner");
      const rows = await scanTimeline(c);
      expect(rows.map((r) => r.id).sort()).toEqual([bad, unread].sort());
      expect(new Set(rows.map((r) => r.title))).toEqual(new Set(["Lease"]));
      expect(rows.find((r) => r.id === bad)!.scan_status).toBe("infected");
    }));

  it("Staff never see an Owners-only file's row, and another account's member sees none (mutation: security_invoker = false -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const v = await version(c, s.acct, await doc(c, s.acct, s.ana, { ownersOnly: true }));
      await record(c, s.acct, v, "infected", "Eicar-Test-Signature");
      await actAsMember(c, s.acct, ORG, "owner");
      expect(await scanTimeline(c)).toHaveLength(1);
      await c.query("reset role");
      await actAsMember(c, s.acct, ORG, "staff");
      expect(await scanTimeline(c)).toEqual([]);
      await c.query("reset role");
      await actAsMember(c, s.other, `${ORG}_b`, "owner");
      expect(await scanTimeline(c)).toEqual([]);
      await c.query("reset role");
      await actAs(c, { app_role: "agency_admin", sub: `user_agency_${RUN}` });
      expect(await scanTimeline(c)).toHaveLength(1);
    }));

  it("security_invoker, SELECT for authenticated and service_role only, no write for anyone (mutation: drop the revoke -> authenticated INSERT appears -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [v] } = await c.query<{ reloptions: string[] }>("select reloptions from pg_class where oid = 'public.document_scan_timeline'::regclass");
      expect(v!.reloptions).toEqual(["security_invoker=true"]);
      const { rows } = await c.query<{ r: string; sel: boolean; ins: boolean }>(
        `select r, has_table_privilege(r, 'public.document_scan_timeline', 'SELECT') as sel,
                has_table_privilege(r, 'public.document_scan_timeline', 'INSERT') as ins
           from (values ('anon'), ('authenticated'), ('service_role')) x(r) order by 1`);
      expect(rows).toEqual([
        { r: "anon", sel: false, ins: false }, { r: "authenticated", sel: true, ins: false }, { r: "service_role", sel: true, ins: false }]);
    }));
});

describe("the retry pass's index exists and is partial on ready + pending (spec 3.4)", () => {
  it("document_versions_scan_pending: partial on ready + pending, keyed (scan_tried_at nulls first, created_at, id) (mutations: drop the index -> FAILS; key it on created_at alone -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ def: string }>("select pg_get_indexdef('public.document_versions_scan_pending'::regclass) as def");
      expect(rows[0]!.def).toMatch(/WHERE \(\(status = 'ready'::text\) AND \(scan_status = 'pending'::text\)\)/);
      // Final check minor 2: the KEY is the retry order (never tried first, then least recently tried, then age).
      expect(rows[0]!.def).toMatch(/\(scan_tried_at NULLS FIRST, created_at, id\)/);
    }));
});
