import type { SupabaseClient } from "@supabase/supabase-js";
import { loggableError } from "@/lib/loggable-error";

/** The one Clerk Backend call this needs; `clerkClient()` satisfies it. */
export type ClerkOrgWriter = {
  organizations: {
    updateOrganization(organizationId: string, params: { name: string }): Promise<unknown>;
  };
};

/**
 * Renames an account's Clerk organisation (D-005).
 *
 * Clerk's invitation emails, and its own "Choose an organization" screen, name
 * the organisation — and that name was written once, by `createClientAccount`,
 * and never again, so a company whose name changed in BIS kept inviting its
 * staff under the old one.
 *
 * The name passed is the BRAND name (Branding's "Display name"), never
 * `accounts.name`: the invited person is the client, and `accounts.name` is
 * the agency's private label for them ("Rio Roofing — trial"), which the
 * rename step promises "only you see". Both start as the same string at
 * creation, so the two halves agree from the first invitation on.
 *
 * Fails SOFT, always: the BIS save has already happened when this runs, and
 * an unreachable Clerk must not turn it into a reported failure. It logs a
 * warning naming the organisation and returns false; nothing here throws.
 */
export async function syncClerkOrgName(
  db: SupabaseClient,
  clerk: () => Promise<ClerkOrgWriter>,
  accountId: string,
  name: string,
): Promise<boolean> {
  let orgId: string | null = null;
  try {
    const { data, error } = await db.from("accounts")
      .select("clerk_org_id").eq("id", accountId).maybeSingle();
    if (error) throw new Error(error.message);
    orgId = (data as { clerk_org_id: string | null } | null)?.clerk_org_id ?? null;
    if (!orgId) {
      console.warn(`syncClerkOrgName: account ${accountId} has no Clerk organisation; name not synced`);
      return false;
    }
    await (await clerk()).organizations.updateOrganization(orgId, { name });
    return true;
  } catch (e) {
    console.warn(
      `syncClerkOrgName: Clerk organisation ${orgId ?? "(unknown)"} for account ${accountId} keeps its old name: ${loggableError(e)}`,
    );
    return false;
  }
}
