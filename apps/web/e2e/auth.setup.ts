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

  // This Clerk dev instance now enforces organization selection as a
  // pending session task whenever the signed-in user belongs to one or more
  // organizations and this (fresh, cookie-less) browser context has no
  // active org yet — middleware redirects to a real, clickable
  // "Choose an organization" screen (Clerk's own <SignIn/> component,
  // mounted at the /sign-in catch-all) instead of the target route. The
  // redirect to /sign-in/tasks (and on from there to
  // /sign-in/tasks/choose-organization) happens client-side after the initial
  // goto's load event, so page.url() has to be waited on, not read
  // immediately. This dev user's only organization is "Test Client One", the
  // fixture account every other spec assumes exists.
  await page.waitForURL(
    (url) => url.pathname === "/dashboard/accounts" || url.pathname.startsWith("/sign-in/tasks"),
  );
  if (page.url().includes("/sign-in/tasks")) {
    await page.getByRole("button", { name: /Test Client One/ }).click();
  }

  await page.waitForURL(/\/dashboard\/accounts$/);

  await page.context().storageState({ path: AUTH_FILE });
});
