import { toast } from "sonner";
import type { AccountRole, PersonLanguage, TeamMember } from "@bis/db";
import type { TeamResult } from "@/app/(dashboard)/dashboard/accounts/[accountId]/team/actions";
import { m } from "@/lib/messages";
import { UNDO_WINDOW_MS, type PendingInvite } from "@/lib/team/team-view";
import { LANGUAGE_NAME, ROLE_PILL, displayName, fill, teamErrorCopy, type TeamViewer } from "./team-copy";

/**
 * What the Team card does when a control is used (spec §8, rule 6): every
 * change runs AT ONCE, then a toast says what happened and offers Undo. No
 * confirm dialog, no typed name: each of these is reversible. Plain async
 * functions rather than hooks, so team-card.test.ts reaches every toast,
 * every Undo and the undo window without a DOM.
 */

/** The Team actions with the account already bound server-side (TeamSection). */
export type BoundTeamActions = {
  invite: (formData: FormData) => Promise<TeamResult>;
  setRole: (userId: string, role: AccountRole) => Promise<TeamResult & { previous?: AccountRole }>;
  setLanguage: (userId: string, language: PersonLanguage | null) => Promise<TeamResult & { previous?: PersonLanguage | null }>;
  remove: (userId: string) => Promise<TeamResult & { undo?: { userId: string } }>;
  undoRemove: (userId: string) => Promise<TeamResult>;
  revoke: (invitationId: string) => Promise<TeamResult & { undo?: { email: string; role: AccountRole; language: PersonLanguage } }>;
  undoRevoke: (email: string, role: AccountRole, language: PersonLanguage) => Promise<TeamResult>;
};

/**
 * How long an Undo toast stays up. The server re-admits a removed person
 * only within UNDO_WINDOW_MS of the removal it logged (team-view.ts), so the
 * toast must close well inside that. Sonner's own default (4 s) is short
 * for a decision; ten seconds is enough to notice a wrong row.
 */
export const TEAM_TOAST_MS = 10_000;

/** Runs one action; a throw (a stale page, a server fault) becomes the house "reload" sentence. */
async function run<R extends TeamResult>(call: () => Promise<R>, viewer: TeamViewer): Promise<R | null> {
  let r: R;
  try {
    r = await call();
  } catch {
    toast.error(m["common.actionCrashed"]);
    return null;
  }
  if (!r.ok) {
    toast.error(teamErrorCopy(r.error, viewer));
    return null;
  }
  return r;
}

function undoable(message: string, undo: () => void) {
  toast.success(message, { duration: TEAM_TOAST_MS, action: { label: m["common.undo"], onClick: undo } });
}

/** Returns the dialog's sentence on a refusal (the dialog stays open, spec §9), or null once sent. */
export async function inviteMember(actions: BoundTeamActions, formData: FormData, viewer: TeamViewer): Promise<string | null> {
  let r: TeamResult;
  try {
    r = await actions.invite(formData);
  } catch {
    return m["common.actionCrashed"];
  }
  if (!r.ok) return teamErrorCopy(r.error, viewer);
  toast.success(fill(m["team.invite.sent"], { email: String(formData.get("email") ?? "").trim() }));
  return null;
}

export async function changeRole(actions: BoundTeamActions, member: TeamMember, role: AccountRole, viewer: TeamViewer): Promise<void> {
  const r = await run(() => actions.setRole(member.userId, role), viewer);
  if (!r) return;
  const name = displayName(member);
  const message = fill(m["team.role.changed"], { name, role: ROLE_PILL[role].label });
  const previous = r.previous;
  if (!previous || previous === role) { toast.success(message); return; }
  undoable(message, () => { void run(() => actions.setRole(member.userId, previous), viewer); });
}

export async function changeLanguage(
  actions: BoundTeamActions, member: TeamMember, language: PersonLanguage, viewer: TeamViewer,
): Promise<void> {
  const r = await run(() => actions.setLanguage(member.userId, language), viewer);
  if (!r) return;
  const message = fill(m["team.language.changed"], { name: displayName(member), language: LANGUAGE_NAME[language] });
  if (r.previous === undefined) { toast.success(message); return; }
  const previous = r.previous;
  undoable(message, () => { void run(() => actions.setLanguage(member.userId, previous), viewer); });
}

/**
 * The undo handle is the user id alone; the server restores role and
 * language from the removal it logged, and only within UNDO_WINDOW_MS. The
 * toast closes long before that, but a hovered toast pauses, so the click
 * is checked against the window here too and refused in words rather than
 * sent to a server that will refuse it anyway.
 */
export async function removeMember(
  actions: BoundTeamActions, member: TeamMember, viewer: TeamViewer, now: () => number = Date.now,
): Promise<void> {
  const r = await run(() => actions.remove(member.userId), viewer);
  if (!r) return;
  const name = displayName(member);
  const message = fill(m["team.removed"], { name });
  const handle = r.undo;
  if (!handle) { toast.success(message); return; }
  const at = now();
  undoable(message, () => {
    if (now() - at > UNDO_WINDOW_MS) { toast.error(m["team.undo.expired"]); return; }
    void run(() => actions.undoRemove(handle.userId), viewer).then((back) => {
      if (back) toast.success(fill(m["team.undone.remove"], { name }));
    });
  });
}

/** Undo re-invites with what the revoke returned; Clerk sends a fresh email, and the toast says so. */
export async function revokeInvite(actions: BoundTeamActions, invite: PendingInvite, viewer: TeamViewer): Promise<void> {
  const r = await run(() => actions.revoke(invite.id), viewer);
  if (!r) return;
  const message = fill(m["team.revoked"], { email: invite.email });
  const handle = r.undo;
  if (!handle) { toast.success(message); return; }
  undoable(message, () => {
    void run(() => actions.undoRevoke(handle.email, handle.role, handle.language), viewer).then((back) => {
      if (back) toast.success(fill(m["team.undone.revoke"], { email: handle.email }));
    });
  });
}
