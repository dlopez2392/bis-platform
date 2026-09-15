import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { config as loadEnv } from "dotenv";

// Same two paths, same reason, as e2e/auth.setup.ts: this runs in the
// Playwright runner process rather than through Next, so nothing loads
// apps/web/.env.local for it.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

const AUTH_FILE = "screenshots/.auth/state.json";

/**
 * Signs in as the agency admin and stops.
 *
 * Deliberately NOT `e2e/auth.setup.ts`, which also sweeps stale fixtures and
 * creates a real Clerk user, org and Postgres rows for the client-access
 * spec. Those exist to make the gate honest; a capture run needs none of
 * them, and creating and deleting a tenant in the shared project just to take
 * six pictures is a good way to collide with an e2e run that is already
 * holding that ground.
 */
setup("sign in as the agency", async ({ page }) => {
  const email = process.env.E2E_AGENCY_EMAIL ?? "danlopez508@gmail.com";
  await clerkSetup();
  await clerk.signIn({ page, emailAddress: email });
  // Land somewhere authenticated before persisting, so the stored state is a
  // session that has actually been exercised rather than one that merely
  // exists.
  await page.goto("/dashboard/accounts");
  await page.waitForURL(/\/dashboard\/accounts/);
  mkdirSync("screenshots/.auth", { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
});
