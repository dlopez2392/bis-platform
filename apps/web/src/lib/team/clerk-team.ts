import { clerkClient } from "@clerk/nextjs/server";
import {
  roleFromClerk, languageFromClerk,
  type AccountRole, type ClerkTeamPort, type PersonLanguage,
} from "@bis/db";
import { loggableError } from "@/lib/loggable-error";
import { clerkRoleFor } from "./team-view";
import { withTimeout, TimeoutError } from "./with-timeout";

/**
 * Every Clerk call the staff-and-roles lane makes (spec §6, §8), in one file.
 *
 * Method names, parameters and response fields are the installed
 * `@clerk/backend` 3.13.1's (what `@clerk/nextjs` 7.6.1 resolves to), read
 * from `dist/api/endpoints/UserApi.d.ts`, `dist/api/endpoints/OrganizationApi.d.ts`
 * and `dist/api/resources/{User,Organization,OrganizationMembership,OrganizationInvitation}.d.ts`.
 * A Clerk API failure is `@clerk/shared`'s `ClerkAPIResponseError`: a numeric
 * `status` and `errors[].code` (`dist/errors/clerkApiResponseError.d.ts`,
 * `dist/types/errors.d.ts`); it is read by shape here rather than by class,
 * so the adapter does not depend on which copy of `@clerk/shared` threw it.
 *
 * Logging goes through `loggableError` only: a Clerk message can quote the
 * person's address, and a log is no place for it.
 */

/** Clerk caps `limit` below 501; the default page is 10, which is too small to trust. */
const PAGE = 500;

function apiStatus(e: unknown): number | null {
  const s = typeof e === "object" && e !== null ? (e as { status?: unknown }).status : undefined;
  return typeof s === "number" ? s : null;
}

function apiCode(e: unknown): string | null {
  const errors = typeof e === "object" && e !== null ? (e as { errors?: unknown }).errors : undefined;
  const first = Array.isArray(errors) ? (errors[0] as { code?: unknown } | undefined) : undefined;
  return typeof first?.code === "string" ? first.code : null;
}

/** The port `reconcileMembership` (`@bis/db`) reads Clerk through. */
export function liveClerkTeamPort(): ClerkTeamPort {
  return {
    async getUser(clerkUserId) {
      const clerk = await clerkClient();
      try {
        const u = await clerk.users.getUser(clerkUserId);
        return { email: u.primaryEmailAddress?.emailAddress ?? null, name: u.fullName, publicMetadata: u.publicMetadata };
      } catch (e) {
        if (apiStatus(e) === 404) return null;
        throw e;
      }
    },

    async getMembership(clerkUserId, clerkOrgId) {
      // Asked of the ORGANISATION, filtered to this user, rather than of the
      // user's own membership list: the agency admin belongs to every client
      // org, and a per-user list pages at 10, so the org being asked about
      // could sit on a later page and read as "not a member".
      const clerk = await clerkClient();
      const list = await clerk.organizations.getOrganizationMembershipList({ organizationId: clerkOrgId, userId: [clerkUserId] });
      const m = list.data.find((x) => x.organization.id === clerkOrgId && x.publicUserData?.userId === clerkUserId);
      return m ? { role: m.role, publicMetadata: m.publicMetadata, createdAt: m.createdAt } : null;
    },

    async acceptedInvitationMeta(clerkOrgId, email, acceptedSince) {
      // An accepted invitation's `updatedAt` is its acceptance (the status
      // change is its last write; OrganizationInvitation.d.ts:20). Only one
      // accepted at or after `acceptedSince` can belong to the membership
      // being settled; an older one belonged to an earlier membership.
      const clerk = await clerkClient();
      const list = await clerk.organizations.getOrganizationInvitationList({ organizationId: clerkOrgId, status: ["accepted"], limit: PAGE });
      const want = email.toLowerCase();
      const latest = list.data
        .filter((i) => i.emailAddress.toLowerCase() === want && i.updatedAt >= acceptedSince)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      return latest ? latest.publicMetadata : null;
    },
  };
}

