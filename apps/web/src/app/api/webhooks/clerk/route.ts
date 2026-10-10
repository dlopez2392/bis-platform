import { Webhook } from "svix";
import { serviceDb, reconcileMembership, upsertUserFromClerk, isAgencyMetadata } from "@bis/db";
import { liveClerkTeamPort, reassertClerkRole } from "@/lib/team/clerk-team";
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
      // `organizationMembership.updated` is @clerk/backend 3.13.1's own name
      // (dist/api/resources/Webhooks.d.ts:20, OrganizationMembershipWebhookEvent,
      // payload OrganizationMembershipJSON: organization.id, public_user_data.user_id).
      case "organizationMembership.created":
      case "organizationMembership.updated":
      case "organizationMembership.deleted": {
        const clerkUserId = d.public_user_data?.user_id; const clerkOrgId = d.organization?.id;
        if (!clerkUserId || !clerkOrgId) return new Response("ignored", { status: 200 });
        // Plan deviation 7: re-reads Clerk's CURRENT membership rather than
        // applying this event's payload, so a replayed `created` that
        // arrives after a `deleted` converges to absent instead of
        // resurrecting the row.
        const settle = async () => {
          const r = await reconcileMembership(serviceDb(), liveClerkTeamPort(), { clerkUserId, clerkOrgId, mode: "webhook" });
          return r.outcome === "created" || r.outcome === "exists" ? r.role : null;
        };
        // Review I2: where BIS holds a row, Clerk's role FOLLOWS it, so an
        // edit in Clerk's dashboard or through its browser API cannot drift
        // it (BIS Staff beside Clerk org:admin is the pair that must never
        // stand). reassertClerkRole writes only what disagrees, so its own
        // write's `updated` event ends here. A write that landed is followed
        // by one more BIS read, in case a Team role change raced it.
        const role = await settle();
        if (role) {
          const a = await reassertClerkRole(clerkOrgId, clerkUserId, role);
          if (!a.ok) throw new Error(`re-assert of the Clerk role failed (${a.code ?? "no code"})`);
          const now = a.changed ? await settle() : role;
          if (now && now !== role) {
            const b = await reassertClerkRole(clerkOrgId, clerkUserId, now);
            if (!b.ok) throw new Error(`re-assert of the Clerk role failed (${b.code ?? "no code"})`);
          }
        }
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
