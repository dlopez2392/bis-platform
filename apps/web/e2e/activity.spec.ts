import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess, saveQuietSettings, recordAutomationLog, DEFAULT_QUIET_SETTINGS } from "@bis/db";

// Same two paths, same reason, as every spec that talks to Supabase from the
// runner process rather than through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

test.describe.configure({ timeout: 90_000 });

type ClientFixture = { accountId: string; clerkUserId: string };
const FIXTURE_FILE = "e2e/.auth/client-fixture.json";
/** Read at RUN TIME, never at module scope (setup.spec.ts:70-84 explains the collection-time trap). */
const fixture = (): ClientFixture => {
  if (!existsSync(FIXTURE_FILE)) throw new Error(`client fixture missing at ${FIXTURE_FILE} — run the full suite`);
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf-8")) as ClientFixture;
};
/** A per-run stamp for every string this file writes, so a killed run's row can never satisfy a later run's assertion. */
const STAMP = Date.now().toString();

test.beforeAll(async () => {
  const { accountId, clerkUserId } = fixture();
  // client-access.spec.ts switches access OFF and does not restore it; establish the precondition here.
  await setClientAccess(serviceDb(), accountId, true, clerkUserId);
});

test.describe("quiet hours (agency)", () => {
  test("set a window that is NOT the default, reload, read it back — the round trip through serviceDb and the authenticated-role read", async ({ page }) => {
    const { accountId } = fixture();
    try {
      await page.goto(`/dashboard/accounts/${accountId}/automations`);
      const card = page.getByTestId("quiet-hours-card");
      await expect(card.getByText("Quiet hours", { exact: true })).toBeVisible();
      // 22:30 → 06:15: neither value is a default, so a page that rendered
      // DEFAULT_QUIET_SETTINGS after the save could not pass this.
      await card.getByLabel("From").fill("22:30");
      await card.getByLabel("Until").fill("06:15");
      await expect(card.getByTestId("quiet-hours-preview")).toContainText("10:30 PM – 6:15 AM");
      await card.getByRole("button", { name: "Save quiet hours" }).click();
      await expect(page.getByText("Quiet hours saved")).toBeVisible();

      await page.reload();
      const after = page.getByTestId("quiet-hours-card");
      await expect(after.getByLabel("From")).toHaveValue("22:30");
      await expect(after.getByLabel("Until")).toHaveValue("06:15");
      await expect(after.getByRole("checkbox")).toBeChecked();
      await expect(after).toContainText("Times are in America/Chicago");
    } finally {
      await saveQuietSettings(serviceDb(), accountId, DEFAULT_QUIET_SETTINGS, "e2e-cleanup");
    }
  });

  test("the Automations page links to What went out", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/automations`);
    await page.getByRole("link", { name: "See what went out" }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/accounts/${accountId}/activity$`));
    await expect(page.getByRole("heading", { name: "What went out" })).toBeVisible();
  });
});

test.describe("what went out (client)", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("the nav offers What went out; the empty state and this month's card render through RLS", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/dashboard`);
    await page.getByRole("link", { name: "What went out" }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/accounts/${accountId}/activity$`));
    await expect(page.getByText("Nothing has gone out yet")).toBeVisible();
    const month = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "America/Chicago" }).format(new Date());
    await expect(page.getByTestId("usage-card")).toContainText(month);
    await expect(page.getByTestId("usage-card")).toContainText("Texts sent");
  });

  test("a row renders with the recipe's TITLE, the status word and a reason the code could not produce by default", async ({ page }) => {
    const { accountId } = fixture();
    const subjectKey = `e2e:${STAMP}`;
    const reason = `E2E reason ${STAMP}`;
    try {
      // The accessor, under serviceDb — the same write every pass makes.
      await recordAutomationLog(serviceDb(), {
        accountId, source: "sms_reminder", channel: "sms", contactId: null, subjectKey, status: "skipped", reason,
      });
      await page.goto(`/dashboard/accounts/${accountId}/activity`);
      const row = page.locator("[data-log-row]").first();
      await expect(row).toContainText("Text reminders");
      await expect(row).not.toContainText("sms_reminder");
      await expect(row).toContainText("Skipped");
      await expect(row).toContainText(reason);
      await expect(page.getByTestId("usage-skipped")).toContainText(`1 skipped · most often: ${reason}`);
      await expect(page.getByText("Nothing has gone out yet")).toHaveCount(0);
    } finally {
      await serviceDb().from("automation_log").delete().eq("account_id", accountId).eq("subject_key", subjectKey);
    }
  });

  test("a client cannot reach the agency's Quiet hours card", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/automations`);
    await expect(page).toHaveURL(new RegExp(`/dashboard/accounts/${accountId}/dashboard$`));
  });
});