export type ClerkPendingInvite = { id: string; email: string; role: AccountRole; language: PersonLanguage };
/**
 * A Clerk write's outcome. `code` is Clerk's own error code when it gave one,
 * for the caller to map to copy; `status` is Clerk's HTTP status, null when
 * there was no answer (a timeout or a network error).
 */
export type ClerkWriteFailure = { ok: false; code: string | null; status: number | null };
export type ClerkWriteResult<T extends object = object> = ({ ok: true } & T) | ClerkWriteFailure;

/**
 * Whether a failed write DEFINITELY did not land (review I1): Clerk answered
 * with a 4xx refusal. A 5xx, a 408, a timeout or a network error may have
 * landed (or may land later), so a caller undoing its own first write must
 * treat it as landed.
 */
export function clerkRefused(r: ClerkWriteFailure): boolean {
  return r.status !== null && r.status >= 400 && r.status < 500 && r.status !== 408;
}

function inviteFrom(i: { id: string; emailAddress: string; role: string; publicMetadata: unknown }): ClerkPendingInvite {
  return {
    id: i.id, email: i.emailAddress,
    role: roleFromClerk({ clerkRole: i.role, invitationMeta: i.publicMetadata }),
    language: languageFromClerk(i.publicMetadata) ?? "en",
  };
}

/**
 * Every Clerk WRITE the Team actions make is bounded by this. Past it the
 * write reports code "timeout"; the request is not cancelled and may still
 * land, which setTeamRoleAction allows for.
 */
export const CLERK_WRITE_TIMEOUT_MS = 5000;

function bounded<T>(write: () => Promise<T>): Promise<T> {
  return withTimeout(write(), CLERK_WRITE_TIMEOUT_MS);
}

function failed(what: string, e: unknown): ClerkWriteFailure {
  console.error(`clerk-team: ${what} failed: ${loggableError(e)}`);
  return e instanceof TimeoutError ? { ok: false, code: "timeout", status: null } : { ok: false, code: apiCode(e), status: apiStatus(e) };
}

/** Throws (with a redacted message) when Clerk cannot be read: the Team card shows its unreachable state. */
export async function listPendingInvitations(orgId: string): Promise<ClerkPendingInvite[]> {
  try {
    const clerk = await clerkClient();
    const list = await clerk.organizations.getOrganizationInvitationList({ organizationId: orgId, status: ["pending"], limit: PAGE });
    return list.data.map(inviteFrom);
  } catch (e) {
    throw new Error(`listPendingInvitations: ${loggableError(e)}`);
  }
}

/**
 * The login cap (spec §8): `maxAllowedMemberships` (0 means no cap, so null),
 * the member count and the pending-invitation count. Throws, redacted, when
 * Clerk cannot be read.
 */
export async function teamCapacity(orgId: string): Promise<{ maxAllowed: number | null; members: number; pending: number }> {
  try {
    const clerk = await clerkClient();
    const org = await clerk.organizations.getOrganization({ organizationId: orgId, includeMembersCount: true });
    const members = typeof org.membersCount === "number"
      ? org.membersCount
      : (await clerk.organizations.getOrganizationMembershipList({ organizationId: orgId, limit: 1 })).totalCount;
    const pending = (await clerk.organizations.getOrganizationInvitationList({ organizationId: orgId, status: ["pending"], limit: 1 })).totalCount;
    return { maxAllowed: org.maxAllowedMemberships > 0 ? org.maxAllowedMemberships : null, members, pending };
  } catch (e) {
    throw new Error(`teamCapacity: ${loggableError(e)}`);
  }
}

/**
 * The role is BIS's (`bis_role` in the invitation's public metadata), and
 * the Clerk role FOLLOWS it (`clerkRoleFor`): Owner is `org:admin`, Staff
 * is `org:member`. Task 3 invited everyone as `org:member`; a review then
 * showed the two must agree, because a Clerk `org:admin` can invite through
 * Clerk's browser API whatever BIS says, and an Owner left as `org:member`
 * would disagree the other way.
 */
