import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess } from "@bis/db";
import { SEEDED_ACCOUNT_NAME } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

// This spec is the milestone's only automated proof that one client cannot
// reach another client's data (design spec section 10). It drives five
// full navigations under the RLS-enforcing dbForRequest() path plus one
// direct DB write — the same order of per-page cost blueprints.spec.ts's
// own comment measures for this account-scoped route family, times five
// page loads instead of one.
//
// Fixture creation AND cleanup live outside this file: auth.setup.ts
// creates the Clerk user/org, the accounts row, and one seeded contact;
// auth.teardown.ts (a Playwright teardown project, see playwright.config.ts)
// deletes all of it afterward, unconditionally, so a filtered run that never
// selects this spec still cleans up what "setup" unconditionally created.
test.describe.configure({ timeout: 60_000 });

// Signed in as the client fixture auth.setup.ts creates, not the agency
// admin every other spec uses.
test.use({ storageState: "e2e/.auth/client-state.json" });

type ClientFixture = {
  accountId: string;
  clerkOrgId: string;
  clerkUserId: string;
  email: string;
  companyName: string;
  contactName: string;
};

test("a client sees only their own account, and nothing when access is off", async ({ page }) => {
  const fixture = JSON.parse(
    readFileSync("e2e/.auth/client-fixture.json", "utf-8"),
  ) as ClientFixture;
  const db = serviceDb();

  // 1. Signing in lands on their own account's dashboard — not the
  // accounts list. (dashboard)/page.tsx's resolveClientAccount() redirect
  // is what's under test here.
  await page.goto("/");
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/accounts/${fixture.accountId}/dashboard$`),
  );

  // 2. They can see their OWN data — the assertion the rest of this file
  // was missing. Every other check here is an absence check (no canary
  // name, no agency chrome, a redirect on the "off" case) and passes
  // trivially even if RLS/dbForRequest stopped returning this client's own
  // rows entirely: e.g. if [accountId]/layout.tsx's account lookup started
  // getting zero rows for a real account, it 404s via notFound(), which
  // renders *inside* this same dashboard/layout.tsx shell — sidebar still
  // present, URL unchanged, no leaked name to find — and every assertion
  // below would still pass while the client's whole CRM was a 404. Seeing
  // their own seeded contact is the only way this file can fail on that.
  await page.goto(`/dashboard/accounts/${fixture.accountId}/contacts`);
  await expect(page.getByText(fixture.contactName)).toBeVisible();

  // 3. The sidebar shows exactly the six in-account items, and no "Back
  // to agency", Blueprints, Settings, or account switcher.
  const navLinks = page.locator("aside nav a");
  await expect(navLinks).toHaveCount(6);
  for (const label of [
    "Dashboard", "Contacts", "Opportunities", "Conversations", "Forms", "Calendar",
  ]) {
    await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Blueprints", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Back to companies", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Switch company" })).toHaveCount(0);

  // 4. Navigating to another account's URL redirects to their own
  // account, and the other account's data never renders. "Test Client
  // One" is the one account in this environment seeded with real,
  // recognizable data (support.ts) — a good canary for a leak.
  const { data: other, error: otherErr } = await db
    .from("accounts")
    .select("id")
    .eq("name", SEEDED_ACCOUNT_NAME)
    .single();
  if (otherErr || !other) {
    throw new Error(`client-access spec: seeded account lookup failed: ${otherErr?.message}`);
  }
  await page.goto(`/dashboard/accounts/${other.id}/contacts`);
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/accounts/${fixture.accountId}/dashboard$`),
  );
  await expect(page.getByText("Maria Garcia")).toHaveCount(0);

  // 5. The activation checklist panel does not appear on their dashboard
  // — it's agency work about the client, not client data (design
  // spec section 6.1). The fixture account is brand new, so every
  // catalogue item is still pending; if the isAgency gate around the
  // panel in [accountId]/dashboard/page.tsx were ever dropped, this
  // account is guaranteed to have a panel to show.
  await page.goto(`/dashboard/accounts/${fixture.accountId}/dashboard`);
  await expect(page.getByText("Activation checklist")).toHaveCount(0);

  // 6. With client_access_enabled flipped false, they get the no-access
  // page — not an empty CRM. This is what proves design spec sections
  // 3.3 and 8 are real rather than cosmetic: without the app-level
  // redirect, RLS's own client_access_enabled check in
  // app.current_account_id() (migration 0008) would independently zero
  // out every query on this page, producing a fully-rendered dashboard
  // with every stat reading 0 — exactly the "empty but fully functional
  // CRM" failure mode the design calls out as worse than an error.
  //
  // Deliberately not restored to true here, and the fixture row is not
  // deleted here either — auth.teardown.ts restores the flag and deletes
  // every row/identity this fixture created, unconditionally, whether or
  // not this assertion (or any above it) fails.
  await setClientAccess(db, fixture.accountId, false, fixture.clerkUserId);
  await page.goto(`/dashboard/accounts/${fixture.accountId}/dashboard`);
  await expect(page).toHaveURL(/\/no-access\?reason=off$/);
  await expect(page.getByText("Access has been turned off")).toBeVisible();
});
