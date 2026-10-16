import { describe, it, expect } from "vitest";
import { Client } from "pg";
import "dotenv/config";
import { TEST_ORG_ID_PREFIX } from "../org-id";

/**
 * 0080 (plan review I3): both the start function and the completion trigger lock the request row
 * FOR NO KEY UPDATE before they read or act on it, in the same shape as reserve_document_version's
 * account lock (document-vault-reserve-lock.test.ts). Proven by holding session A's call open and
 * asking session B to act on the SAME request with a short lock_timeout: B must fail with 55P03
 * (lock_not_available). Without the lock, B's call returns normally instead of blocking, which is
 * exactly how two verdicts landing together could both miss seeing the other and leave a request
 * stuck incomplete. Committed seed, deleted in finally; its org id carries TEST_ORG_ID_PREFIX so a
 * run killed before the finally is cleared by the next run's sweep.
 */
const URL = process.env.SUPABASE_DB_URL;
const RUN = Math.random().toString(36).slice(2, 10);
const conn = () => new Client({ connectionString: URL, connectionTimeoutMillis: 10_000 });
const HASH = (n: number) => n.toString(16).padStart(64, "0");

type Started = { status: string; document_id?: string; version_id?: string };

async function cleanup(seedC: Client, acct: string | null) {
  if (!acct) return;
  await seedC.query("delete from documents where account_id = $1", [acct]);
  await seedC.query("delete from document_requests where account_id = $1", [acct]);
  await seedC.query("delete from contacts where account_id = $1", [acct]);
  await seedC.query("delete from accounts where id = $1", [acct]);
}

describe("start_document_request_upload serialises on the request row (spec 4.4; plan review I3)", () => {
  it("a second start on the same request waits for the first (mutation: drop `for no key update` from the request lock -> FAILS)", async () => {
    const seedC = conn(); const a = conn(); const b = conn();
    await Promise.all([seedC.connect(), a.connect(), b.connect()]);
    let acct: string | null = null;
    try {
      const { rows: [agency] } = await seedC.query<{ id: string }>("select id from agencies limit 1");
      acct = (await seedC.query<{ id: string }>(
        "insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'DRQ Lock') returning id", [agency!.id, `${TEST_ORG_ID_PREFIX}drqlock_${RUN}`])).rows[0]!.id;
      const contact = (await seedC.query<{ id: string }>("insert into contacts (account_id, first_name) values ($1,'Lock') returning id", [acct])).rows[0]!.id;
      const items = JSON.stringify([{ key: "insurance", category: "insurance", note: null }]);
      const req = (await seedC.query<{ id: string }>(
        `insert into document_requests (id, account_id, contact_id, items, language, token_hash, channel, created_by, expires_at)
         values (gen_random_uuid(), $1, $2, $3::jsonb, 'en', $4, 'link', 'user_lock', now() + interval '7 days') returning id`,
        [acct, contact, items, HASH(9000)])).rows[0]!.id;

      await a.query("begin");
      const ra = await a.query<{ r: Started }>(
        "select public.start_document_request_upload($1,$2,'insurance',10,'application/pdf','a.pdf','X') as r", [acct, req]);
      expect(ra.rows[0]!.r.status).toBe("ok");

      await b.query("begin");
      await b.query("set local lock_timeout = '300ms'");
      // "warranty" is not an item on this request: without the lock, B would resolve instantly with
      // status "no_item" (no exception) instead of blocking on A's open row lock.
      await expect(b.query(
        "select public.start_document_request_upload($1,$2,'warranty',10,'application/pdf','b.pdf','Y') as r", [acct, req]))
        .rejects.toMatchObject({ code: "55P03" });
      await b.query("rollback");
      await a.query("rollback");
    } finally {
      await a.query("rollback").catch(() => {});
      await b.query("rollback").catch(() => {});
      await cleanup(seedC, acct);
      await Promise.all([seedC.end(), a.end(), b.end()]);
    }
  });
});

describe("the completion trigger serialises on the request row (spec 4.5; plan review I3)", () => {
  it("a second verdict's completion check waits for the first's open trigger (mutation: drop `for no key update` from app.document_request_on_clean -> FAILS)", async () => {
    const seedC = conn(); const a = conn(); const b = conn();
    await Promise.all([seedC.connect(), a.connect(), b.connect()]);
    let acct: string | null = null;
    try {
      const { rows: [agency] } = await seedC.query<{ id: string }>("select id from agencies limit 1");
      acct = (await seedC.query<{ id: string }>(
        "insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'DRQ Lock2') returning id", [agency!.id, `${TEST_ORG_ID_PREFIX}drqlock2_${RUN}`])).rows[0]!.id;
      const contact = (await seedC.query<{ id: string }>("insert into contacts (account_id, first_name) values ($1,'Lock2') returning id", [acct])).rows[0]!.id;
      const items = JSON.stringify([{ key: "insurance", category: "insurance", note: null }, { key: "other", category: "other", note: "Permit" }]);
      const req = (await seedC.query<{ id: string }>(
        `insert into document_requests (id, account_id, contact_id, items, language, token_hash, channel, created_by, expires_at)
         values (gen_random_uuid(), $1, $2, $3::jsonb, 'en', $4, 'link', 'user_lock', now() + interval '7 days') returning id`,
        [acct, contact, items, HASH(9001)])).rows[0]!.id;

      const sA = (await seedC.query<{ r: Started }>(
        "select public.start_document_request_upload($1,$2,'insurance',10,'application/pdf','a.pdf','X') as r", [acct, req])).rows[0]!.r;
      await seedC.query("select public.mark_document_version_ready($1,$2,$3,10,$4)", [acct, sA.document_id, sA.version_id, "a".repeat(64)]);
      const sB = (await seedC.query<{ r: Started }>(
        "select public.start_document_request_upload($1,$2,'other',10,'application/pdf','b.pdf','Y') as r", [acct, req])).rows[0]!.r;
      await seedC.query("select public.mark_document_version_ready($1,$2,$3,10,$4)", [acct, sB.document_id, sB.version_id, "b".repeat(64)]);

      // A's clean verdict on item "insurance" leaves item "other" unanswered: the trigger locks the
      // request row, finds the request incomplete, writes nothing, but keeps the lock through A's
      // still-open transaction.
      await a.query("begin");
      const va = await a.query<{ r: { status: string } }>(
        "select public.record_document_scan($1,$2,$3,$4) as r", [acct, sA.version_id, "clean", null]);
      expect(va.rows[0]!.r.status).toBe("ok");

      await b.query("begin");
      await b.query("set local lock_timeout = '300ms'");
      await expect(b.query(
        "select public.record_document_scan($1,$2,$3,$4) as r", [acct, sB.version_id, "clean", null]))
        .rejects.toMatchObject({ code: "55P03" });
      await b.query("rollback");
      await a.query("rollback");
    } finally {
      await a.query("rollback").catch(() => {});
      await b.query("rollback").catch(() => {});
      await cleanup(seedC, acct);
      await Promise.all([seedC.end(), a.end(), b.end()]);
    }
  });
});