export async function createTeamInvitation(i: {
  orgId: string; email: string; role: AccountRole; language: PersonLanguage; inviterUserId: string;
}): Promise<ClerkWriteResult> {
  try {
    await bounded(async () => (await clerkClient()).organizations.createOrganizationInvitation({
      organizationId: i.orgId, emailAddress: i.email, role: clerkRoleFor(i.role), inviterUserId: i.inviterUserId,
      publicMetadata: { bis_role: i.role, bis_language: i.language },
    }));
    return { ok: true };
  } catch (e) {
    return failed("createOrganizationInvitation", e);
  }
}

/** Returns the revoked invitation's email, role and language, which is what an undo re-invites with. */
export async function revokeTeamInvitation(
  orgId: string, invitationId: string, requestingUserId?: string,
): Promise<ClerkWriteResult<{ invite: ClerkPendingInvite }>> {
  try {
    const inv = await bounded(async () => (await clerkClient()).organizations.revokeOrganizationInvitation({ organizationId: orgId, invitationId, requestingUserId }));
    return { ok: true, invite: inviteFrom(inv) };
  } catch (e) {
    return failed("revokeOrganizationInvitation", e);
  }
}

/**
 * A 404 from Clerk means the membership is already gone, which is the state
 * this call exists to reach, so it is success. Read by `status`, as
 * `@clerk/shared` 4.25.8's ClerkAPIResponseError declares it
 * (`dist/errors/clerkApiResponseError.d.ts:13`, `status: number`), the same
 * way getUser reads its 404 above.
 */
export async function removeFromOrganization(orgId: string, clerkUserId: string): Promise<ClerkWriteResult> {
  try {
    await bounded(async () => (await clerkClient()).organizations.deleteOrganizationMembership({ organizationId: orgId, userId: clerkUserId }));
    return { ok: true };
  } catch (e) {
    if (apiStatus(e) === 404) return { ok: true };
    return failed("deleteOrganizationMembership", e);
  }
}

/**
 * Only `bis_role` can say Technician: Technician and Staff are both
 * org:member, and roleFromClerk reads a bare org:member as Staff. So for a
 * Technician a metadata write that did not land is a failed write; for Owner
 * or Staff the Clerk role alone already gives the right answer (final review
 * I-1).
 */
const metadataRequired = (role: AccountRole): boolean => role === "technician";

/**
 * The undo of a removal: back at the Clerk role matching `role`, then that
 * role as the membership's `bis_role` (final review I-1).
 * `createOrganizationMembership` takes no metadata (@clerk/backend 3.13.1
 * OrganizationApi.d.ts:140-147), and the membership it makes is NEWER than
 * the removal record, so reconcileMembership settles it whenever the BIS row
 * is missing; without `bis_role` a restored Technician would settle as Staff.
 * For a Technician whose metadata write fails, the membership is taken away
 * again and the restore reports that failure; if the take-back fails too, it
 * is logged by id. The BIS membership is restored by the caller, after this.
 */
export async function restoreToOrganization(orgId: string, clerkUserId: string, role: AccountRole): Promise<ClerkWriteResult> {
  try {
    await bounded(async () => (await clerkClient()).organizations.createOrganizationMembership({ organizationId: orgId, userId: clerkUserId, role: clerkRoleFor(role) }));
  } catch (e) {
    return failed("createOrganizationMembership", e);
  }
  const m = await writeClerkRoleMetadata(orgId, clerkUserId, role);
  if (m.ok) return { ok: true };
  if (!metadataRequired(role)) {
    console.error(`clerk-team: restored as ${role} but its bis_role metadata was not written (org ${orgId}, user ${clerkUserId}): ${m.code ?? "no code"}`);
    return { ok: true };
  }
  const back = await removeFromOrganization(orgId, clerkUserId);
  if (!back.ok) console.error(`clerk-team: a restored Technician has no bis_role and could not be taken out again, so Clerk alone reads them as Staff (org ${orgId}, user ${clerkUserId}): ${back.code ?? "no code"}`);
  return m;
}

