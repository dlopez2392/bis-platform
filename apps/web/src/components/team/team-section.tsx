import { listAccountTeam, type TeamMember } from "@bis/db";
import {
  inviteTeamMemberAction, setTeamRoleAction, setTeamLanguageAction, removeTeamMemberAction,
  undoRemoveTeamMemberAction, revokeTeamInvitationAction, undoRevokeTeamInvitationAction,
} from "@/app/(dashboard)/dashboard/accounts/[accountId]/team/actions";
import { dbForRequest } from "@/lib/db";
import { loggableError } from "@/lib/loggable-error";
import { listPendingInvitations, teamCapacity } from "@/lib/team/clerk-team";
import { inviteDefaultLanguage, roomLeft, type PendingInvite } from "@/lib/team/team-view";
import { TeamCard, TeamLoadError } from "./team-card";
import type { TeamViewer } from "./team-copy";

/**
 * Loads the Team card (spec §8). Runs INSIDE its caller's guard: the Team
 * page's requireAccountOwner, or Settings' requireAgencyOnlyAccountAccess.
 *
 * - The team is BIS's stored list (`listAccountTeam` on the RLS client: a
 *   client reads its own company's memberships since 0066, the agency all).
 * - Clerk answers only what BIS does not store: pending invitations and the
 *   login cap. When Clerk cannot be read, the card says so and STILL shows
 *   the stored list (spec §8's unreachable state). The two Clerk reads are
 *   one unit: half an answer (invitations without the cap, or the reverse)
 *   would show a room count that ignores what it cannot see.
 * - The account is read with select("*") so its language is picked up once
 *   the Spanish runtime lane adds the column, without naming a column that
 *   may not exist yet.
 * - Every action is bound to THIS account here, server-side; the account id
 *   never travels from the browser.
 * - A failed team read renders the card's own error state rather than
 *   throwing: under Settings it shares a page with the client-access switch,
 *   which must stay reachable (client-access-section.tsx's reasoning).
 */
export async function TeamSection({
  accountId, clerkOrgId, viewer,
}: { accountId: string; clerkOrgId: string | null; viewer: TeamViewer }) {
  const db = await dbForRequest();

  let members: TeamMember[];
  let accountLanguage: unknown;
  try {
    const [team, account] = await Promise.all([
      listAccountTeam(db, accountId),
      db.from("accounts").select("*").eq("id", accountId).maybeSingle(),
    ]);
    if (account.error) throw new Error(`account read failed: ${account.error.message}`);
    members = team;
    accountLanguage = (account.data as Record<string, unknown> | null)?.language;
  } catch (e) {
    console.error(`team: stored team unreadable for account ${accountId}: ${loggableError(e)}`);
    return <TeamLoadError />;
  }

  let pending: PendingInvite[] = [];
  let room: number | null = null;
  let clerkUnavailable = false;
  if (clerkOrgId) {
    try {
      const [invites, cap] = await Promise.all([listPendingInvitations(clerkOrgId), teamCapacity(clerkOrgId)]);
      pending = invites;
      room = roomLeft(cap);
    } catch (e) {
      console.error(`team: Clerk unreadable for account ${accountId}: ${loggableError(e)}`);
      clerkUnavailable = true;
    }
  }

  return (
    <TeamCard
      members={members}
      pending={pending}
      room={room}
      clerkUnavailable={clerkUnavailable}
      defaultLanguage={inviteDefaultLanguage(accountLanguage)}
      viewer={viewer}
      actions={{
        invite: inviteTeamMemberAction.bind(null, accountId),
        setRole: setTeamRoleAction.bind(null, accountId),
        setLanguage: setTeamLanguageAction.bind(null, accountId),
        remove: removeTeamMemberAction.bind(null, accountId),
        undoRemove: undoRemoveTeamMemberAction.bind(null, accountId),
        revoke: revokeTeamInvitationAction.bind(null, accountId),
        undoRevoke: undoRevokeTeamInvitationAction.bind(null, accountId),
      }}
    />
  );
}
