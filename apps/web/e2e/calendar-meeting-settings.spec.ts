import { test, expect } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { serviceDb, updateCalendarSettings } from "@bis/db";
import { DEFAULT_FOLLOWUP_BODY } from "../src/lib/email/templates/followup";
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

/**
 * THE GRANT PROOF for the Critical fix on top of migration 0022: a save
 * that never touches the follow-up field must never write the frozen
 * default into `followup_body`. Before the fix, the textarea's own React
 * state was seeded with `DEFAULT_FOLLOWUP_BODY` whenever the stored column
 * was empty, and the shared `<form>` submits that state on EVERY save — so
 * saving an unrelated field (buffer minutes, here) silently pinned the
 * default text into the column. `bookingFollowupEmail` (followup.ts) only
 * ever falls back to the default for a genuinely empty column, so a pinned
 * copy going stale the moment the default's own copy changes was the
 * concrete failure this closes.
 *
 * Starts from the calendar's seeded default state (`resetMeetingFollowupSettings`
 * already guarantees `followup_body: ""` ran in the prior test's cleanup —
 * this test's own `beforeEach`-equivalent is the explicit reset call below,
 * so it does not depend on suite ordering), so the "still empty" assertion
 * after reload is provably about THIS save, not a column that was already
 * clean for an unrelated reason.
 */
test("saving unrelated settings never writes the default follow-up text into an empty column", async ({ page }) => {
  let accountId = "";

  try {
    await openAccountByName(page, SEEDED_ACCOUNT_NAME);
    await expect(page).toHaveURL(/\/contacts$/);
    accountId = new URL(page.url()).pathname.split("/")[3]!;
    await resetMeetingFollowupSettings(accountId);

    await page.getByRole("link", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/\/calendar$/);

    const followupField = page.getByLabel("Follow-up message");
    // Empty stored column: the textarea shows nothing, not the default text
    // — the default is only a greyed placeholder, proving the UI's seeding
    // fix as well as the server belt below.
    await expect(followupField).toHaveValue("");
    await expect(followupField).toHaveAttribute("placeholder", DEFAULT_FOLLOWUP_BODY);

    // Touch something else entirely and save, WITHOUT touching the
    // follow-up field at all. Meeting type, not some other field, because
    // it's what `resetMeetingFollowupSettings` already restores in cleanup
    // — no second reset path to keep in sync.
    await page.getByRole("combobox", { name: "Meeting type" }).click();
    await page.getByRole("option", { name: "Video" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Booking settings saved")).toBeVisible();

    await page.reload();

    // The unrelated field's save did land (grant proof this is a real
    // round trip through the database)...
    await expect(page.getByRole("combobox", { name: "Meeting type" })).toContainText("Video");
    // ...and the follow-up column is STILL empty — not pinned to the default.
    await expect(followupField).toHaveValue("");
    await expect(followupField).toHaveAttribute("placeholder", DEFAULT_FOLLOWUP_BODY);
  } finally {
    if (accountId) await resetMeetingFollowupSettings(accountId);
  }
});
