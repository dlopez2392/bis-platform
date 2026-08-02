import { describe, it, expect } from "vitest";
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { userDb } from "../user-client";

const CLERK_API = "https://api.clerk.com/v1";
// The only Clerk user in this dev instance: danlopez508@gmail.com, app_role: agency_admin.
const DEV_USER_ID = "user_3H2QKPdnekiD0smDzYRIdDlf7am";

interface MintedSession {
  token: string;
  sessionId: string;
}

/**
 * Mints a real Clerk session token for the dev user via the Clerk Backend API:
 * POST /v1/sessions {user_id}, then POST /v1/sessions/{id}/tokens. Not stubbed —
 * this is the thing the whole milestone is betting on, so it has to be real.
 */
async function mintSession(): Promise<MintedSession> {
  const sk = process.env.CLERK_SECRET_KEY;
  if (!sk) throw new Error("CLERK_SECRET_KEY missing");

  const sessionRes = await fetch(`${CLERK_API}/sessions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sk}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: DEV_USER_ID }),
  });
  if (!sessionRes.ok) {
    throw new Error(`Clerk session create failed: ${sessionRes.status} ${await sessionRes.text()}`);
  }
  const session = (await sessionRes.json()) as { id: string };

  const tokenRes = await fetch(`${CLERK_API}/sessions/${session.id}/tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sk}`, "Content-Type": "application/json" },
  });
  if (!tokenRes.ok) {
    throw new Error(`Clerk token mint failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const token = (await tokenRes.json()) as { jwt: string };
  return { token: token.jwt, sessionId: session.id };
}

/**
 * Revokes a Clerk session minted for a test. Best-effort: a cleanup failure
 * must never mask a real assertion failure, so this never throws.
 */
async function revokeSession(sessionId: string): Promise<void> {
  const sk = process.env.CLERK_SECRET_KEY;
  if (!sk) return;
  try {
    await fetch(`${CLERK_API}/sessions/${sessionId}/revoke`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sk}` },
    });
  } catch {
    // best-effort cleanup only
  }
}

describe("userDb", () => {
  it("authenticates a real Clerk token against PostgREST, and RLS lets the agency admin read accounts", async () => {
    const { token, sessionId } = await mintSession();
    try {
      const db = userDb(token);
      const { data, error } = await db.from("accounts").select("id, name");
      if (error) throw new Error(`accounts select failed: ${JSON.stringify(error)}`);
      expect(error).toBeNull();

      // The only Clerk user is the agency admin: app.is_agency() short-circuits
      // the account-scoped branch, so they legitimately see every account (20
      // rows live in the dev DB as of this task, most of them leaked "Fixture
      // Co" rows from unrelated form-submission tests -- not this task's to
      // clean up). The exact count isn't the point: a real token authenticating
      // and RLS letting more than zero rows through is.
      expect(data).not.toBeNull();
      expect(data!.length).toBeGreaterThan(0);
      expect(data!.map((r) => r.name)).toContain("Test Client One");
    } finally {
      await revokeSession(sessionId);
    }
  });

  it("the publishable key alone, with no user token, reads zero rows -- the RLS control", async () => {
    // Same table, same query, but the caller carries only the anon/publishable
    // key -- no Clerk bearer token, so Postgres runs it as the `anon` role,
    // which matches none of accounts' `to authenticated` policies. If this
    // assertion is the only thing distinguishing "RLS is gating" from "the
    // table is wide open"; without it, the first test would pass identically
    // whether or not RLS were even enabled on accounts.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) throw new Error("Supabase url/anon env vars missing");

    const db = createClient(url, anon, { auth: { persistSession: false } });
    const { data, error } = await db.from("accounts").select("id, name");
    if (error) throw new Error(`accounts select failed: ${JSON.stringify(error)}`);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
