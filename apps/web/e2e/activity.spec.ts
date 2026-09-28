import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess, recordAutomationLog } from "@bis/db";

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
  test("the sending hours are stated, read-only, in the account's zone — there is nothing to save (consent chain PR-1)", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/automations`);
    const card = page.getByTestId("quiet-hours-card");
    await expect(card.getByText("Quiet hours", { exact: true })).toBeVisible();
    // The fixture account is created with no zone (auth.setup.ts), so the
    // column default America/Chicago (0001) applies and the sentence names
    // it; a card that dropped the {zone} replace would show "{zone}".
    await expect(card.getByTestId("quiet-hours-fixed")).toContainText("between 8 a.m. and 9 p.m. in your time zone (America/Chicago)");
    await expect(card.getByTestId("quiet-hours-fixed")).toContainText("on Sundays until noon");
    // The old form is gone: no time inputs, no switch, no Save.
    await expect(card.getByRole("button")).toHaveCount(0);
    await expect(card.getByRole("textbox")).toHaveCount(0);
    await expect(card.getByRole("checkbox")).toHaveCount(0);
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
