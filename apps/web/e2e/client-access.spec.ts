import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess } from "@bis/db";
import { clerkClient } from "@clerk/nextjs/server";
import { SEEDED_ACCOUNT_NAME } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

// This spec is the milestone's only automated proof that one client cannot
// reach another client's data (design spec section 10). It drives four
// full navigations under the RLS-enforcing dbForRequest() path, plus two
// direct DB writes and, in cleanup, two Clerk Backend API deletes — the
// same order of per-page cost blueprints.spec.ts's own comment measures for
// this account-scoped route family, times four page loads instead of one.
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
};

test("a client sees only their own account, and nothing when access is off", async ({ page }) => {
  const fixture = JSON.parse(
    readFileSync("e2e/.auth/client-fixture.json", "utf-8"),
  ) as ClientFixture;
  const db = serviceDb();

  try {
    // 1. Signing in lands on their own account's dashboard — not the
    // accounts list. (dashboard)/page.tsx's resolveClientAccount() redirect
    // is what's under test here.
    await page.goto("/");
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/accounts/${fixture.accountId}/dashboard$`),
    );

    // 2. The sidebar shows exactly the six in-account items, and no "Back
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

    // 3. Navigating to another account's URL redirects to their own
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

    // 4. The activation checklist panel does not appear on their dashboard
    // — it's agency work about the client, not client data (design
    // spec section 6.1). The fixture account is brand new, so every
    // catalogue item is still pending; if the isAgency gate around the
    // panel in [accountId]/dashboard/page.tsx were ever dropped, this
    // account is guaranteed to have a panel to show.
    await page.goto(`/dashboard/accounts/${fixture.accountId}/dashboard`);
    await expect(page.getByText("Activation checklist")).toHaveCount(0);

    // 5. With client_access_enabled flipped false, they get the no-access
    // page — not an empty CRM. This is what proves design spec sections
    // 3.3 and 8 are real rather than cosmetic: without the app-level
    // redirect, RLS's own client_access_enabled check in
    // app.current_account_id() (migration 0008) would independently zero
    // out every query on this page, producing a fully-rendered dashboard
    // with every stat reading 0 — exactly the "empty but fully functional
    // CRM" failure mode the design calls out as worse than an error.
    await setClientAccess(db, fixture.accountId, false, fixture.clerkUserId);
    await page.goto(`/dashboard/accounts/${fixture.accountId}/dashboard`);
    await expect(page).toHaveURL(/\/no-access\?reason=off$/);
    await expect(page.getByText("Access has been turned off")).toBeVisible();
  } finally {
    // Cleanup: this writes to and deletes from the shared dev Clerk
    // instance and the shared dev database. Every step below is wrapped so
    // a cleanup failure can never mask a real assertion failure above —
    // matching blueprints.spec.ts's own reasoning for the same shape.

    // Restore the flag before anything else — "restore what you toggle"
    // holds even though this account is deleted a few lines down, in case
    // that delete fails and the row survives.
    try {
      await setClientAccess(db, fixture.accountId, true, fixture.clerkUserId);
    } catch (e) {
      console.error(`client-access cleanup: restore client_access_enabled failed: ${String(e)}`);
    }

    try {
      // No CRM data was ever created under this account (every navigation
      // above was a GET), so accounts + its own events rows are the only
      // FK-referencing rows to clear before the accounts row itself —
      // events has no ON DELETE behavior (see 0001_tenancy.sql), so it
      // must go first, the same ordering blueprints.spec.ts uses.
      await db.from("events").delete().eq("account_id", fixture.accountId);
      const { error: delErr } = await db.from("accounts").delete().eq("id", fixture.accountId);
      if (delErr) {
        console.error(`client-access cleanup: account delete failed: ${delErr.message}`);
      }
    } catch (e) {
      console.error(`client-access cleanup: postgres delete failed: ${String(e)}`);
    }

    const clerk = await clerkClient();
    try {
      await clerk.organizations.deleteOrganization(fixture.clerkOrgId);
    } catch (e) {
      console.error(
        `client-access cleanup: failed to delete Clerk org ${fixture.clerkOrgId}: ${String(e)}`,
      );
    }
    try {
      await clerk.users.deleteUser(fixture.clerkUserId);
    } catch (e) {
      console.error(
        `client-access cleanup: failed to delete Clerk user ${fixture.clerkUserId}: ${String(e)}`,
      );
    }
  }
});
