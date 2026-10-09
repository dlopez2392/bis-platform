import { clerkClient } from "@clerk/nextjs/server";
import { m } from "@/lib/messages";
import { inviteClientAdminAction, setClientAccessAction } from "./actions";
import { ClientAccessPanel, type ClientAccessMember } from "./client-access-panel";

/**
 * The Client access card, with its member list read live from Clerk. Streamed
 * in its own <Suspense> on the Settings page (the Billing card's pattern), so
 * the page no longer waits on two sequential Clerk Backend API calls before
 * painting anything. On 2026-10-08 that wait outlasted e2e's 10s: the palette's
 * jump to Settings sat on the previous page with nothing on screen
 * (palette.spec.ts, main run 37815300116).
 *
 * Runs INSIDE the Settings page, after its requireAgencyOnlyAccountAccess.
 */
export async function ClientAccessSection({
  accountId,
  clerkOrgId,
  enabled,
}: {
  accountId: string;
  clerkOrgId: string | null;
  enabled: boolean;
}) {
  // No Clerk->Postgres member sync exists (see design doc §7) — Clerk is the
  // only source of truth for who is seated in this account's organization,
  // so the member list is read live from the Backend API rather than a
  // local table.
  //
  // Unguarded, this call takes the whole page offline on any Clerk 4xx/5xx/
  // rate-limit — including for an accounts row whose Clerk org has been
  // deleted out from under it, which has already happened on this project.
  // That would be uniquely bad here: this is the only page hosting the
  // client-access switch, so an agency admin who needed to reach it to turn
  // access OFF would be unable to load the page at all. Fail soft instead —
  // empty member list, inline note, switch renders regardless.
  let members: ClientAccessMember[] = [];
  let pendingInvites: ClientAccessMember[] = [];
  let membersUnavailable = false;
  if (clerkOrgId) {
    try {
      const clerk = await clerkClient();
      const membershipList = await clerk.organizations.getOrganizationMembershipList({
        organizationId: clerkOrgId,
      });
      members = membershipList.data.map((membership) => ({
        id: membership.id,
        email: membership.publicUserData?.identifier ?? m["common.unavailable"],
        role: membership.role.replace(/^org:/, "").replace(/^\w/, (c) => c.toUpperCase()),
      }));

      // Pending invitations too. Without these the panel lists only people who
      // have already ACCEPTED, so after inviting someone the agency sees no
      // change at all — the success toast is transient and gone on reload,
      // leaving no way to tell whether an invite was ever sent. Re-inviting
      // the same address then fails with the generic error.
      const invitationList = await clerk.organizations.getOrganizationInvitationList({
        organizationId: clerkOrgId,
        status: ["pending"],
      });
      pendingInvites = invitationList.data.map((invitation) => ({
        id: invitation.id,
        email: invitation.emailAddress,
        role: invitation.role.replace(/^org:/, "").replace(/^\w/, (c) => c.toUpperCase()),
      }));
    } catch (e) {
      console.error(`settings: member list fetch failed for org ${clerkOrgId}: ${String(e)}`);
      membersUnavailable = true;
    }
  }

  // accountId is bound here, server-side. It must never travel as a form field.
  return (
    <ClientAccessPanel
      enabled={enabled}
      members={members}
      pendingInvites={pendingInvites}
      membersUnavailable={membersUnavailable}
      setAccessAction={setClientAccessAction.bind(null, accountId)}
      inviteAction={inviteClientAdminAction.bind(null, accountId)}
    />
  );
}
