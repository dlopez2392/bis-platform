import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { serviceDb, updateCalendarSettings } from "@bis/db";
import { openAccountByName, SEEDED_ACCOUNT_NAME } from "./support";

// Same two paths, same reason, as every other spec that talks to Supabase
// from the Playwright runner process directly (cleanup below), not through a
// Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

// One long journey, not several short tests: every later step depends on
// state the earlier ones created (the calendar's public URL, the booking's
// cancel link), so splitting it would mean re-deriving that state per test
// or sharing it through module state — both worse than one linear story.
// The whole suite already runs `workers: 1` against a shared build+database
// (see playwright.config.ts), so this buys nothing by being several tests.
test.describe.configure({ timeout: 180_000 });

const HOURS_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** The public booking page's loading placeholder is the literal "…"
 *  character (`booking-page.tsx`: `loadingSlots || !bookerTimezone`). Waiting
 *  for it to clear, rather than a fixed delay, is what makes the slot-finder
 *  below correct against a real server-action round trip whose cost this
 *  spec has no way to predict. */
async function waitForSlotsSettled(page: Page): Promise<void> {
  await expect(page.getByText("…", { exact: true })).toHaveCount(0, { timeout: 15_000 });
}

/**
 * Walks the public booking widget's week strip forward — up to 6 weeks,
 * comfortably inside the calendar's default 30-day `maxAdvanceDays` — and
 * returns the first day that offers at least one slot, plus that slot's own
 * rendered label. The label is what step 4 later asserts is GONE and step 5
 * asserts is back: capturing it here, rather than re-deriving it from the
 * booked ISO instant, is what keeps that assertion locked to what a visitor
 * actually SAW (booker-local formatting — the recorded lesson: this route
 * renders slot times in the BROWSER's zone, not the account's).
 *
 * Deliberately does not assume "today" has an offered slot: the calendar's
 * default `min_notice_hours` (12) can easily push the first bookable instant
 * past today's close, and this spec sets no explicit override for it.
 */
async function findFirstOfferedSlot(
  page: Page,
): Promise<{ weeksForward: number; dayIndex: number; slotLabel: string }> {
  await waitForSlotsSettled(page);
  for (let week = 0; week < 6; week++) {
    const dayButtons = page.locator("button.bis-booking-day:not([disabled])");
    const dayCount = await dayButtons.count();
    for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
      await dayButtons.nth(dayIndex).click();
      await waitForSlotsSettled(page);
      const slotButtons = page.locator("button.bis-booking-slot");
      if ((await slotButtons.count()) > 0) {
        const slotLabel = (await slotButtons.first().innerText()).trim();
        return { weeksForward: week, dayIndex, slotLabel };
      }
    }
    const nextWeek = page.getByRole("button", { name: "Next week" });
    if (!(await nextWeek.isEnabled())) break;
    await nextWeek.click();
  }
  throw new Error(
    "booking e2e: no offered slot within 6 weeks — Mon-Fri 09:00-17:00 should have offered one; " +
    "check the calendar's min_notice_hours/max_advance_days defaults haven't changed",
  );
}

/** Replays the exact navigation `findFirstOfferedSlot` used to reach a day,
 *  against a FRESH page load (weekStart always resets to today on load) —
 *  what lets steps 4 and 5 check the same calendar day again without
 *  depending on any client-side state surviving a reload. */
async function goToDay(page: Page, weeksForward: number, dayIndex: number): Promise<void> {
  for (let w = 0; w < weeksForward; w++) {
    await page.getByRole("button", { name: "Next week" }).click();
  }
  await page.locator("button.bis-booking-day:not([disabled])").nth(dayIndex).click();
  await waitForSlotsSettled(page);
}

