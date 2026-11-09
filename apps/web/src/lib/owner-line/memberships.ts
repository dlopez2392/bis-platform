// apps/web/src/lib/owner-line/memberships.ts
// A person's own business memberships, for the "Call in to your business" card (F-032 §3.1: one card per
// membership). The caller passes serviceDb(), keyed on Clerk's own userId: the pre-trust read preferences/actions.ts
// and person-prefs.ts already use. The businesses come back only through the person's own memberships, and only
// those with client access on and not archived. businessName is brandDisplayName's answer, never accounts.name.
// Every role comes back: which roles are OFFERED the owner line is OWNER_LINE_ROLES (./data-path.ts), applied by the
// caller.
import type { SupabaseClient, AccountRole, Branding } from "@bis/db";
import { brandDisplayName } from "@/lib/email/templates/shell";

export type MyMembership = { accountId: string; userId: string; role: AccountRole; businessName: string; number: string | null };

type Row = {
  account_id: string; user_id: string; role: AccountRole;
  accounts: { client_access_enabled: boolean; status: string; brand_name: string | null } | null;
};

export async function listMyMemberships(db: SupabaseClient, clerkUserId: string): Promise<MyMembership[]> {
  const { data, error } = await db.from("memberships")
    .select("account_id, user_id, role, users!inner(clerk_user_id), accounts!inner(client_access_enabled, status, brand_name)")
    .eq("scope", "account").eq("users.clerk_user_id", clerkUserId);
  if (error) throw new Error(`listMyMemberships failed: ${error.message}`);
  const rows = ((data ?? []) as unknown as Row[])
    .filter((r) => r.accounts?.client_access_enabled === true && r.accounts.status !== "archived");
  if (rows.length === 0) return [];
  const { data: nums, error: nErr } = await db.from("phone_numbers")
    .select("account_id, e164, status").in("account_id", rows.map((r) => r.account_id)).in("status", ["live", "testing"]);
  if (nErr) throw new Error(`listMyMemberships numbers failed: ${nErr.message}`);
  const numberOf = (id: string) => {
    const mine = ((nums ?? []) as { account_id: string; e164: string; status: string }[]).filter((n) => n.account_id === id);
    return (mine.find((n) => n.status === "live") ?? mine[0])?.e164 ?? null;
  };
  return rows.map((r) => ({
    accountId: r.account_id, userId: r.user_id, role: r.role, number: numberOf(r.account_id),
    // brandDisplayName reads brandName only (lib/email/templates/shell.ts:46), so no other Branding column is needed.
    businessName: brandDisplayName({ brandName: r.accounts?.brand_name ?? null } as Branding),
  }));
}

export async function myMembership(db: SupabaseClient, clerkUserId: string, accountId: string): Promise<MyMembership | null> {
  return (await listMyMemberships(db, clerkUserId)).find((x) => x.accountId === accountId) ?? null;
}
