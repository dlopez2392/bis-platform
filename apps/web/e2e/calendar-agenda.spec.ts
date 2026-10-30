import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { test, expect, type Page } from "./fixtures/test";
import { serviceDb, getOrCreateCalendar, updateCalendarSettings, setBookingStatus, readAccountTimezone } from "@bis/db";
import { m } from "../src/lib/messages";
import { dayKey, addDays } from "../src/lib/business-status/status";
import { agendaWindow, agendaTime, wallToInstant } from "../src/lib/booking/agenda-window";
import { UNDO_WINDOW_MS } from "../src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/undo-window";

// Same two paths, same reason, as every other spec that talks to Supabase from
// the Playwright runner process rather than through a Next.js request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * WHY THIS FILE EXISTS.
 *
 * Plan Task 14 (F-046 part 1, 2026-10-30): the ONLY real-browser proof that a staff-made job added from a
 * free hour on the agenda actually (a) shows on the Day list, (b) can be undone inside its window with
 * nobody told, (c) once kept, actually blocks that time on the slot engine customers and Sofía see
 * (R2 — `bookings_no_overlap` narrowed to customer-made rows), (d) can still be saved outside open hours
 * once the warning is confirmed past, and (e) opens the same job's drawer whether reached by clicking its
 * row or by its own `?job=` link. Every other file in this plan proves the pieces without a browser
 * (`job-sheet-handlers.test.ts`, `job-drawer-handlers.test.ts`, `agenda-view.test.ts`, `agenda-actions.test.ts`,
 * `calendar-agenda-schema.test.ts`); this is the one place the click, the server action, the revalidated
 * agenda and the public booking page's own read of the SAME row all run for real, together.
 *
 * ALL mutations run on the per-run CLIENT FIXTURE account ("E2E Client Co …", auth.setup.ts creates it,
 * auth.teardown.ts deletes it unconditionally) — never on `Test Client One` or any live account (CLAUDE.md
 * hard rule, restated for calendar/booking specs: one Supabase project means a write to the shared seeded
 * account is a production write).
 *
 * WHY THE SLOT LABEL IS NEVER A LITERAL. The public booking page renders every slot in the VISITOR's own
 * device zone (`useBookerTimezone`, `slot-picker.tsx`), not the account's zone — so "the 10:00 slot is
 * offered" is only true of the ACCOUNT's 10:00, which can display as a different clock time on whatever
 * machine runs this suite. Step 6 below computes the expected label INSIDE the page (`page.evaluate`),
 * with the same `Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" })` call the component
 * itself makes, against the UTC instant `wallToInstant` derives from the account's own 10:00/11:00 — so the
 * assertion is correct on any runner's clock, not just one whose zone happens to match the fixture's.
 */
test.describe.configure({ timeout: 180_000 });

type ClientFixtureFull = { accountId: string; clerkUserId: string };
const CLIENT_FIXTURE_FILE = "e2e/.auth/client-fixture.json";

/**
 * Copied from contacts-archive.spec.ts (not exported there), which copied it from contacts-drawer.spec.ts.
 * Read at RUN TIME, never at module scope: Playwright evaluates module scope during COLLECTION, before the
 * "setup" project has written this file. Missing at run time is a FAILURE, not a skip — it means the
 * "setup" project's dependency was bypassed (a filtered invocation, or a bare "playwright test <file>").
 */
function fullFixture(): ClientFixtureFull {
  if (!existsSync(CLIENT_FIXTURE_FILE)) {
    throw new Error(
      `client fixture missing at ${CLIENT_FIXTURE_FILE} — the "setup" project did not run ` +
      `(a filtered invocation, or a bare "playwright test <file>", skips its dependency). ` +
      `Run the full suite: pnpm --filter web test:e2e.`,
    );
  }
  return JSON.parse(readFileSync(CLIENT_FIXTURE_FILE, "utf-8")) as ClientFixtureFull;
}

const STAMP = Date.now();
const ACTOR = "e2e-calendar-agenda-spec";
const CONTACT_FIRST = "Agenda";
const CONTACT_LAST = `Client ${STAMP}`;
const CONTACT_FULL_NAME = `${CONTACT_FIRST} ${CONTACT_LAST}`;
// NEVER `e2e+<tag><stamp>@example.com`: emailKey() (packages/db/contacts.ts) strips `+...@`, so every spec
// using that shape collapses to the SAME key (`e2e@example.com`) and one spec's createContact (matchBy
// "email_only") can pick up another's leftover contact (calendar-feed.spec.ts did, via this exact row). The
// stamp alone makes the local part unique; no `+` means nothing to strip.
const CONTACT_EMAIL = `agenda-${STAMP}@example.com`;
const JOB_WHAT = "Fix the leaking water heater";