/**
 * Deletes only what this run created, in FK-child-first order — the same
 * shape `forms.spec.ts`'s `purge()` uses, extended to also check every
 * delete's own error (that spec's doesn't). This targets a contact on the
 * SHARED `Test Client One` fixture account, not a throwaway E2E account, so
 * a silently-failed delete here is a real leak on real fixture data, not
 * just this run's own sandbox.
 *
 * Errors are logged, not thrown: throwing from a `finally` block REPLACES
 * whatever exception the `try` above it was already raising, which would
 * turn a real test failure into a confusing cleanup-only one. Reported
 * loudly in the test log is enough for a human to notice and re-run the
 * sweep by hand.
 */
async function purgeBooking(bookerEmail: string): Promise<void> {
  const db = serviceDb();
  const { data: contacts, error: contactsErr } = await db
    .from("contacts").select("id").eq("email", bookerEmail);
  if (contactsErr) {
    console.error(`booking e2e cleanup: contacts select failed: ${contactsErr.message}`);
    return;
  }
  for (const contact of contacts ?? []) {
    const { error: bookingsErr } = await db.from("bookings").delete().eq("contact_id", contact.id);
    if (bookingsErr) {
      console.error(`booking e2e cleanup: bookings delete for ${contact.id} failed: ${bookingsErr.message}`);
    }

    const { data: convos, error: convoSelectErr } = await db
      .from("conversations").select("id").eq("contact_id", contact.id);
    if (convoSelectErr) {
      console.error(`booking e2e cleanup: conversations select for ${contact.id} failed: ${convoSelectErr.message}`);
    }
    for (const convo of convos ?? []) {
      const { error: msgErr } = await db.from("messages").delete().eq("conversation_id", convo.id);
      if (msgErr) {
        console.error(`booking e2e cleanup: messages delete for ${convo.id} failed: ${msgErr.message}`);
      }
      const { error: convoErr } = await db.from("conversations").delete().eq("id", convo.id);
      if (convoErr) {
        console.error(`booking e2e cleanup: conversations delete for ${convo.id} failed: ${convoErr.message}`);
      }
    }

    const { error: contactErr } = await db.from("contacts").delete().eq("id", contact.id);
    if (contactErr) {
      console.error(`booking e2e cleanup: contacts delete for ${contact.id} failed: ${contactErr.message}`);
    }
  }
}

/** Disabled, empty hours — the calendar's inert resting state, so the next
 *  spec (or a human) never finds `Test Client One` silently bookable. Uses
 *  the same `@bis/db` helper the settings action itself calls, by explicit
 *  account id, rather than driving the UI a second time. */
async function resetCalendar(accountId: string): Promise<void> {
  try {
    await updateCalendarSettings(serviceDb(), accountId, { enabled: false, openHours: {} }, "e2e-cleanup");
  } catch (e) {
    console.error(`booking e2e cleanup: calendar reset for ${accountId} failed: ${String(e)}`);
  }
}

