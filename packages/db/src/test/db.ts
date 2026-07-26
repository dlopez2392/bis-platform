import { Client } from "pg";
import "dotenv/config";

export async function withRollback(fn: (c: Client) => Promise<void>) {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL });
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
