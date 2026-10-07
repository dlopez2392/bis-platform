import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { clerkClient } from "@clerk/nextjs/server";
import { createAgencyUser, signInWithTicket } from "../e2e/fixtures/clerk-identities";

// Same two paths, same reason, as e2e/auth.setup.ts: this runs in the
// Playwright runner process rather than through Next, so nothing loads
// apps/web/.env.local for it.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

const AUTH_FILE = "screenshots/.auth/state.json";
// Read by screenshots/auth.teardown.ts to delete the user this run made.
const AGENCY_FIXTURE_FILE = "screenshots/.auth/agency-fixture.json";

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
 * It joins no organization: nothing here creates one, so
 * <ActivateSoleOrganization/> (which needs exactly one membership) never
 * fires, and the agency reaches the demo tenant, whose org
 * `org_demo_resaca_air` is a fiction, on the app_role claim alone.
 */
setup("sign in as the agency", async ({ page }) => {
  await clerkSetup();
  const clerk_ = await clerkClient();

  const { userId, email } = await createAgencyUser(clerk_, { firstName: "BIS", lastName: "Team" });
  // Recorded before anything else can fail, so teardown always has the id.
  mkdirSync("screenshots/.auth", { recursive: true });
  writeFileSync(AGENCY_FIXTURE_FILE, JSON.stringify({ clerkUserId: userId, email }));

  await signInWithTicket(page, clerk_, userId);

  // Land somewhere authenticated before persisting, so the stored state is a
  // session that has actually been exercised rather than one that merely
  // exists.
  await page.goto("/dashboard/accounts");
  await page.waitForURL(/\/dashboard\/accounts$/);

  await page.context().storageState({ path: AUTH_FILE });
});
