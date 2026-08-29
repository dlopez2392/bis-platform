import { test, expect } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { serviceDb, updateCalendarSettings } from "@bis/db";
import { openAccountByName, SEEDED_ACCOUNT_NAME } from "./support";

// Same two paths, same reason, as every other spec that talks to Supabase
// from the Playwright runner process directly (cleanup below), not through a
// Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

test.describe.configure({ timeout: 60_000 });

/**
 * THE GRANT PROOF for migration 0022: `booking-grants.test.ts` pins the
 * columns `authenticated` may UPDATE on `calendars`, and a serviceDb-backed
 * fixture is blind to that boundary (the recorded serviceDb-blindness
 * lesson — two shipped defects already came from tests that couldn't see a
 * missing grant). Only a real dashboard session, writing through the real
 * `dbForRequest()`-backed action, can prove `meeting_type`, `followup_enabled`,
 * and `followup_body` actually persist for an `authenticated` writer.
 *
 * Resets the three columns back to their defaults in `finally`, by explicit
 * account id, so a later spec never finds `Test Client One`'s calendar
 * flipped to video/follow-up-on. Deliberately leaves `enabled`/hours/other
 * settings untouched — this journey never touches those fields through the
 * form, so nothing here should touch them in cleanup either.
 */
async function resetMeetingFollowupSettings(accountId: string): Promise<void> {
  try {
    await updateCalendarSettings(serviceDb(), accountId, {
      meetingType: "in_person",
      followupEnabled: false,
      followupBody: "",
    }, "e2e-cleanup");
  } catch (e) {
    console.error(`calendar-meeting-settings e2e cleanup: reset for ${accountId} failed: ${String(e)}`);
  }
}

test("an agency operator sets meeting type + follow-up, and both survive a reload", async ({ page }) => {
  const customBody = `E2E follow-up body ${Date.now()}`;
  let accountId = "";

  try {
    await openAccountByName(page, SEEDED_ACCOUNT_NAME);
    await expect(page).toHaveURL(/\/contacts$/);
    accountId = new URL(page.url()).pathname.split("/")[3]!;

    await page.getByRole("link", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/\/calendar$/);

    await page.getByRole("combobox", { name: "Meeting type" }).click();
    await page.getByRole("option", { name: "Video" }).click();

    await page.getByLabel("Send a follow-up email after appointments").check();
    await page.getByLabel("Follow-up message").fill(customBody);

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Booking settings saved")).toBeVisible();

    // The grant proof: reload re-fetches the Server Component from the
    // database, so anything visible here came back through a real
    // `authenticated`-role UPDATE, not client-side state surviving in memory.
    await page.reload();

    await expect(page.getByRole("combobox", { name: "Meeting type" })).toContainText("Video");
    await expect(page.getByLabel("Send a follow-up email after appointments")).toBeChecked();
    await expect(page.getByLabel("Follow-up message")).toHaveValue(customBody);
  } finally {
    if (accountId) await resetMeetingFollowupSettings(accountId);
  }
});
