import { readPersonId, listAccountTeam, type AccountRole, type AssigneeFilter, type SupabaseClient } from "@bis/db";
import { seesWholeAccount } from "@/lib/auth-role";
import { assigneeFilterFor, parseWho, type Who } from "./who";

/** A person who can hold a customer or a task, as a picker shows them. */
export type AssignMember = { userId: string; label: string; role: AccountRole };

/**
 * What a list page needs for Mine / Unassigned (spec §8-§9), read once:
 * - `who`: the filter actually in effect, carried on every pager and sort
 *   link. "Mine" with no person in this company (the agency: never a member, A5) is All, so no link
 *   claims a filter the list is not applying.
 * - `assignee`: what the list query and its count are filtered by, so the
 *   pager and the header's real total describe the same rows.
 * - `canAssign`, `showMine`, `members`: what the assignment controls render.
 *
 * A Technician, and a client whose role could not be settled, get no filter
 * at all: RLS (0068) already makes their lists theirs, so "Unassigned" would
 * always be empty and "Mine" the same as All. Nothing is read for them,
 * unless `opts.viewer` asks for their own person: a screen with a read-only
 * "Assigned to" says "You" only for a holder who IS the viewer (Task 7 fix
 * round 1, I1), and a role read that failed leaves an Owner here too.
 */
export type AssignView = {
  who: Who;
  personId: string | null;
  assignee: AssigneeFilter | undefined;
  canAssign: boolean;
  showMine: boolean;
  members: AssignMember[];
};

export async function loadAssignView(
  db: SupabaseClient, accountId: string,
  access: { userId: string; isAgency: boolean; role: AccountRole | null },
  rawWho: string | undefined, opts: { members: boolean; viewer?: boolean },
): Promise<AssignView> {
  if (!seesWholeAccount(access)) {
    const personId = opts.viewer ? await readPersonId(db, accountId, access.userId) : null;
    return { who: "all", personId, assignee: undefined, canAssign: false, showMine: false, members: [] };
  }
  const [personId, team] = await Promise.all([
    readPersonId(db, accountId, access.userId),
    opts.members ? listAccountTeam(db, accountId) : Promise.resolve([]),
  ]);
  const asked = parseWho(rawWho);
  const assignee = assigneeFilterFor(asked, personId);
  return {
    who: assignee ? asked : "all",
    personId,
    assignee,
    canAssign: true,
    showMine: personId !== null,
    members: team.map((t) => ({ userId: t.userId, label: t.name ?? t.email, role: t.role })),
  };
}