test("a stranger books, the operator sees it, the slot dies and revives", async ({ page, browser }) => {
  const stamp = Date.now();
  const bookerFirstName = "E2E";
  const bookerLastName = `Booker ${stamp}`;
  const bookerFullName = `${bookerFirstName} ${bookerLastName}`;
  // `+bkg<stamp>`: a plus-addressed, timestamp-unique mailbox on the same
  // IANA-reserved documentation domain the rest of this suite uses — never a
  // real inbox, and unique enough that this run's row can never be confused
  // with another concurrent or leftover one.
  const bookerEmail = `e2e+bkg${stamp}@example.com`;
  const noteText = `E2E booking note ${stamp}`;

  let accountId = "";
  let anonContext: BrowserContext | undefined;

  try {
    // --- Step 1: the agency configures the calendar (Task 9's own surface) ---
    await openAccountByName(page, SEEDED_ACCOUNT_NAME);
    await expect(page).toHaveURL(/\/contacts$/);
    accountId = new URL(page.url()).pathname.split("/")[3]!;

    await page.getByRole("link", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/\/calendar$/);

    // Clear every day first — defensive against a prior killed run's hours
    // surviving past its own `finally` (a hard-killed process, unlike a
    // clean Ctrl-C, can skip it) — then set the Mon-Fri window this journey
    // needs. IDs, not `getByLabel("From")`: the day labels are `sr-only` and
    // identical across all seven rows, so a label query is ambiguous under
    // strict mode (the `client-branding.spec.ts` lesson).
    for (const day of HOURS_DAYS) {
      await page.locator(`#hours-${day}-from`).fill("");
      await page.locator(`#hours-${day}-to`).fill("");
    }

    // --- The 08:00/18:00 seed fires on a deliberate pointer-open ONLY ------
    // Pinned here because the first version of that seed (`2cf6f25`) fired on
    // plain FOCUS, and this journey is what found it: `fill("")` focuses
    // before it writes, so the loop above could not clear a field that
    // re-seeded itself ("Malformed value"). The product half is worse than
    // the test half — a day whose two sides are both non-blank is an OPEN day
    // to `rowsToOpenHours`, so tabbing across a closed row and pressing Save
    // put the business on the schedule for it. Saturday stays closed for the
    // rest of this journey, so it is the honest row to prove it on.
    const satFrom = page.locator("#hours-sat-from");
    const satTo = page.locator("#hours-sat-to");
    await satFrom.focus();
    await satTo.focus();                    // ...which blurs sat-from
    await page.locator("#notifyEmails").focus(); // ...which blurs sat-to
    await expect(satFrom, "tabbing through a closed day must not open it").toHaveValue("");
    await expect(satTo, "tabbing through a closed day must not open it").toHaveValue("");

    // A pointer going down on the field still seeds it — the operator's own
    // fix, the reason any of this exists. (Center-click lands on a time
    // segment, not the clock affordance, so no native picker is left open.)
    await satFrom.click();
    await expect(satFrom).toHaveValue("08:00");
    await satTo.click();
    await expect(satTo).toHaveValue("18:00");
    // And a seeded field is still clearable, which is the whole test-half
    // regression: Saturday goes back to closed for the rest of the journey.
    await satFrom.fill("");
    await satTo.fill("");
    await expect(satFrom).toHaveValue("");
    await expect(satTo).toHaveValue("");

    for (const day of ["mon", "tue", "wed", "thu", "fri"] as const) {
      await page.locator(`#hours-${day}-from`).fill("09:00");
      await page.locator(`#hours-${day}-to`).fill("17:00");
    }

    await page.getByRole("combobox", { name: "Appointment length" }).click();
    await page.getByRole("option", { name: "60 min" }).click();

    await page.getByLabel("Accept bookings").check();

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Booking settings saved")).toBeVisible();

    // Re-fetches the Server Component with the just-saved `enabled: true` —
    // the embed card's "Direct link" only renders once that prop is true,
    // and this is more certain than trusting the Server Action's own
    // automatic revalidation timing.
    await page.reload();

    const publicLink = page.getByRole("link", { name: /\/b\// });
    await expect(publicLink).toBeVisible();
    const publicHref = await publicLink.getAttribute("href");
    expect(publicHref, "an enabled calendar must expose a direct booking link").toBeTruthy();
    const publicPath = new URL(publicHref!).pathname;

    // --- Step 2: a stranger books, in a fresh anonymous context ------------
    anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();

    const navigatedAt = Date.now();
    await anonPage.goto(publicPath);

    const { weeksForward, dayIndex, slotLabel } = await findFirstOfferedSlot(anonPage);
    await anonPage.locator("button.bis-booking-slot").first().click();

    await anonPage.getByLabel("First name").fill(bookerFirstName);
    await anonPage.getByLabel(/Last name/).fill(bookerLastName);
    await anonPage.getByLabel("Email").fill(bookerEmail);
    await anonPage.getByLabel(/^Note/).fill(noteText);

    // The fill-time guard rejects anything faster than MIN_FILL_MS (2s) from
    // the page's own render token — a rejected submission FAKE-SUCCEEDS with
    // `cancelUrl: ""`, indistinguishable from a real booking by the success
    // panel alone. Waiting out the full window from page load, not just from
    // here, is what makes the non-empty cancelUrl assertion below actually
    // mean something.
    const elapsedMs = Date.now() - navigatedAt;
    if (elapsedMs < 2_500) await anonPage.waitForTimeout(2_500 - elapsedMs);

    await anonPage.getByRole("button", { name: "Confirm booking" }).click();
    await expect(anonPage.getByRole("status")).toContainText(/booked in/i);

    // THE positive proof, before any absence assertion follows: a real
    // booking got a real cancel link. The too-fast/honeypot/malformed-token
    // paths all return the identical success panel with `cancelUrl: ""` —
    // this is the one thing that tells the two apart from the outside.
    const cancelLink = anonPage.getByRole("link", { name: /cancel or reschedule/i });
    await expect(cancelLink).toBeVisible();
    const cancelHref = await cancelLink.getAttribute("href");
    expect(
      cancelHref,
      "a genuine booking must expose a non-empty cancel link — an empty one means the " +
      "too-fast/honeypot/token guard fired and nothing was actually booked",
    ).toBeTruthy();

    // --- Step 3: the operator sees it, positive assertions first -----------
    await page.goto(`/dashboard/accounts/${accountId}/conversations`);
    const thread = page.getByRole("link").filter({ hasText: bookerFullName });
    await expect(thread).toBeVisible();
    await expect(thread.getByLabel(/unread/)).toBeVisible();
    // The thread names the SLOT, not just the booker — the preview is the
    // booking message's own body (`Booking: <when>`), not a generic "New
    // message" label.
    await expect(thread).toContainText("Booking");

    await page.goto(`/dashboard/accounts/${accountId}/calendar`);
    await expect(page.getByText(bookerFullName)).toBeVisible();
    await expect(page.getByText(noteText)).toBeVisible();

    // --- Step 4: the SAME slot is gone from the public page ----------------
    // Negative half, locked to the exact label step 2 captured — a fresh
    // page load resets the week strip back to today, so this replays the
    // same forward-paging to land on the same calendar day again.
    await anonPage.goto(publicPath);
    await goToDay(anonPage, weeksForward, dayIndex);
    await expect(anonPage.getByRole("button", { name: slotLabel, exact: true })).toHaveCount(0);

    // --- Step 5: cancel via the captured link, then idempotent replay ------
    await anonPage.goto(cancelHref!);
    await expect(anonPage.getByText("Cancel this booking?")).toBeVisible();
    await anonPage.getByRole("button", { name: "Cancel booking" }).click();
    await expect(anonPage.getByRole("status")).toContainText(/already been cancelled/i);

    // Opening the SAME link again must be a no-op that reads the same way,
    // not an error and not a second cancellation event.
    await anonPage.goto(cancelHref!);
    await expect(anonPage.getByRole("status")).toContainText(/already been cancelled/i);

    // A cancelled booking frees its range — the slot must be offered again.
    await anonPage.goto(publicPath);
    await goToDay(anonPage, weeksForward, dayIndex);
    await expect(anonPage.getByRole("button", { name: slotLabel, exact: true })).toBeVisible();

    // --- Step 6: disabling the calendar takes the public URL down ----------
    await page.goto(`/dashboard/accounts/${accountId}/calendar`);
    await page.getByLabel("Accept bookings").uncheck();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Booking settings saved")).toBeVisible();

    const response = await anonPage.goto(publicPath);
    expect(response?.status(), "a disabled calendar's public URL must 404").toBe(404);
  } finally {
    if (anonContext) await anonContext.close().catch(() => {});
    await purgeBooking(bookerEmail);
    if (accountId) await resetCalendar(accountId);
  }
});