/** The booking page's own loading state (`.bis-booking-skeletons`) — booking.spec.ts's and
 *  one-switch.spec.ts's identical helper, copied rather than imported (neither exports it). */
async function waitForSlotsSettled(page: Page): Promise<void> {
  await expect(page.locator(".bis-booking-skeletons")).toHaveCount(0, { timeout: 15_000 });
}

/** The public page's day-chip aria-label, English, minus the "(Today)" suffix no day this far out ever
 *  carries — one-switch.spec.ts's `publicDayLabel`, copied (not exported there either). */
function publicDayLabel(dayKeyStr: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${dayKeyStr}T12:00:00Z`));
}

function weekdayOf(dayKeyStr: string): number {
  const [y, mo, d] = dayKeyStr.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

/** An opening fragment of a parameterised message, up to its first placeholder — enough to recognise the
 *  right toast without reconstructing the server's own formatting of `{when}`/`{first}`. */
function opening(template: string): string {
  return template.split("{")[0]!.trim();
}

/** `starts_at` read back as `HH:MM` in the account's own zone — exactly the read a person looking at the
 *  agenda row would make, so matching it never depends on reproducing the app's own UTC arithmetic a second
 *  time in the test. */
function wallClockOf(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "numeric", minute: "numeric" })
    .formatToParts(new Date(iso));
  const hh = parts.find((p) => p.type === "hour")!.value.padStart(2, "0");
  const mi = parts.find((p) => p.type === "minute")!.value.padStart(2, "0");
  return `${hh}:${mi}`;
}

/**
 * The booking at wall time `hhmm` (the account's own zone) on the picked day, for this contact — found by
 * CONTACT + DAY, never by an exact-instant match. This suite runs right after the fall-back (DST ends the
 * first Sunday of November), where a correctly-saved 18:00 add lands on `T00:00:00.000Z` the NEXT calendar
 * day — a real, correct result of the account's zone, not a bug — so a test that recomputes that same UTC
 * instant a second time and then demands bit-for-bit equality with whatever the server actually wrote is
 * exactly the kind of duplicated arithmetic that goes quietly wrong at a zone boundary. Scoped to the picked
 * day's own bounds (`agendaWindow`'s day, the app's own reckoning of "a day" in this zone) and picked out by
 * its OWN wall clock, read back exactly as the agenda row would show it — so the assertion still proves the
 * booking landed at the intended time, not merely that some row for this contact exists that day.
 */
async function findBookingId(
  accountId: string, contactId: string, dayStart: Date, dayEnd: Date, hhmm: string, timezone: string,
): Promise<string> {
  const { data, error } = await serviceDb().from("bookings").select("id, starts_at")
    .eq("account_id", accountId).eq("contact_id", contactId).eq("status", "booked")
    .gte("starts_at", dayStart.toISOString()).lt("starts_at", dayEnd.toISOString());
  if (error) {
    throw new Error(
      `calendar-agenda e2e: looking up the ${hhmm} booking between ${dayStart.toISOString()} and ` +
      `${dayEnd.toISOString()} failed: ${error.message}`,
    );
  }
  const rows = data ?? [];
  const hit = rows.find((r) => wallClockOf(r.starts_at as string, timezone) === hhmm);
  if (!hit) {
    throw new Error(
      `calendar-agenda e2e: could not find a ${hhmm} booking (account zone ${timezone}) for contact ${contactId} ` +
      `between ${dayStart.toISOString()} and ${dayEnd.toISOString()}: ${rows.length} booking(s) that day, none at ${hhmm}`,
    );
  }
  return hit.id as string;
}

let accountId = "";
let timezone = "America/Chicago";
let calendarPublicId = "";
let dayKeyPicked = "";
let pickedOffset = 0;
let contactId = "";
let dayLabelText = "";
let calendarSeeded = false;
let priorSettings: {
  enabled: boolean; openHours: Record<string, [string, string][]>;
  slotDurationMinutes: number; bufferMinutes: number; minNoticeHours: number; maxAdvanceDays: number;
} | null = null;

// Known once each job is added (step 2/4/5); `afterAll` cancels whichever of these are still live so the
// fixture calendar is clean for later specs — the 10:00 job is deleted outright by its own Undo (step 3),
// never cancelled, so it carries no id here.
let bookingIdAt11: string | null = null;
let bookingIdAt18: string | null = null;

test.beforeAll(async () => {
  accountId = fullFixture().accountId;
  const db = serviceDb();

  const calendar = await getOrCreateCalendar(db, accountId, ACTOR);
  calendarPublicId = calendar.public_id;
  priorSettings = {
    enabled: calendar.enabled, openHours: calendar.open_hours,
    slotDurationMinutes: calendar.slot_duration_minutes, bufferMinutes: calendar.buffer_minutes,
    minNoticeHours: calendar.min_notice_hours, maxAdvanceDays: calendar.max_advance_days,
  };
  // Plan review minor: a buffer would block the 10:00 control once the 11:00 job is kept (10:00-11:00 would
  // sit inside the 11:00 job's own buffer), so the control could never pass. 60-minute slots, no buffer,
  // Mon-Fri 09:00-17:00, so 18:00 is reliably outside hours and 10:00/11:00 are reliably inside them.
  await updateCalendarSettings(db, accountId, {
    enabled: true,
    openHours: {
      mon: [["09:00", "17:00"]], tue: [["09:00", "17:00"]], wed: [["09:00", "17:00"]],
      thu: [["09:00", "17:00"]], fri: [["09:00", "17:00"]],
    },
    slotDurationMinutes: 60, bufferMinutes: 0, minNoticeHours: 1, maxAdvanceDays: 30,
  }, ACTOR);
  calendarSeeded = true;

  timezone = (await readAccountTimezone(db, accountId)) ?? "America/Chicago";
  const today = dayKey(new Date(), timezone);
  // A weekday at least two days out (plan Task 14 step 2): offsets 2-8 cover a full week, so one of them is
  // guaranteed to land on Mon-Fri.
  for (let offset = 2; offset <= 8; offset++) {
    const candidate = addDays(today, offset);
    const dow = weekdayOf(candidate);
    if (dow >= 1 && dow <= 5) {
      dayKeyPicked = candidate;
      pickedOffset = offset;
      break;
    }
  }
  if (!dayKeyPicked) {
    throw new Error("calendar-agenda e2e: no weekday 2-8 days out — should be impossible in a 7-day window");
  }

  const { data: contact, error: contactErr } = await db.from("contacts")
    .insert({ account_id: accountId, first_name: CONTACT_FIRST, last_name: CONTACT_LAST, email: CONTACT_EMAIL })
    .select("id").single();
  if (contactErr || !contact) throw new Error(`calendar-agenda e2e: seeding the contact failed: ${contactErr?.message ?? "no row"}`);
  contactId = contact.id as string;
});

test.afterAll(async () => {
  if (!accountId) return;
  const db = serviceDb();
  const problems: string[] = [];
  const fail = (line: string) => { console.error(line); problems.push(line); };

  for (const id of [bookingIdAt11, bookingIdAt18]) {
    if (!id) continue;
    try {
      await setBookingStatus(db, accountId, id, "cancelled", ACTOR);
    } catch (e) {
      fail(`calendar-agenda e2e cleanup: cancelling booking ${id} failed: ${String(e)}`);
    }
  }

  // Delete every row this spec wrote for its own contact — any booking row (cancelled or not) blocks
  // deleting the contact (`bookings_contact_id_fkey`), and the contact itself must not outlive this spec:
  // another spec's createContact (matchBy "email_only") could otherwise still find it by name or future
  // email collision. The fixture teardown deletes the whole per-run account eventually, but other specs run
  // against the SAME account before that happens.
  if (contactId) {
    try {
      await db.from("bookings").delete().eq("account_id", accountId).eq("contact_id", contactId);
    } catch (e) {
      fail(`calendar-agenda e2e cleanup: deleting this contact's bookings failed: ${String(e)}`);
    }
    try {
      await db.from("contacts").delete().eq("account_id", accountId).eq("id", contactId);
    } catch (e) {
      fail(`calendar-agenda e2e cleanup: deleting the seeded contact failed: ${String(e)}`);
    }
  }

  if (calendarSeeded && priorSettings) {
    try {
      await updateCalendarSettings(db, accountId, priorSettings, ACTOR);
    } catch (e) {
      fail(`calendar-agenda e2e cleanup: restoring the calendar failed: ${String(e)}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`calendar-agenda e2e cleanup left the fixture dirty:\n${problems.join("\n")}`);
  }
});

test("a job added from a free hour shows on the Day, undoes clean, blocks the public slot once kept, and opens its drawer by row and by link", async ({ page }) => {
  const main = page.getByRole("main");
  const calendarUrl = `/dashboard/accounts/${accountId}/calendar?view=day&day=${dayKeyPicked}`;

  const agendaDay = agendaWindow("day", dayKeyPicked, timezone).days[0]!;
  const zoneShift = agendaDay.zoneShift;
  const timeLabel = (hhmm: string) => agendaTime(wallToInstant(dayKeyPicked, hhmm, timezone)!, timezone, "en", zoneShift);
  const addAtLabel = (hhmm: string) => m["calendar.agenda.addAt"].replace("{time}", timeLabel(hhmm));
  // Only for the public page's expected slot LABEL (step 6) — never for a DB lookup; see findBookingId's doc.
  const at10Iso = wallToInstant(dayKeyPicked, "10:00", timezone)!.toISOString();
  const at11Iso = wallToInstant(dayKeyPicked, "11:00", timezone)!.toISOString();
  const findOnDay = (hhmm: string) => findBookingId(accountId, contactId, agendaDay.start, agendaDay.end, hhmm, timezone);

  // --- Step 1: the agenda is in `main`, before the Booking settings card -----------------------------
  await page.goto(calendarUrl);
  const agendaCard = main.locator('[data-agenda-card="ready"]');
  await expect(agendaCard).toBeVisible();
  const settingsHeading = main.getByRole("heading", { name: m["calendar.settings.title"], exact: true });
  await expect(settingsHeading).toBeVisible();
  const agendaBox = await agendaCard.boundingBox();
  const settingsBox = await settingsHeading.boundingBox();
  if (!agendaBox || !settingsBox) {
    throw new Error("calendar-agenda e2e: could not measure the agenda card or the Booking settings heading");
  }
  expect(agendaBox.y, "the agenda card sits above the Booking settings card").toBeLessThan(settingsBox.y);
  dayLabelText = await main.locator("[data-agenda-date]").innerText();

  // --- Step 2: click the free row at 10:00, choose the seeded contact, save -------------------------
  await main.getByRole("button", { name: addAtLabel("10:00"), exact: true }).click();
  let sheet = page.getByRole("dialog");
  await sheet.getByPlaceholder(m["calendar.job.search"]).fill(CONTACT_LAST);
  const hit10 = sheet.locator("[data-job-hit]").filter({ hasText: CONTACT_FULL_NAME });
  await expect(hit10).toBeVisible();
  await hit10.click();
  await sheet.getByLabel(m["calendar.job.what"]).fill(JOB_WHAT);
  await sheet.getByRole("button", { name: m["calendar.job.save"], exact: true }).click();

  const addedToast10 = page.locator("[data-sonner-toast]").filter({ hasText: opening(m["calendar.job.added"]) });
  await expect(addedToast10).toBeVisible();
  const bookingIdAt10 = await findOnDay("10:00");
  const row10 = main.locator(`#booking-${bookingIdAt10}`);
  await expect(row10).toBeVisible();
  await expect(row10).toContainText(CONTACT_FULL_NAME);
  await expect(row10).toContainText(JOB_WHAT);

  // --- Step 3: Undo inside the window — nobody is told, and the row and its free slot come back -----
  await addedToast10.getByRole("button", { name: m["calendar.job.undo"], exact: true }).click();
  const undoneToast = page.locator("[data-sonner-toast]").filter({ hasText: opening(m["calendar.job.undone"]) });
  await expect(undoneToast).toBeVisible();
  await page.reload();
  await expect(main.locator(`#booking-${bookingIdAt10}`)).toHaveCount(0);
  await expect(main.getByRole("button", { name: addAtLabel("10:00"), exact: true })).toBeVisible();

  // --- Step 4: add a job at 11:00 the same way, and keep it ------------------------------------------
  await main.getByRole("button", { name: addAtLabel("11:00"), exact: true }).click();
  sheet = page.getByRole("dialog");
  await sheet.getByPlaceholder(m["calendar.job.search"]).fill(CONTACT_LAST);
  const hit11 = sheet.locator("[data-job-hit]").filter({ hasText: CONTACT_FULL_NAME });
  await expect(hit11).toBeVisible();
  await hit11.click();
  await sheet.getByLabel(m["calendar.job.what"]).fill(JOB_WHAT);
  await sheet.getByRole("button", { name: m["calendar.job.save"], exact: true }).click();

  const addedToast11 = page.locator("[data-sonner-toast]").filter({ hasText: opening(m["calendar.job.added"]) });
  await expect(addedToast11).toBeVisible();
  bookingIdAt11 = await findOnDay("11:00");
  const row11 = main.locator(`#booking-${bookingIdAt11}`);
  await expect(row11).toBeVisible();
  await expect(row11).toContainText(CONTACT_FULL_NAME);

  // --- Step 5: add one at 18:00, outside open hours — warned, then saved past the warning ------------
  // The 11:00 job's "Job added for …" toast stays up for its whole Undo window (toastWithUndo), and the 18:00
  // toast below is found by the same words. Left up, it satisfied that wait 10 ms after "Add it anyway" was
  // pressed, while the 18:00 save was still in flight, and the one-shot lookup found only the 11:00 row (the
  // trace: 11:00 toast at 75.2 s, the 18:00 wait passed at 78.6 s, the save's POST never answered). So it must
  // be gone first: then the toast awaited below can only be the 18:00 one.
  await expect(addedToast11).toHaveCount(0, { timeout: UNDO_WINDOW_MS + 5_000 });
  await main.getByRole("button", { name: m["calendar.agenda.addJob"], exact: true }).click();
  sheet = page.getByRole("dialog");
  await sheet.getByLabel(m["calendar.job.date"]).fill(dayKeyPicked);
  await sheet.getByLabel(m["calendar.job.start"]).fill("18:00");
  await sheet.getByPlaceholder(m["calendar.job.search"]).fill(CONTACT_LAST);
  const hit18 = sheet.locator("[data-job-hit]").filter({ hasText: CONTACT_FULL_NAME });
  await expect(hit18).toBeVisible();
  await hit18.click();
  await sheet.getByLabel(m["calendar.job.what"]).fill(JOB_WHAT);
  await sheet.getByRole("button", { name: m["calendar.job.save"], exact: true }).click();

  const warnings = sheet.locator("[data-job-warnings]");
  await expect(warnings).toContainText(m["calendar.job.warn.outsideHours"]);
  const saveAnyway = sheet.getByRole("button", { name: m["calendar.job.saveAnyway"], exact: true });
  await expect(saveAnyway).toBeVisible();
  await saveAnyway.click();

  const addedToast18 = page.locator("[data-sonner-toast]").filter({ hasText: opening(m["calendar.job.added"]) });
  await expect(addedToast18).toBeVisible();
  bookingIdAt18 = await findOnDay("18:00");
  const row18 = main.locator(`#booking-${bookingIdAt18}`);
  await expect(row18).toBeVisible();
  await expect(row18).toContainText(m["calendar.agenda.outsideHours"]);

  // --- Step 6: the public page — the 11:00 slot is gone (R2), the 10:00 slot is back (the Undo's own -
  // positive control). The 18:00 job proves nothing here (the grid ends at close), so it is not asserted.
  await page.goto(`/b/${calendarPublicId}`);
  await waitForSlotsSettled(page);
  const weeksForward = Math.floor(pickedOffset / 7);
  for (let w = 0; w < weeksForward; w++) {
    await page.getByRole("button", { name: "Next week" }).click();
  }
  await page.getByRole("button", { name: publicDayLabel(dayKeyPicked) }).click();
  await waitForSlotsSettled(page);
  const label10 = await page.evaluate(
    (iso) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(iso)), at10Iso,
  );
  const label11 = await page.evaluate(
    (iso) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(iso)), at11Iso,
  );
  await expect(page.getByRole("button", { name: label11, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: label10, exact: true })).toBeVisible();

  // --- Step 7: back on the agenda — the 11:00 row opens the drawer by click; Esc returns focus to it --
  await page.goto(calendarUrl);
  const row11Again = page.getByRole("main").locator(`#booking-${bookingIdAt11}`);
  await row11Again.click();
  await expect(page).toHaveURL(new RegExp(`job=${bookingIdAt11}`));
  const drawer = page.getByRole("dialog");
  await expect(drawer).toContainText(CONTACT_FULL_NAME);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(row11Again).toBeFocused();

  // --- Step 8: `?job=<id>` with no `day` opens the drawer on the job's own day ------------------------
  await page.goto(`/dashboard/accounts/${accountId}/calendar?job=${bookingIdAt11}`);
  const drawer2 = page.getByRole("dialog");
  await expect(drawer2).toContainText(CONTACT_FULL_NAME);
  // The drawer is a modal: while it is open the page behind it is aria-hidden (Radix's hideOthers), and a role
  // query skips aria-hidden subtrees, so `main` is only found with includeHidden. The agenda IS there, on the
  // job's own day; this asserts the day it shows, not what a screen reader reaches past an open modal.
  await expect(page.getByRole("main", { includeHidden: true }).locator("[data-agenda-date]")).toHaveText(dayLabelText);
});
