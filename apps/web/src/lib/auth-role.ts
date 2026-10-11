import type { AccountRole } from "@bis/db";

/**
 * Who sees and manages the WHOLE account (F-085 part 1, spec §7-§8): the
 * agency, an Owner, Staff. A Technician does not, and neither does a client
 * whose role could not be settled (null): this fails closed, like the
 * database (0068), so an unsettled role gets the Technician's narrow view
 * rather than the Owner's.
 *
 * The one copy of this rule. Pure and in its own module so the pages and
 * actions that ask it do not pull in `lib/auth.ts` (Clerk, the service
 * client) and so tests that stub `@/lib/auth` with a factory keep working
 * unchanged. `lib/auth.ts` re-exports it.
 */
export function seesWholeAccount(access: { isAgency: boolean; role: AccountRole | null }): boolean {
  return access.isAgency || access.role === "owner" || access.role === "staff";
}
