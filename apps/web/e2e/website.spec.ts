import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess, upsertSite } from "@bis/db";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

// The same per-page cost as client-access.spec.ts: every load runs under the
// RLS-enforcing dbForRequest() path.
test.describe.configure({ timeout: 60_000 });

type ClientFixture = { accountId: string; clerkUserId: string };
const fixture = (): ClientFixture =>
  JSON.parse(readFileSync("e2e/.auth/client-fixture.json", "utf-8")) as ClientFixture;

// client-access.spec.ts switches the fixture's access OFF and does not
// restore it (auth.teardown deletes the fixture); establish the precondition
// here so filename order cannot decide the result (the automations precedent).
test.beforeAll(async () => {
  const { accountId, clerkUserId } = fixture();
  await setClientAccess(serviceDb(), accountId, true, clerkUserId);
});

test.describe("the Website section, as the agency", () => {
  test("unlinked: sells the feature and offers Link a site; linked-but-unsynced: says the numbers arrive tomorrow", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/website`);
    await expect(page.getByRole("heading", { name: "Website", exact: true })).toBeVisible();
    await expect(page.getByText("See who visits your website")).toBeVisible();
    await expect(page.getByRole("link", { name: "Link a site" }))
      .toHaveAttribute("href", `/dashboard/accounts/${accountId}/settings#website`);

    // Link a site directly (the card's actions are unit-tested; the e2e proves
    // the page's state machine on real rows). The three traffic tables are in
    // auth.teardown's cascade (fixtures/sweep.ts), so this leaves nothing behind.
    await upsertSite(serviceDb(), accountId, {
      vercelProjectId: `prj_e2e_${accountId.slice(0, 8)}`, domain: "fixture.example",
    });
    await page.reload();
    await expect(page.getByText("Your first numbers arrive tomorrow morning")).toBeVisible();
    await expect(page.getByText("fixture.example is connected")).toBeVisible();
    // Skeletons, not spinners — and no numbers invented before a full day exists.
    await expect(page.locator('[data-slot="skeleton"]').first()).toBeVisible();
    await expect(page.getByText("Visitors", { exact: true })).toHaveCount(0);
  });
});

test.describe("the Website section, as the client", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });
  // Runs after the agency test above (one worker, file order — see
  // playwright.config.ts), which is what linked the site it reads.
  test("appears in their nav under Dashboard and shows the same waiting state, never a Link a site button", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/dashboard`);
    const nav = page.locator("aside nav");
    const links = await nav.getByRole("link").allTextContents();
    expect(links.indexOf("Website")).toBe(links.indexOf("Dashboard") + 1);
    await nav.getByRole("link", { name: "Website", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/accounts/${accountId}/website$`));
    await expect(page.getByText("Your first numbers arrive tomorrow morning")).toBeVisible();
    await expect(page.getByRole("link", { name: "Link a site" })).toHaveCount(0);
  });
});

test.describe("unlinking a site, as the agency", () => {
  // Last in the file on purpose (one worker, file order): the client test
  // above still needs the linked state, and this leaves the fixture unlinked.
  test("Settings → Unlink site asks first, then the Website section sells the feature again", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/settings#website`);
    await expect(page.getByText("Linked to fixture.example")).toBeVisible();
    await page.getByRole("button", { name: "Unlink site" }).click();
    // The confirmation names the domain; Cancel leaves everything in place.
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Unlink fixture.example?" })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Linked to fixture.example")).toBeVisible();
    await page.getByRole("button", { name: "Unlink site" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Unlink", exact: true }).click();
    await expect(page.getByText("Site unlinked")).toBeVisible();
    // The card re-rendered unlinked: no button, the sell copy back.
    await expect(page.getByRole("button", { name: "Unlink site" })).toHaveCount(0);
    await expect(page.getByText("Connect the site BIS built for this client")).toBeVisible();
    await page.goto(`/dashboard/accounts/${accountId}/website`);
    await expect(page.getByText("See who visits your website")).toBeVisible();
    await expect(page.getByRole("link", { name: "Link a site" })).toBeVisible();
  });
});

