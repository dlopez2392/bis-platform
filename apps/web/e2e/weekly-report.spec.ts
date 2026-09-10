import { test, expect } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { serviceDb, setReportEmails } from "@bis/db";
import { readClientFixture } from "./support";

// Same two paths, same reason, as every other spec that talks to Supabase
// from the Playwright runner process directly (cleanup below), not through a
// Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

test.describe.configure({ timeout: 60_000 });

/**
 * Resets the fixture account back to no recipients, the same
 * try/finally-in-every-test shape calendar-meeting-settings.spec.ts uses:
 * this file's own two tests share the ONE per-run fixture account (serial
 * suite), and the second test's "was nothing saved" assertion depends on
 * starting from a known-empty list rather than whatever the first test left
 * behind.
 */
async function resetReportEmails(accountId: string): Promise<void> {
  try {
    await setReportEmails(serviceDb(), accountId, [], "e2e-cleanup");
  } catch (e) {
    console.error(`weekly-report e2e cleanup: reset for ${accountId} failed: ${String(e)}`);
  }
}

test("an agency admin saves report recipients and they survive a reload", async ({ page }) => {
  const fixture = readClientFixture();
  if (!fixture) {
    test.skip(true, "No client fixture — the setup project creates it; run the full suite.");
    return;
  }
  const { accountId } = fixture;

  try {
    await page.goto(`/dashboard/accounts/${accountId}/settings`);

    // Scoped to the card's own id: this page also renders BrandingPanel's,
    // SendingAddressCard's and LinkSiteCard's own "Save" buttons, so an
    // unscoped getByRole("button", { name: "Save" }) is ambiguous.
    const card = page.locator("#weekly-report");
    await card.getByLabel("Weekly report").fill("owner@example.com, book@example.com");
    await card.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved. The next report goes out Monday morning.")).toBeVisible();

    // The grant proof: reload re-fetches the Server Component from the
    // database, so the value shown came back through a real serviceDb()
    // write and a real authenticated-role read, not client-side state
    // surviving in memory.
    await page.reload();
    await expect(page.locator("#weekly-report").getByLabel("Weekly report"))
      .toHaveValue("owner@example.com, book@example.com");
  } finally {
    if (accountId) await resetReportEmails(accountId);
  }
});

test("refuses a malformed address without saving", async ({ page }) => {
  const fixture = readClientFixture();
  if (!fixture) {
    test.skip(true, "No client fixture — the setup project creates it; run the full suite.");
    return;
  }
  const { accountId } = fixture;

  try {
    await page.goto(`/dashboard/accounts/${accountId}/settings`);

    const card = page.locator("#weekly-report");
    await card.getByLabel("Weekly report").fill("owner@example.com, not-an-email");
    await card.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("That doesn't look like an email address: not-an-email")).toBeVisible();

    // Refused, not partially saved — a reload shows the account still has no
    // recipients, not "owner@example.com" kept and the bad one dropped.
    await page.reload();
    await expect(page.locator("#weekly-report").getByLabel("Weekly report")).toHaveValue("");
  } finally {
    if (accountId) await resetReportEmails(accountId);
  }
});
