import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";

const AUTH_FILE = "e2e/.auth/state.json";

// Runs once before the real specs. Signs in as the one real Clerk user on
// this dev instance (danlopez508@gmail.com) via a Backend-API-minted
// sign-in token — no password, no email code, and critically no user is
// created or modified. That user already carries
// public_metadata.app_role = "agency_admin" (set by hand in the Clerk
// Dashboard outside of this codebase), which is what requireAgency()
// checks for in the session claims.
setup("authenticate as agency_admin", async ({ page }) => {
  await clerkSetup();

  const email = process.env.E2E_ADMIN_EMAIL ?? "danlopez508@gmail.com";

  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress: email });
  await page.goto("/dashboard/accounts");
  await page.waitForURL(/\/dashboard\/accounts$/);

  await page.context().storageState({ path: AUTH_FILE });
});
