import { Client } from "pg";
import "dotenv/config";

export async function withRollback(fn: (c: Client) => Promise<void>) {
  // Ten seconds, not pg's default of "forever": an unreachable host (the
  // direct db.<ref>.supabase.co address is IPv6-only, and GitHub-hosted
  // runners have no IPv6) otherwise hangs every test here to vitest's 60s
  // ceiling and the suite reports a wall of timeouts instead of one
  // connection error naming the cause. CI uses the Session-pooler URL.
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 });
  await c.connect();
  try {
    await c.query("begin");
    await fn(c);
  } finally {
    await c.query("rollback");
    await c.end();
  }
}

/** Simulate an RLS caller. Claims mirror Clerk session-token custom claims. */
export async function actAs(c: Client, claims: { org_id?: string; app_role?: string }) {
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
  await c.query("set local role authenticated");
}

export async function actAsOwner(c: Client) {
  await c.query("reset role");
}
