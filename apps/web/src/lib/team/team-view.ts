import type { AccountRole, PersonLanguage } from "@bis/db";

/**
 * The Team screen's pure rules (spec §8). No I/O, so the actions and the
 * Team card (Task 10) read the same answers.
 */

export type PendingInvite = { id: string; email: string; role: AccountRole; language: PersonLanguage };

/** "Room for N more": the Clerk org's cap minus members minus pending invitations, never below 0. Null = no cap known. */
export function roomLeft(cap: { maxAllowed: number | null; members: number; pending: number }): number | null {
  if (cap.maxAllowed === null) return null;
  return Math.max(0, cap.maxAllowed - cap.members - cap.pending);
}

/** "es" only when the account says es; anything else (missing, unknown) is "en". */
export function inviteDefaultLanguage(accountLanguage: unknown): PersonLanguage {
  return accountLanguage === "es" ? "es" : "en";
}

/**
 * Clerk's expected invitation refusals. `already_a_member_in_organization`
 * and `organization_membership_quota_exceeded` are named in the installed
 * `@clerk/shared` 4.25.8's localization resource (`dist/types/localization.d.ts`,
 * the `unstable__errors` keys, which Clerk keys by API error code).
 * `duplicate_record` (an invitation already pending) is an ASSUMPTION: it
 * appears nowhere in the installed packages. An unknown code is `failed`,
 * so a wrong guess only costs a vaguer sentence.
 */
export function clerkInviteError(code: string | undefined): "already_invited" | "already_member" | "full" | "failed" {
  switch (code) {
    case "duplicate_record": return "already_invited";
    case "already_a_member_in_organization": return "already_member";
    case "organization_membership_quota_exceeded": return "full";
    default: return "failed";
  }
}

export function ownerCount(team: readonly { role: AccountRole }[]): number {
  return team.filter((m) => m.role === "owner").length;
}

/**
 * The Clerk membership role that matches a BIS role. The Clerk role must
 * follow the BIS one: an `org:admin` can invite through Clerk's browser API,
 * so a person demoted to Staff in BIS who stayed `org:admin` in Clerk could
 * still invite an Owner.
 */
export function clerkRoleFor(role: AccountRole): "org:admin" | "org:member" {
  return role === "owner" ? "org:admin" : "org:member";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A BIS `users.id`. */
export const isTeamUserId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
/** A Clerk organisation invitation id. The `orginv_` prefix is an ASSUMPTION about Clerk's id format, pinned in team-view.test.ts. */
export const isInvitationId = (v: unknown): v is string => typeof v === "string" && /^orginv_[A-Za-z0-9]+$/.test(v);
/** A Clerk user id. */
export const isClerkUserId = (v: unknown): v is string => typeof v === "string" && /^user_[A-Za-z0-9]+$/.test(v);

export const isAccountRole = (v: unknown): v is AccountRole => v === "owner" || v === "staff";
export const isPersonLanguage = (v: unknown): v is PersonLanguage => v === "en" || v === "es";
