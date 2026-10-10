import { Suspense } from "react";
import { TeamSkeleton } from "@/components/team/team-card";
import { TeamSection } from "@/components/team/team-section";
import { setClientAccessAction } from "./actions";
import { ClientAccessPanel } from "./client-access-panel";

/**
 * The Client access card and, while access is on, the Team card under it
 * (staff and roles, Task 10). The Team card is the same one a client Owner
 * sees on /team, so the agency invites, changes roles and removes people
 * through the same actions (team/actions.ts) instead of the agency-only
 * invite this card used to carry. Spec §8: the Team card shows only while
 * client access is on; with access off nobody can sign in to be managed.
 *
 * This no longer reads Clerk at all. The live member list it used to fetch
 * (2026-10-08's reason for streaming this card) is TeamSection's job now,
 * in its own boundary, so the switch, the one control an agency must always
 * reach to turn access OFF, never waits on Clerk.
 *
 * Runs INSIDE the Settings page, after its requireAgencyOnlyAccountAccess.
 */
export function ClientAccessSection({
  accountId,
  clerkOrgId,
  enabled,
}: {
  accountId: string;
  clerkOrgId: string | null;
  enabled: boolean;
}) {
  // accountId is bound here, server-side. It must never travel as a form field.
  return (
    <>
      <ClientAccessPanel enabled={enabled} setAccessAction={setClientAccessAction.bind(null, accountId)} />
      {enabled ? (
        <Suspense fallback={<TeamSkeleton />}>
          <TeamSection accountId={accountId} clerkOrgId={clerkOrgId} viewer="agency" />
        </Suspense>
      ) : null}
    </>
  );
}
