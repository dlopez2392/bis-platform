import { describe, it, expect } from "vitest";
import { Client } from "pg";
import "dotenv/config";
import { TEST_ORG_ID_PREFIX } from "../org-id";

/**
 * Spec section 3.5: "Two simultaneous uploads therefore cannot both slip under the limit." The
 * reservation locks the account row FOR NO KEY UPDATE (which conflicts with itself, and not with the FOR KEY SHARE a child insert takes) before it sums; a second session's reservation waits
 * for the first to end. Proven by holding session A's reservation open and asking session B to
 * reserve with a 300 ms lock timeout: B must fail with 55P03 (lock_not_available). Without the lock,
 * B would sum A's uncommitted row as absent and pass. Committed seed, deleted in finally; its org id carries
 * TEST_ORG_ID_PREFIX so a run killed before the finally is cleared by the next run's sweep.
 */
const URL = process.env.SUPABASE_DB_URL;
const RUN = Math.random().toString(36).slice(2, 10);
const conn = () => new Client({ connectionString: URL, connectionTimeoutMillis: 10_000 });

describe("reserve_document_version serialises on the account row", () => {
  it("a second reservation waits for the first (mutation: drop `for no key update` from the account lock -> FAILS)", async () => {
    const seedC = conn(); const a = conn(); const b = conn();
    await Promise.all([seedC.connect(), a.connect(), b.connect()]);
    let acct: string | null = null;
    try {
      const { rows: [agency] } = await seedC.query<{ id: string }>("select id from agencies limit 1");
      acct = (await seedC.query<{ id: string }>(
        "insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'DV Lock') returning id", [agency!.id, `${TEST_ORG_ID_PREFIX}dvlock_${RUN}`])).rows[0]!.id;
      const contact = (await seedC.query<{ id: string }>("insert into contacts (account_id, first_name) values ($1,'Lock') returning id", [acct])).rows[0]!.id;
      const doc = (await seedC.query<{ id: string }>(
        `insert into documents (account_id, contact_id, title, category, source, created_by)
         values ($1,$2,'Lock','other','upload','user_lock') returning id`, [acct, contact])).rows[0]!.id;

      await a.query("begin");
      const ra = await a.query("select public.reserve_document_version($1,$2,10,'application/pdf','a.pdf','user_lock') as r", [acct, doc]);
      expect((ra.rows[0] as { r: { status: string } }).r.status).toBe("ok");

      await b.query("begin");
      await b.query("set local lock_timeout = '300ms'");
      await expect(b.query("select public.reserve_document_version($1,$2,10,'application/pdf','b.pdf','user_lock') as r", [acct, doc]))
        .rejects.toMatchObject({ code: "55P03" });
      await b.query("rollback");
      await a.query("rollback");
    } finally {
      await a.query("rollback").catch(() => {});
      await b.query("rollback").catch(() => {});
      if (acct) {
        await seedC.query("delete from documents where account_id = $1", [acct]);
        await seedC.query("delete from contacts where account_id = $1", [acct]);
        await seedC.query("delete from accounts where id = $1", [acct]);
      }
      await Promise.all([seedC.end(), a.end(), b.end()]);
    }
  });
});
