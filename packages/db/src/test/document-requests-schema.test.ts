import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * 0080 (S-07 2b, spec 4.1, 4.4, 4.5): the request table and its checks, who reads it, the one start
 * function (the request re-proved open under its lock, today's starts, the record and the category
 * taken from the request, the quota through reserve_document_version), the completion trigger, the
 * task links and their guard, the log source, and the retired documents.scan_status. Its own seed,
 * in the vault RLS suite's shape (document-vault-rls.test.ts:22-58).
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_drq_${RUN}`;
const ORG_B = `org_drqb_${RUN}`;
const SUB = { owner: `u_dr_owner_${RUN}`, tech: `u_dr_tech_${RUN}`, tech2: `u_dr_tech2_${RUN}`, ownerB: `u_dr_ownerb_${RUN}` } as const;
const HASH = (n: number) => n.toString(16).padStart(64, "0");
const ITEMS = JSON.stringify([{ key: "insurance", category: "insurance", note: null }, { key: "other", category: "other", note: "Pool permit" }]);

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
  const acct = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'DRQ Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'DRQ B',true) returning id", [agency!.id, ORG_B]);
  const u = {} as Record<keyof typeof SUB, string>;
  for (const k of Object.keys(SUB) as (keyof typeof SUB)[]) u[k] = await one(c, "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  await c.query(
    "insert into memberships (user_id, scope, account_id, role) values ($1,'account',$5,'owner'), ($2,'account',$5,'technician'), ($3,'account',$5,'technician'), ($4,'account',$6,'owner')",
    [u.owner, u.tech, u.tech2, u.ownerB, acct, acctB]);
  const ana = await one(c, "insert into contacts (account_id, first_name, assigned_to) values ($1,'Ana',$2) returning id", [acct, u.tech]);
  const bo = await one(c, "insert into contacts (account_id, first_name, assigned_to) values ($1,'Bo',$2) returning id", [acct, u.tech2]);
  const casa = await one(c, "insert into client_groups (account_id, kind, name) values ($1,'household','Casa Ana') returning id", [acct]);
  await c.query("insert into client_group_members (account_id, client_group_id, contact_id, is_primary) values ($1,$2,$3,true)", [acct, casa, ana]);
  return { acct, acctB, ana, bo, casa };
}

type Req = { contact_id?: string | null; client_group_id?: string | null; items?: string; language?: string;
  token_hash?: string; channel?: string; created_at?: string; revoked?: boolean; completed?: boolean };
let hashN = 1;
async function request(c: Client, acct: string, r: Req): Promise<string> {
  const created = r.created_at ?? new Date().toISOString();
  const { rows: [row] } = await attempt<{ id: string }>(c,
    `insert into document_requests (id, account_id, contact_id, client_group_id, items, language, token_hash, channel, created_by,
                                    created_at, expires_at, revoked_at, revoked_by, completed_at)
     values (gen_random_uuid(), $1, $2, $3, $4::jsonb, $5, $6, $7, 'user_seed', $8::timestamptz, $8::timestamptz + interval '7 days',
             case when $9 then now() end, case when $9 then 'user_seed' end, case when $10 then now() end) returning id`,
    [acct, r.contact_id === undefined ? null : r.contact_id, r.client_group_id ?? null, r.items ?? ITEMS, r.language ?? "es",
     r.token_hash ?? HASH(hashN++), r.channel ?? "link", created, r.revoked ?? false, r.completed ?? false]);
  return row!.id;
}
type Started = { status: string; document_id?: string; version_id?: string };
const start = async (c: Client, acct: string, req: string, key = "insurance", bytes = 10): Promise<Started> =>
  (await attempt<{ r: Started }>(c,
    "select public.start_document_request_upload($1, $2, $3, $4, 'application/pdf', 'scan.pdf', 'Seguro') as r", [acct, req, key, bytes])).rows[0]!.r;
const ready = (c: Client, acct: string, s: Started) =>
  c.query("select public.mark_document_version_ready($1, $2, $3, 10, $4)", [acct, s.document_id, s.version_id, "a".repeat(64)]);
const verdict = (c: Client, acct: string, versionId: string, v: string) =>
  c.query("select public.record_document_scan($1, $2, $3, $4)", [acct, versionId, v, v === "infected" ? "Eicar-Test-Signature" : null]);

describe("0080: documents.scan_status is gone; customer is a source (spec 3.2 as amended, 4.1)", () => {
  it("the retired column no longer exists (mutation: drop the DROP COLUMN statement -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [r] } = await c.query<{ n: string }>(
        "select count(*)::text as n from information_schema.columns where table_schema='public' and table_name='documents' and column_name='scan_status'");
      expect(r!.n).toBe("0");
    }));

  it("a customer document needs its request, its item and 'customer:<request id>' as its author, and nothing else may claim the source (mutation: drop any clause of documents_request_coherent -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const req = await request(c, s.acct, { contact_id: s.ana });
      const ins = (source: string, createdBy: string, reqId: string | null, key: string | null) => attempt(c,
        "insert into documents (account_id, contact_id, title, category, source, created_by, request_id, request_item_key) values ($1,$2,'X','insurance',$3,$4,$5,$6)",
        [s.acct, s.ana, source, createdBy, reqId, key]);
      await ins("customer", `customer:${req}`, req, "insurance");
      for (const [source, by, reqId, key] of [
        ["customer", "user_seed", req, "insurance"], ["customer", `customer:${req}`, null, null], ["upload", "user_seed", req, "insurance"],
        ["customer", `customer:${req}`, req, null],
      ] as const) {
        await expect(ins(source, by, reqId, key)).rejects.toMatchObject({ code: "23514", constraint: "documents_request_coherent" });
      }
      await expect(ins("fax", "user_seed", null, null)).rejects.toMatchObject({ code: "23514", constraint: "documents_source_check" });
    }));
});

describe("0080: document_requests checks (spec 4.1)", () => {
  it("items: 1 to 9, key = category, one of the nine, distinct, a note only on other and at most 80 characters (mutations: drop the 9-item bound, the key = category clause, or the note rule from app.document_request_items_ok -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const eight = ["id", "contract", "estimate", "invoice", "photo", "permit", "insurance", "warranty"].map((k) => ({ key: k, category: k, note: null }));
      const other = { key: "other", category: "other", note: "x" };
      await request(c, s.acct, { contact_id: s.ana, items: JSON.stringify([...eight, other]) });
      for (const items of [
        "[]",
        JSON.stringify([...eight, other, { key: "id2", category: "id", note: null }]),
        JSON.stringify([{ key: "id", category: "insurance", note: null }]),
        JSON.stringify([{ key: "receipt", category: "receipt", note: null }]),
        JSON.stringify([{ key: "id", category: "id", note: null }, { key: "id", category: "id", note: null }]),
        JSON.stringify([{ key: "id", category: "id", note: "why" }]),
        JSON.stringify([{ key: "other", category: "other", note: null }]),
        JSON.stringify([{ key: "other", category: "other", note: "x".repeat(81) }]),
        JSON.stringify([{ key: "id", category: "id" }]),
        JSON.stringify({ key: "id", category: "id", note: null }),
      ]) {
        await expect(request(c, s.acct, { contact_id: s.ana, items })).rejects.toMatchObject({ code: "23514", constraint: "document_requests_items_check" });
      }
    }));

  it("exactly one record, a unique 64-hex token hash, a known channel and language, expiry = created + 7 days, revoke coherent (mutation: drop any one of these constraints -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await request(c, s.acct, { contact_id: s.ana, token_hash: HASH(900) });
      await expect(request(c, s.acct, { contact_id: s.ana, token_hash: HASH(900) })).rejects.toMatchObject({ code: "23505", constraint: "document_requests_token_hash_key" });
      await expect(request(c, s.acct, { contact_id: s.ana, client_group_id: s.casa })).rejects.toMatchObject({ code: "23514", constraint: "document_requests_one_record" });
      await expect(request(c, s.acct, { contact_id: null })).rejects.toMatchObject({ code: "23514", constraint: "document_requests_one_record" });
      await expect(request(c, s.acct, { contact_id: s.ana, token_hash: "XYZ" })).rejects.toMatchObject({ code: "23514", constraint: "document_requests_token_hash_check" });
      await expect(request(c, s.acct, { contact_id: s.ana, channel: "fax" })).rejects.toMatchObject({ code: "23514", constraint: "document_requests_channel_check" });
      await expect(request(c, s.acct, { contact_id: s.ana, language: "fr" })).rejects.toMatchObject({ code: "23514", constraint: "document_requests_language_check" });
      await expect(attempt(c, "update document_requests set expires_at = expires_at + interval '1 day' where account_id = $1", [s.acct]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_requests_expiry" });
      await expect(attempt(c, "update document_requests set revoked_at = now() where account_id = $1", [s.acct]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_requests_revoke_coherent" });
    }));
});

describe("0080: the at-most-once send stamp (re-review R1)", () => {
  it("sent_at exists, is nullable and starts null (mutation: drop the column or give it a default -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const req = await request(c, s.acct, { contact_id: s.ana });
      const { rows: [r] } = await c.query<{ sent_at: string | null }>("select sent_at from document_requests where id = $1", [req]);
      expect(r!.sent_at).toBeNull();
    }));
});

describe("0080: who reads a request (spec 4.1: members, under the record's visibility, as documents)", () => {
  it.each([
    ["owner", ["Ana", "Bo", "Casa Ana"]], ["tech", ["Ana", "Casa Ana"]], ["tech2", ["Bo"]], ["ownerB", []],
  ] as const)("%s reads %j (mutations: drop document_requests_technician_scope -> tech reads Bo -> FAILS; drop member_read's account clause -> ownerB reads -> FAILS)", (who, want) =>
    withRollback(async (c) => {
      const s = await seed(c);
      await request(c, s.acct, { contact_id: s.ana });
      await request(c, s.acct, { contact_id: s.bo });
      await request(c, s.acct, { contact_id: null, client_group_id: s.casa });
      await actAs(c, { org_id: who === "ownerB" ? ORG_B : ORG, sub: SUB[who] });
      const { rows } = await c.query<{ who: string }>(
        `select coalesce(ct.first_name, g.name) as who from document_requests r
           left join contacts ct on ct.id = r.contact_id left join client_groups g on g.id = r.client_group_id order by 1`);
      expect(rows.map((r) => r.who)).toEqual(want);
    }));

  it("the client role can write nothing and cannot run the start function; neither authenticated nor anon holds EXECUTE on it (mutation: grant insert or update to authenticated, or execute on the function to authenticated or anon -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const req = await request(c, s.acct, { contact_id: s.ana });
      // Checked directly against the grant, as the table owner: the 42501 below could otherwise come
      // from the function's own `for no key update` on document_requests (no UPDATE-shaped RLS policy
      // exists for authenticated) rather than from a missing EXECUTE grant, and granting EXECUTE would
      // then still read green. has_function_privilege proves the grant itself, independent of that.
      const { rows: [priv] } = await c.query<{ auth_exec: boolean; anon_exec: boolean }>(
        `select has_function_privilege('authenticated',
            'public.start_document_request_upload(uuid,uuid,text,bigint,text,text,text)', 'execute') as auth_exec,
          has_function_privilege('anon',
            'public.start_document_request_upload(uuid,uuid,text,bigint,text,text,text)', 'execute') as anon_exec`);
      expect(priv).toEqual({ auth_exec: false, anon_exec: false });
      await actAs(c, { org_id: ORG, sub: SUB.owner });
      await expect(attempt(c, "update document_requests set revoked_at = now(), revoked_by = 'x' where id = $1", [req])).rejects.toMatchObject({ code: "42501" });
      await expect(attempt(c,
        "insert into document_requests (id, account_id, contact_id, items, language, token_hash, channel, created_by, expires_at) values (gen_random_uuid(), $1, $2, $3::jsonb, 'en', $4, 'link', 'x', now() + interval '7 days')",
        [s.acct, s.ana, ITEMS, HASH(77)])).rejects.toMatchObject({ code: "42501" });
      await expect(attempt(c, "select public.start_document_request_upload($1, $2, 'insurance', 10, 'application/pdf', 'a.pdf', 'X')", [s.acct, req]))
        .rejects.toMatchObject({ code: "42501" });
    }));
});

describe("0080: start_document_request_upload (spec 4.4)", () => {
  it("files the upload on the REQUEST's record under the ITEM's category, as the customer, Owners-only off (mutations: take the category from the title; set owners_only true; take the record from an argument -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const req = await request(c, s.acct, { contact_id: s.ana });
      const r = await start(c, s.acct, req, "other");
      expect(r.status).toBe("ok");
      const { rows: [d] } = await c.query("select contact_id, client_group_id, category, source, created_by, owners_only, request_id, request_item_key, title from documents where id = $1", [r.document_id]);
      expect(d).toEqual({ contact_id: s.ana, client_group_id: null, category: "other", source: "customer", created_by: `customer:${req}`, owners_only: false, request_id: req, request_item_key: "other", title: "Seguro" });
      const { rows: [v] } = await c.query("select uploaded_by, status, scan_status, original_name from document_versions where id = $1", [r.version_id]);
      expect(v).toEqual({ uploaded_by: `customer:${req}`, status: "uploading", scan_status: "pending", original_name: "scan.pdf" });
      const g = await request(c, s.acct, { contact_id: null, client_group_id: s.casa });
      const rg = await start(c, s.acct, g, "insurance");
      const { rows: [dg] } = await c.query("select contact_id, client_group_id from documents where id = $1", [rg.document_id]);
      expect(dg).toEqual({ contact_id: null, client_group_id: s.casa });
    }));

  it("refuses another account's request, an unknown item, and a revoked, completed or expired request, writing nothing (mutation: drop the account filter, or any one state check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const open = await request(c, s.acct, { contact_id: s.ana });
      const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
      const cases: [string, string, string, string][] = [
        [s.acctB, open, "insurance", "not_found"],
        [s.acct, open, "warranty", "no_item"],
        [s.acct, await request(c, s.acct, { contact_id: s.ana, revoked: true }), "insurance", "revoked"],
        [s.acct, await request(c, s.acct, { contact_id: s.ana, completed: true }), "insurance", "completed"],
        [s.acct, await request(c, s.acct, { contact_id: s.ana, created_at: old }), "insurance", "expired"],
      ];
      for (const [acct, req, key, want] of cases) expect([want, (await start(c, acct, req, key)).status]).toEqual([want, want]);
      const { rows: [n] } = await c.query<{ n: string }>("select count(*)::text as n from documents where account_id = $1", [s.acct]);
      expect(n!.n).toBe("0");
    }));

  it("the 21st start of a UTC day is rate_limited; yesterday's starts do not count (mutation: count every start ever, or allow 21 -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const req = await request(c, s.acct, { contact_id: s.ana });
      const first = await start(c, s.acct, req);
      await c.query("update document_versions set created_at = date_trunc('day', now(), 'UTC') - interval '1 minute' where id = $1", [first.version_id]);
      for (let i = 0; i < 20; i++) expect((await start(c, s.acct, req)).status).toBe("ok");
      expect((await start(c, s.acct, req)).status).toBe("rate_limited");
    }));

  it("over quota answers over_quota and too large answers too_large, each leaving no document behind (mutation: keep the document on a refused reservation -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const req = await request(c, s.acct, { contact_id: s.ana });
      const big = await one(c, "insert into documents (account_id, contact_id, title, category, source, created_by) values ($1,$2,'Big','other','upload','user_seed') returning id", [s.acct, s.ana]);
      for (let i = 0; i < 204; i++) await c.query("select public.reserve_document_version($1, $2, 26214400, 'application/pdf', 'b.pdf', 'user_seed')", [s.acct, big]);
      expect((await start(c, s.acct, req, "insurance", 26_214_400)).status).toBe("over_quota");
      expect((await start(c, s.acct, req, "insurance", 26_214_401)).status).toBe("too_large");
      const { rows: [n] } = await c.query<{ n: string }>("select count(*)::text as n from documents where request_id = $1", [req]);
      expect(n!.n).toBe("0");
    }));
});

describe("0080: the request completes on its last clean file (spec 4.5)", () => {
  it("the decisive clean verdict completes the request only when EVERY other item has a ready, CLEAN file: a ready-pending or ready-infected file does not answer its item (plan review I1; mutation: drop 'and v.scan_status = ''clean''' from the trigger -> Insurance's verdict completes it -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const req = await request(c, s.acct, { contact_id: s.ana });
      const done = async () => (await c.query<{ c: boolean }>("select completed_at is not null as c from document_requests where id = $1", [req])).rows[0]!.c;
      // Item Y (other) holds ONLY a ready-infected and a ready-pending file.
      const bad = await start(c, s.acct, req, "other");
      await ready(c, s.acct, bad);
      await verdict(c, s.acct, bad.version_id!, "infected");
      const waiting = await start(c, s.acct, req, "other");
      await ready(c, s.acct, waiting);
      // The decisive verdict: item X (insurance) gets a clean file. Y has ready files, none clean.
      const a = await start(c, s.acct, req, "insurance");
      await ready(c, s.acct, a);
      await verdict(c, s.acct, a.version_id!, "clean");
      expect(await done()).toBe(false);
      // Y's pending file turns clean: now every item is answered.
      await verdict(c, s.acct, waiting.version_id!, "clean");
      expect(await done()).toBe(true);
    }));

  it("a trashed clean file does not answer its item (mutation: drop 'and d.deleted_at is null' from the trigger -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const req = await request(c, s.acct, { contact_id: s.ana });
      const done = async () => (await c.query<{ c: boolean }>("select completed_at is not null as c from document_requests where id = $1", [req])).rows[0]!.c;
      const a = await start(c, s.acct, req, "insurance");
      await ready(c, s.acct, a);
      await verdict(c, s.acct, a.version_id!, "clean");
      await c.query("update documents set deleted_at = now(), deleted_by = 'user_seed' where id = $1", [a.document_id]);
      const b = await start(c, s.acct, req, "other");
      await ready(c, s.acct, b);
      await verdict(c, s.acct, b.version_id!, "clean");
      expect(await done()).toBe(false);
    }));

  it("a staff document's clean verdict touches no request (mutation: drop the request_id-is-null early return -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const req = await request(c, s.acct, { contact_id: s.ana, items: JSON.stringify([{ key: "insurance", category: "insurance", note: null }]) });
      const d = await one(c, "insert into documents (account_id, contact_id, title, category, source, created_by) values ($1,$2,'Mine','insurance','upload','user_seed') returning id", [s.acct, s.ana]);
      const { rows: [r] } = await c.query<{ r: { version_id: string } }>("select public.reserve_document_version($1, $2, 10, 'application/pdf', 'a.pdf', 'user_seed') as r", [s.acct, d]);
      await ready(c, s.acct, { status: "ok", document_id: d, version_id: r!.r.version_id });
      await verdict(c, s.acct, r!.r.version_id, "clean");
      const { rows: [q] } = await c.query<{ open: boolean }>("select completed_at is null as open from document_requests where id = $1", [req]);
      expect(q!.open).toBe(true);
    }));
});

describe("0080: the request's work-queue To-do (spec 4.5; deviation 4)", () => {
  it("one per request and kind, scoped to the request's own account; a client-role insert cannot set the links and an update cannot change them (mutations: drop the unique index, drop the account_id half of the FK, or either keep_task_links line -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const req = await request(c, s.acct, { contact_id: s.ana });
      const task = (reqId: string, kind: string) => attempt<{ id: string }>(c,
        "insert into tasks (account_id, contact_id, title, document_request_id, document_request_kind) values ($1,$2,'T',$3,$4) returning id", [s.acct, s.ana, reqId, kind]);
      const t1 = (await task(req, "received")).rows[0]!;
      await task(req, "storage_full");
      await expect(task(req, "received")).rejects.toMatchObject({ code: "23505", constraint: "tasks_document_request_once" });
      await expect(attempt(c, "insert into tasks (account_id, title, document_request_id) values ($1,'T',$2)", [s.acct, req]))
        .rejects.toMatchObject({ code: "23514", constraint: "tasks_document_request_coherent" });
      await expect(task(req, "lost")).rejects.toMatchObject({ code: "23514", constraint: "tasks_document_request_kind_check" });
      // A second, fresh request with no task yet (plan review minor 1 AND I1): req already holds both
      // kinds (from t1 and the storage_full row above), so a probe against req would hit
      // tasks_document_request_once first regardless of the thing actually under test. req2 lets the
      // cross-account FK check fail on 23503 specifically, and lets a dropped guard line fail on the
      // "mine" assertion below, never on the unique index.
      const req2 = await request(c, s.acct, { contact_id: s.ana });
      // Cross-account (plan review I1): the FK is on (account_id, document_request_id), so account B
      // cannot link a task to account A's request even though the bare id exists.
      await expect(attempt(c,
        "insert into tasks (account_id, title, document_request_id, document_request_kind) values ($1,'T',$2,'received')",
        [s.acctB, req2])).rejects.toMatchObject({ code: "23503", constraint: "tasks_document_request_fkey" });
      await actAs(c, { org_id: ORG, sub: SUB.owner });
      const { rows: [mine] } = await c.query<{ document_request_id: string | null; document_request_kind: string | null }>(
        "insert into tasks (account_id, contact_id, title, document_request_id, document_request_kind) values ($1,$2,'Forged',$3,'received') returning document_request_id, document_request_kind",
        [s.acct, s.ana, req2]);
      expect(mine).toEqual({ document_request_id: null, document_request_kind: null });
      const { rows: [kept] } = await c.query<{ document_request_kind: string }>(
        "update tasks set document_request_kind = 'storage_full', title = 'T2' where id = $1 returning document_request_kind", [t1.id]);
      expect(kept!.document_request_kind).toBe("received");
    }));
});

describe("0080: automation_log knows the document_request source (spec 4.2; deviation 11)", () => {
  it("a held document_request row is accepted; an unknown source is not (mutation: leave the source out of the CHECK -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await attempt(c, "insert into automation_log (account_id, source, channel, subject_key, status, held_until) values ($1,'document_request','sms','document_request:x','held', now() + interval '1 hour')", [s.acct]);
      await expect(attempt(c, "insert into automation_log (account_id, source, channel, subject_key, status) values ($1,'document_requests','sms','x','sent')", [s.acct]))
        .rejects.toMatchObject({ code: "23514", constraint: "automation_log_source_check" });
    }));
});
