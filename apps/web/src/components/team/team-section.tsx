import { listAccountTeam, type TeamMember } from "@bis/db";
import {
  inviteTeamMemberAction, setTeamRoleAction, setTeamLanguageAction, removeTeamMemberAction,
  undoRemoveTeamMemberAction, revokeTeamInvitationAction, undoRevokeTeamInvitationAction,
} from "@/app/(dashboard)/dashboard/accounts/[accountId]/team/actions";
import { dbForRequest } from "@/lib/db";
import type { Locale } from "@/lib/i18n/locale";
import { loggableError } from "@/lib/loggable-error";
import { listPendingInvitations, teamCapacity } from "@/lib/team/clerk-team";
import { inviteDefaultLanguage, roomLeft, type PendingInvite } from "@/lib/team/team-view";
import { TeamAccessOff, TeamCard, TeamLoadError } from "./team-card";
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
 * - The account is read ONCE, here, with select("*"): its Clerk organisation,
 *   whether client access is on, and its language, picked up once the Spanish
 *   runtime lane adds the column without naming a column that may not exist
 *   yet. The callers read nothing for it (fix round 1, M5).
 * - Client access off renders TeamAccessOff, not the card (spec §8: shown
 *   only while access is on). Settings already mounts this only while on;
 *   the gate is here so the agency's /team view obeys the same rule (M3).
 * - Every action is bound to THIS account here, server-side; the account id
 *   never travels from the browser.
 * - A failed team read renders the card's own error state rather than
 *   throwing: under Settings it shares a page with the client-access switch,
 *   which must stay reachable (client-access-section.tsx's reasoning).
 */
export async function TeamSection({
  accountId, viewer, locale = "en",
}: {
  accountId: string;
  viewer: TeamViewer;
  /** S-10 T6: the reader's own locale, resolved once by the page (Team's
   *  own route, or Settings' Client access card) and passed down. Optional,
   *  defaulting to "en" so every pre-existing caller is unaffected. */
  locale?: Locale;
}) {
  const db = await dbForRequest();

  let members: TeamMember[];
  let row: Record<string, unknown> | null;
  try {
    const [team, account] = await Promise.all([
      listAccountTeam(db, accountId),
      db.from("accounts").select("*").eq("id", accountId).maybeSingle(),
    ]);
    if (account.error) throw new Error(`account read failed: ${account.error.message}`);
    members = team;
    row = account.data as Record<string, unknown> | null;
  } catch (e) {
    console.error(`team: stored team unreadable for account ${accountId}: ${loggableError(e)}`);
    return <TeamLoadError locale={locale} />;
  }
  if (row?.client_access_enabled !== true) return <TeamAccessOff locale={locale} />;
  const clerkOrgId = typeof row.clerk_org_id === "string" && row.clerk_org_id ? row.clerk_org_id : null;

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
      locale={locale}
      members={members}
      pending={pending}
      room={room}
      clerkUnavailable={clerkUnavailable}
      defaultLanguage={inviteDefaultLanguage(row.language)}
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
