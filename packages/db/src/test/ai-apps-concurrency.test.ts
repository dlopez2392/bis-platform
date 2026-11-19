import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import "dotenv/config";

/**
 * 20261119152434_ai_apps.sql: note_ai_app_read's advisory lock on the person makes its count and its insert one
 * step per person, so two reads racing at the 59th row cannot both pass the 60-in-ten-minutes limit. Two real
 * connections: the first holds its transaction open with the lock and its uncommitted 60th visit, so the second must
 * WAIT, then count 60 once the first commits, and be refused. Without the lock the second counts 59 (it cannot see
 * the first's uncommitted row) and a 61st read lands.
 *
 * Because it COMMITS (a second connection cannot see uncommitted rows), it runs only against a database on this
 * machine, the local replica or CI verify's in-runner stack, exactly as access-log-concurrency.test.ts does; its
 * onThisMachine is copied from there (whose it.each pins every shape it refuses). It commits an account under the
 * stack's existing agency (that file's reason: never an agency of its own), with the org_test_ prefix so a killed
 * run's account is one the fixture sweep removes, and deletes what it made in finally.
 */
const url = () => process.env.SUPABASE_DB_URL!;
function onThisMachine(raw: string | undefined): boolean {
  if (!raw || raw.includes("?")) return false;
  try {
    const host = new URL(raw).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}
const connect = async () => { const c = new Client({ connectionString: url(), connectionTimeoutMillis: 10_000 }); await c.connect(); return c; };
const NOTE = "select public.note_ai_app_read($1, $2, 'Race', 'ai_app_appointments', $3) as v";

describe("note_ai_app_read: concurrent reads at the limit", () => {
  it.skipIf(!onThisMachine(process.env.SUPABASE_DB_URL))("two reads racing for the 60th place: the second waits for the first, then is refused, and 60 visits stand (mutation: drop the pg_advisory_xact_lock -> the second does not wait and a 61st lands, FAILS)", async () => {
    const admin = await connect();
    const c1 = await connect();
    const c2 = await connect();
    const tag = Math.random().toString(36).slice(2, 10);
    const clerk = `user_test_ai_race_${tag}`;
    let accountId: string | null = null;
    let userId: string | null = null;
    try {
      const agencyId = (await admin.query<{ id: string }>("select id from public.agencies limit 1")).rows[0]!.id;
      accountId = (await admin.query<{ id: string }>(
        "insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1, $2, 'AI race', true) returning id",
        [agencyId, `org_test_ai_race_${tag}`])).rows[0]!.id;
      userId = (await admin.query<{ id: string }>(
        "insert into public.users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [clerk])).rows[0]!.id;
      await admin.query("insert into public.memberships (user_id, scope, account_id, role) values ($1, 'account', $2, 'owner')", [userId, accountId]);
      await admin.query("update public.accounts set ai_apps_enabled_at = now(), ai_apps_changed_at = now(), ai_apps_changed_by = $2 where id = $1",
        [accountId, userId]);
      await admin.query(
        `insert into public.agency_visits (account_id, actor_kind, actor_clerk_user_id, clerk_session_id, reason)
         select $1, 'ai_app', $2, 'ai_app:' || gen_random_uuid(), 'ai_app_read' from generate_series(1, 59)`, [accountId, clerk]);

      await c1.query("begin"); await c1.query("set local role service_role");
      await c1.query(NOTE, [accountId, clerk, randomUUID()]);   // the 60th: holds the lock, its row uncommitted
      await c2.query("begin"); await c2.query("set local role service_role");
      const second = c2.query(NOTE, [accountId, clerk, randomUUID()]);
      second.catch(() => undefined);   // awaited below; this only keeps an early rejection from being unhandled
      const raced = await Promise.race([second.then(() => "finished", () => "finished"),
        new Promise((r) => setTimeout(() => r("waiting"), 750))]);
      expect(raced).toBe("waiting");
      await c1.query("commit");
      await expect(second).rejects.toMatchObject({ code: "P0001", message: "note_ai_app_read: rate_limited" });
      await c2.query("rollback");
      const { rows: [n] } = await admin.query<{ n: number }>(
        "select count(*)::int as n from public.agency_visits where actor_clerk_user_id = $1 and actor_kind = 'ai_app'", [clerk]);
      expect(n!.n).toBe(60);
    } finally {
      await c1.query("rollback").catch(() => undefined);
      await c2.query("rollback").catch(() => undefined);
      if (userId && accountId) await admin.query("delete from public.memberships where user_id = $1", [userId]);
      if (accountId) await admin.query("delete from public.accounts where id = $1", [accountId]);
      if (userId) await admin.query("delete from public.users where id = $1", [userId]);
      await Promise.all([c1.end(), c2.end(), admin.end()]);
    }
  });
});
