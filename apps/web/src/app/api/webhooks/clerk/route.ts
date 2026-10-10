import { Webhook } from "svix";
import { serviceDb, reconcileMembership, upsertUserFromClerk, isAgencyMetadata } from "@bis/db";
import { liveClerkTeamPort } from "@/lib/team/clerk-team";
import { loggableError } from "@/lib/loggable-error";

type ClerkEvent = { type?: string; data?: {
  id?: string; first_name?: string | null; last_name?: string | null; primary_email_address_id?: string | null;
  email_addresses?: { id: string; email_address: string }[]; public_metadata?: unknown;
  organization?: { id?: string }; public_user_data?: { user_id?: string } } };

/**
 * Public route (apps/web/src/proxy.ts protects /dashboard only): authenticated
 * by its Svix signature, never by a Clerk session. Production only (coordinator
 * ruling 2026-10-10) — there is no webhook endpoint for Preview, and CI/e2e
 * must never need CLERK_WEBHOOK_SIGNING_SECRET; everywhere else the secret is
 * unset and the route answers 503 while `reconcileMembership`'s "fallback"
 * mode (read on an in-account request) keeps memberships in step instead.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  // Unset everywhere but Production: 503, quietly. Read for presence only,
  // never echoed (global-constraints.md).
  if (!secret) return new Response("not configured", { status: 503 });
  const payload = await request.text();
  let event: ClerkEvent;
  try {
    event = new Webhook(secret).verify(payload, {
      "svix-id": request.headers.get("svix-id") ?? "", "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
      "svix-signature": request.headers.get("svix-signature") ?? "" }) as ClerkEvent;
  } catch { return new Response("invalid signature", { status: 400 }); }   // never read an unverified payload
  const d = event.data ?? {};
  try {
    switch (event.type) {
      case "organizationMembership.created":
      case "organizationMembership.deleted": {
        const clerkUserId = d.public_user_data?.user_id; const clerkOrgId = d.organization?.id;
        if (!clerkUserId || !clerkOrgId) return new Response("ignored", { status: 200 });
        // Plan deviation 7: re-reads Clerk's CURRENT membership rather than
        // applying this event's payload, so a replayed `created` that
        // arrives after a `deleted` converges to absent instead of
        // resurrecting the row.
        await reconcileMembership(serviceDb(), liveClerkTeamPort(), { clerkUserId, clerkOrgId, mode: "webhook" });
        return new Response("ok", { status: 200 });
      }
      case "user.created":
      case "user.updated": {
        // Plan deviation 6: an agency user (app_role: "agency_admin") is
        // never synced into a client team's `users` row.
        if (!d.id || isAgencyMetadata(d.public_metadata)) return new Response("ignored", { status: 200 });
        const email = d.email_addresses?.find((e) => e.id === d.primary_email_address_id)?.email_address;
        if (!email) return new Response("ignored", { status: 200 });
        const name = [d.first_name, d.last_name].filter(Boolean).join(" ") || null;
        await upsertUserFromClerk(serviceDb(), { clerkUserId: d.id, email, name });
        return new Response("ok", { status: 200 });
      }
      default: return new Response("ignored", { status: 200 });
    }
  } catch (e) {
    console.error(`clerk webhook: ${event.type} failed: ${loggableError(e)}`);
    return new Response("retry", { status: 500 });
  }
}
