import { describe, it, expect } from "vitest";
import { Client } from "pg";
import "dotenv/config";

/**
 * 0105: start_agency_visit's advisory lock makes two simultaneous starts for one person, session and account
 * into ONE visit. Two real connections; the first holds its transaction open with the lock and its
 * uncommitted visit, so the second must WAIT, then see that visit once the first commits. Commits its own
 * account and agency (a second connection cannot see uncommitted rows) and deletes both in finally; the
 * account's delete cascades the visit away.
 *
 * Because it COMMITS, it runs only against a database on this machine (review r3): the local replica, or CI
 * verify's in-runner stack, whose SUPABASE_DB_URL ci-target-guard.sh pins to 127.0.0.1 or localhost. Any
 * other host (a cloud project such as bis-ci) skips it. Its org id carries the org_test_ prefix, so an
 * account a killed run strands is one the fixture sweep (sweep-fixtures.ts) removes.
 */
const url = () => process.env.SUPABASE_DB_URL!;
/** Never throws and never echoes the URL: a URL parse error message can carry a credential (2026-09-24). */
function onThisMachine(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}
const connect = async () => { const c = new Client({ connectionString: url(), connectionTimeoutMillis: 10_000 }); await c.connect(); return c; };
const START = "select public.start_agency_visit($1, 'user_race', 'Race', 'sess_race', 'support') as id";

describe("0105: concurrent starts", () => {
  it.skipIf(!onThisMachine(process.env.SUPABASE_DB_URL))("two concurrent starts for one person, session and account make ONE visit; the second waits for the first (mutation: pg_advisory_xact_lock -> pg_advisory_xact_lock_shared FAILS)", async () => {
    const admin = await connect();
    const c1 = await connect();
    const c2 = await connect();
    let accountId: string | null = null;
    let agencyId: string | null = null;
    try {
      agencyId = (await admin.query<{ id: string }>("insert into public.agencies (name) values ('Race') returning id")).rows[0]!.id;
      accountId = (await admin.query<{ id: string }>(
        "insert into public.accounts (agency_id, clerk_org_id, name) values ($1, $2, 'Race') returning id",
        [agencyId, `org_test_race_${Math.random().toString(36).slice(2, 10)}`])).rows[0]!.id;
      await c1.query("begin"); await c1.query("set local role service_role");
      const first = (await c1.query<{ id: string }>(START, [accountId])).rows[0]!.id;    // holds the lock; its row is uncommitted
      await c2.query("begin"); await c2.query("set local role service_role");
      const second = c2.query<{ id: string }>(START, [accountId]);
      const raced = await Promise.race([second.then(() => "finished"), new Promise((r) => setTimeout(() => r("waiting"), 750))]);
      expect(raced).toBe("waiting");
      await c1.query("commit");
      expect((await second).rows[0]!.id).toBe(first);
      await c2.query("commit");
      expect((await admin.query("select 1 from public.agency_visits where account_id = $1", [accountId])).rowCount).toBe(1);
    } finally {
      await c1.query("rollback").catch(() => undefined);
      await c2.query("rollback").catch(() => undefined);
      if (accountId) await admin.query("delete from public.accounts where id = $1", [accountId]);
      if (agencyId) await admin.query("delete from public.agencies where id = $1", [agencyId]);
      await Promise.all([c1.end(), c2.end(), admin.end()]);
    }
  });
});