/** `updateOrganizationMembership({ organizationId, userId, role })`: @clerk/backend 3.13.1 OrganizationApi.d.ts:341, params :149. */
async function writeClerkRole(orgId: string, clerkUserId: string, role: AccountRole): Promise<ClerkWriteResult> {
  try {
    await bounded(async () => (await clerkClient()).organizations.updateOrganizationMembership({ organizationId: orgId, userId: clerkUserId, role: clerkRoleFor(role) }));
    return { ok: true };
  } catch (e) {
    return failed("updateOrganizationMembership", e);
  }
}

/**
 * The membership's own `bis_role` (review I4): Clerk copies an invitation's
 * public metadata onto the membership it creates, and a role change does not
 * touch it. `updateOrganizationMembershipMetadata({ organizationId, userId,
 * publicMetadata })`: @clerk/backend 3.13.1 OrganizationApi.d.ts:349, params
 * :151-156; Clerk merges it into the existing metadata, so `bis_language`
 * survives.
 */
async function writeClerkRoleMetadata(orgId: string, clerkUserId: string, role: AccountRole): Promise<ClerkWriteResult> {
  try {
    await bounded(async () => (await clerkClient()).organizations.updateOrganizationMembershipMetadata({ organizationId: orgId, userId: clerkUserId, publicMetadata: { bis_role: role } }));
    return { ok: true };
  } catch (e) {
    return failed("updateOrganizationMembershipMetadata", e);
  }
}

/**
 * Makes the Clerk membership follow a BIS role change: the role, then its
 * `bis_role` metadata. For Owner and Staff the result is the ROLE write's: a
 * metadata write that fails after the role landed is logged by id and left,
 * because roleFromClerk takes the less privileged answer and the Clerk role
 * alone (org:admin -> owner, org:member -> staff) is never more privileged
 * than the BIS role being written. That is NOT true of Technician (final
 * review I-1): Technician is org:member like Staff, so only `bis_role` says
 * Technician, and a stale `bis_role` of staff or owner reads as Staff. A move
 * to Technician whose metadata write fails is therefore a failure, which the
 * caller handles as it handles a failed role write.
 */
export async function setOrganizationRole(orgId: string, clerkUserId: string, role: AccountRole): Promise<ClerkWriteResult> {
  const r = await writeClerkRole(orgId, clerkUserId, role);
  if (!r.ok) return r;
  const m = await writeClerkRoleMetadata(orgId, clerkUserId, role);
  if (m.ok) return { ok: true };
  console.error(`clerk-team: role set to ${role} but its bis_role metadata was not (org ${orgId}, user ${clerkUserId}): ${m.code ?? "no code"}`);
  return metadataRequired(role) ? m : { ok: true };
}

/**
 * Re-asserts the BIS role on Clerk (review I2: the webhook's
 * `organizationMembership.updated`, so a Clerk-dashboard or browser-API edit
 * cannot drift it). Writes only what disagrees: an `updated` event fires on
 * every write, and a write that changes nothing would answer itself forever.
 */
export async function reassertClerkRole(orgId: string, clerkUserId: string, role: AccountRole): Promise<ClerkWriteResult<{ changed: boolean }>> {
  let m: Awaited<ReturnType<ClerkTeamPort["getMembership"]>>;
  try {
    m = await liveClerkTeamPort().getMembership(clerkUserId, orgId);
  } catch (e) {
    return failed("getOrganizationMembershipList", e);
  }
  if (!m) return { ok: true, changed: false };
  let changed = false;
  if (m.role !== clerkRoleFor(role)) {
    const r = await writeClerkRole(orgId, clerkUserId, role);
    if (!r.ok) return r;
    changed = true;
  }
  const meta = typeof m.publicMetadata === "object" && m.publicMetadata !== null ? (m.publicMetadata as Record<string, unknown>) : {};
  if (meta.bis_role !== role) {
    const r = await writeClerkRoleMetadata(orgId, clerkUserId, role);
    if (!r.ok) return r;
    changed = true;
  }
  return { ok: true, changed };
}
