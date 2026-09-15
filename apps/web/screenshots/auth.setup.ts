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

  // LAND ON A PAGE THAT MOUNTS CLERK FIRST. `clerk.signIn` begins by waiting
  // for `window.Clerk?.loaded`; on the runner's blank start page that global
  // never appears, so the helper sits in `page.waitForFunction` until the
  // whole 120s test timeout is gone. That is precisely how the first capture
  // run died (run 34924321870): `loaded` at @clerk/testing helpers.ts:100,
  // reached from this line.
  //
  // `e2e/auth.setup.ts` has always done this goto. Dropping it here was the
  // cost of writing this file as "the minimal version of that one" — minimal
  // is not the same as smaller, and these two steps are load-bearing.
  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress: email });

  // Land somewhere authenticated before persisting, so the stored state is a
  // session that has actually been exercised rather than one that merely
  // exists.
  await page.goto("/dashboard/accounts");

  // THE ORGANIZATION TASK, the second step this file was missing and the one
  // that would have failed the moment the first was fixed. This Clerk dev
  // instance enforces organization selection as a pending session task
  // whenever the signed-in user belongs to an organization and the (fresh,
  // cookie-less) context has no active one — middleware redirects to Clerk's
  // own picker under /sign-in/tasks instead of the route asked for. The
  // redirect happens CLIENT-side, after the goto's load event, so the URL has
  // to be waited on rather than read. e2e/auth.setup.ts documents the same
  // behaviour at length; this file needs it for the identical reason.
  //
  // "Test Client One" is this dev user's only organization. The demo tenant
  // is not one: `org_demo_resaca_air` is a fiction, no such Clerk
  // organisation exists, and the demo dashboard is reachable here only
  // because an agency admin is waved past the membership check.
  await page.waitForURL(
    (url) => url.pathname === "/dashboard/accounts" || url.pathname.startsWith("/sign-in/tasks"),
  );
  if (page.url().includes("/sign-in/tasks")) {
    await page.getByRole("button", { name: /Test Client One/ }).click();
  }
  await page.waitForURL(/\/dashboard\/accounts$/);

  mkdirSync("screenshots/.auth", { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
});
