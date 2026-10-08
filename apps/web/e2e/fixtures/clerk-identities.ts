import { clerk } from "@clerk/testing/playwright";
import type { Page } from "@playwright/test";
import type { clerkClient } from "@clerk/nextjs/server";

/**
 * The throwaway Clerk identities the Playwright runs sign in as, shared by
 * the e2e setup (e2e/auth.setup.ts) and the demo capture
 * (screenshots/auth.setup.ts) so the two cannot drift apart.
 *
 * Neither run signs in as a person any more. Until 2026-10-07 both signed in
 * as the one real person on the Clerk dev instance (danlopez508@gmail.com),
 * so anything that ended that person's sessions ended the run: PR #188's e2e
 * run lost the session at 18:00:02 UTC (Clerk's handshake answered
 * __client_uat=0) and every signed-in spec after it rendered the sign-in
 * page. The capture also put that person's profile photo in the corner of
 * every marketing screenshot.
 */

export type ClerkBackend = Awaited<ReturnType<typeof clerkClient>>;

/**
 * `e2e-agency-<13-digit stamp>@example.com`: the shape
 * e2e/fixtures/stale.ts's FIXTURE_EMAIL_RE matches, so a user leaked by a
 * killed run, from either caller, is deleted by the next e2e sweep (same
 * Clerk instance) once it is 30 minutes old. example.com never resolves to
 * a mailbox, and Backend-API-created users get no verification mail.
 */
export function agencyEmail(stamp: number): string {
  return `e2e-agency-${stamp}@example.com`;
}

/**
 * Create a throwaway agency user. Agency status is ONE claim, app_role ===
 * "agency_admin" (lib/auth.ts; app.is_agency() in RLS), rendered into the
 * session token from {{user.public_metadata.app_role}} by the instance's
 * token template (docs/runbooks/clerk-setup.md, Part A), so setting the
 * metadata here is all it takes: no dashboard change, no org.
 */
export async function createAgencyUser(
  clerk_: ClerkBackend,
  name: { firstName: string; lastName: string },
): Promise<{ userId: string; email: string }> {
  const email = agencyEmail(Date.now());
  const user = await clerk_.users.createUser({
    emailAddress: [email],
    ...name,
    skipPasswordRequirement: true,
    skipLegalChecks: true,
    publicMetadata: { app_role: "agency_admin" },
  });
  return { userId: user.id, email };
}

/**
 * Sign `userId` in on `page` with a ticket minted for that id, never a
 * lookup by email. `clerk.signIn({ emailAddress })` resolves the email
 * through `users.getUserList`, a search that can lag a user created a second
 * ago, and on 2026-10-07 it did: "No user found with email e2e-client-..."
 * failed the setup project before one spec ran. This is the same ticket
 * strategy @clerk/testing uses internally after its search, minus the
 * search; its `signInParams` path does not wait for the session the way its
 * email path does, so the wait is here.
 *
 * It lands on /sign-in first because `clerk.signIn` begins by waiting for
 * `window.Clerk.loaded`, which never appears on a blank start page (capture
 * run 34924321870 died there).
 */
export async function signInWithTicket(page: Page, clerk_: ClerkBackend, userId: string): Promise<void> {
  await page.goto("/sign-in");
  const { token: ticket } = await clerk_.signInTokens.createSignInToken({ userId, expiresInSeconds: 300 });
  await clerk.signIn({ page, signInParams: { strategy: "ticket", ticket } });
  await page.waitForFunction(
    () => Boolean((window as unknown as { Clerk?: { user?: unknown } }).Clerk?.user),
  );
}

/**
 * Make `organizationId` this session's active organization, the same call
 * Clerk's own <OrganizationSwitcher/> makes. Nothing else sets it: the
 * instance's force_organization_selection is off, so no "Choose an
 * organization" task does it during sign-in.
 */
export async function setActiveOrganization(page: Page, organizationId: string): Promise<void> {
  await page.evaluate(async (orgId) => {
    const clerkGlobal = (
      window as unknown as {
        Clerk?: { setActive(params: { organization: string }): Promise<void> };
      }
    ).Clerk;
    if (!clerkGlobal) throw new Error("setup: window.Clerk did not load");
    await clerkGlobal.setActive({ organization: orgId });
  }, organizationId);
}
