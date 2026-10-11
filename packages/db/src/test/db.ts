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
export async function actAs(c: Client, claims: { org_id?: string; app_role?: string; sub?: string }) {
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
  await c.query("set local role authenticated");
}

/**
 * A client caller WITH a membership (0068, spec A1): a client token with no
 * membership sees no customers, so a positive client case must act as a real
 * member. Seeds a users row and a membership (as the table owner, before the
 * role switch) and returns the seeded sub.
 */
export async function actAsMember(
  c: Client, accountId: string, orgId: string, role: "owner" | "staff" | "technician" = "owner",
): Promise<string> {
  const sub = `user_member_${role}_${Math.random().toString(36).slice(2, 10)}`;
  const { rows: [u] } = await c.query<{ id: string }>(
    "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [sub]);
  await c.query("insert into memberships (user_id, scope, account_id, role) values ($1, 'account', $2, $3)", [u!.id, accountId, role]);
  await actAs(c, { org_id: orgId, sub });
  return sub;
}

export async function actAsOwner(c: Client) {
  await c.query("reset role");
}
