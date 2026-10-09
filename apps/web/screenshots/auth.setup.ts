import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { clerkClient } from "@clerk/nextjs/server";
import { createAgencyUser, setActiveOrganization, signInWithTicket, type ClerkBackend } from "../e2e/fixtures/clerk-identities";

// Same two paths, same reason, as e2e/auth.setup.ts: this runs in the
// Playwright runner process rather than through Next, so nothing loads
// apps/web/.env.local for it.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

const AUTH_FILE = "screenshots/.auth/state.json";
// Read by screenshots/auth.teardown.ts to delete the user this run made.
const AGENCY_FIXTURE_FILE = "screenshots/.auth/agency-fixture.json";

/**
 * The organization the topbar's switcher names. An agency user with no active
 * organization gets Clerk's "No organization selected" there, and that line
 * sat in the corner of every dashboard capture on the website (and, before
 * 2026-10-07, beside a real person's photo). This org gives the switcher the
 * agency's own name instead.
 *
 * ONE org, kept between runs, never one per run. It is found by a private
 * metadata marker, not a slug: the development instance has organization
 * slugs turned off, and asking for one is refused outright
 * (`organization_slugs_disabled`, capture run 37958998483). A per-run org
 * named "BIS" would be indistinguishable from this one, and the e2e sweep
 * deletes leaked orgs by their stamped NAME (e2e/fixtures/stale.ts), so a run
 * killed before teardown would leave a "BIS" org nothing ever removes. The
 * user's membership needs no cleanup: deleting the user (auth.teardown.ts, or
 * the e2e sweep for a leaked one) removes it. The instance's 5-member cap
 * applies (docs/runbooks/clerk-setup.md: a product rule, not to be raised);
 * captures run one at a time and rarely, so only five killed runs inside
 * the sweep's 30 minutes could fill it.
 *
 * Membership grants nothing: agency access is the app_role claim alone
 * (lib/auth.ts never reads org_id for an agency_admin), and RLS's
 * app.is_agency() reads app_role too.
 */
const CAPTURE_ORG_NAME = "BIS";
const CAPTURE_ORG_MARK = "bisCaptureOrg";

async function captureOrganization(clerk_: ClerkBackend): Promise<string> {
  // `query` is a partial match on name, so filter on the marker; oldest first,
  // so a duplicate (two first runs racing) can never flip which one is used.
  const { data } = await clerk_.organizations.getOrganizationList({
    query: CAPTURE_ORG_NAME, orderBy: "+created_at", limit: 100,
  });
  const found = data.find((o) => o.privateMetadata?.[CAPTURE_ORG_MARK] === true);
  if (found) return found.id;
  const org = await clerk_.organizations.createOrganization({
    name: CAPTURE_ORG_NAME, privateMetadata: { [CAPTURE_ORG_MARK]: true },
  });
  return org.id;
}

/**
 * Signs in as a throwaway agency user and stops.
 *
 * Deliberately NOT `e2e/auth.setup.ts`, which also sweeps stale fixtures and
 * creates a client user, org and Postgres rows for the client-access spec.
 * Those exist to make the gate honest; a capture run needs none of them, and
 * creating and deleting a tenant in the shared project just to take six
 * pictures is a good way to collide with an e2e run that is already holding
 * that ground. It shares only the identity helpers.
 *
 * The user is minted for this run, never a person
 * (e2e/fixtures/clerk-identities.ts says why). Until 2026-10-07 this signed
 * in as danlopez508@gmail.com, whose profile photo was in the corner of every
 * marketing screenshot; the topbar now shows a throwaway "BIS Team" instead.
 * It reaches the demo tenant, whose org `org_demo_resaca_air` is a fiction, on
 * the app_role claim alone. It also joins the "BIS" org and makes it
 * active, but only so the topbar's switcher reads "BIS" (see
 * captureOrganization). Active before the state is saved, so
 * <ActivateSoleOrganization/> (no active org, exactly one membership) has
 * nothing to do and never reloads a capture to "/".
 */
setup("sign in as the agency", async ({ page }) => {
  await clerkSetup();
  const clerk_ = await clerkClient();

  const { userId, email } = await createAgencyUser(clerk_, { firstName: "BIS", lastName: "Team" });
  // Recorded before anything else can fail, so teardown always has the id.
  mkdirSync("screenshots/.auth", { recursive: true });
  writeFileSync(AGENCY_FIXTURE_FILE, JSON.stringify({ clerkUserId: userId, email }));

  const orgId = await captureOrganization(clerk_);
  await clerk_.organizations.createOrganizationMembership({ organizationId: orgId, userId, role: "org:member" });

  await signInWithTicket(page, clerk_, userId);
  await setActiveOrganization(page, orgId);

  // Land somewhere authenticated before persisting, so the stored state is a
  // session that has actually been exercised rather than one that merely
  // exists.
  await page.goto("/dashboard/accounts");
  await page.waitForURL(/\/dashboard\/accounts$/);

  await page.context().storageState({ path: AUTH_FILE });
});
