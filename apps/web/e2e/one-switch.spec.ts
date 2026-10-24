import { test, expect, type Page } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, ensureBusinessStatusRow, getBusinessStatusRow, listClosedDaysFrom, deleteClosedDay,
  readAccountTimezone, getOrCreateCalendar, getCalendarForAccount, updateCalendarSettings,
} from "@bis/db";
import { m } from "../src/lib/messages";
import { effectiveStatus, dayKey, addDays, type EffectiveStatus } from "../src/lib/business-status/status";
import { formatClosedDayRange } from "../src/lib/business-status/range-format";

// Same two paths, same reason, as every other spec that talks to Supabase from the Playwright runner
// process directly (seeding, cleanup), not through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

// Mirrors playwright.config.ts's own `use.baseURL` fallback: `browser.newContext()` built by hand in
// `afterAll` (a worker-scoped hook — the `baseURL` fixture is test-scoped and unavailable there) needs
// the same base a test's own `page` already carries, or a relative `goto()` inside it has nothing to
// resolve against.
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * S-47d, plan Task 15 (spec §7 e2e): the one switch, end to end — an Owner closes for the day from the
 * topbar and undoes it inside the Undo window, and a closed day planned on the Calendar page actually
 * closes the public booking page for that one date, then comes off again through the same card.
 *
 * FIXTURE DISCIPLINE. Both tests run on the per-run client fixture (auth.setup.ts / auth.teardown.ts),
 * signed in as its own Owner (client-state.json, A8) — never on `Test Client One` or any other live
 * account: test 1 writes `business_status`, test 2 writes `closed_days`, and the booking-page check
 * needs a calendar that actually takes bookings. `readFixture()` skips the whole file with a reason when
 * the fixture is missing, the same local shape `ai-disclosure.spec.ts` and `structured-facts.spec.ts` use.
 *
 * PRECONDITION. `beforeAll` makes sure the row exists (`ensureBusinessStatusRow` — service_role may
 * INSERT it but never UPDATE it, 0097's own grants) and reads the fixture's EFFECTIVE status through the
 * same reader the dashboard card uses (`effectiveStatus`). A fixture left mid-closure by an earlier
 * failed run STOPS this file with a reason rather than compounding on a dirty start.
 *
 * DEVIATION FROM THE BRIEF (flagged in the t15 report, not silently applied): `booking.spec.ts`'s own
 * cleanup leaves the fixture calendar disabled with empty hours on purpose (its own "inert resting
 * state" — that file runs earlier in this suite's file order) and the public booking route 404s
 * outright on a disabled calendar (`isCalendarLive`), so test 2's booking-page step cannot run against
 * whatever the calendar happens to hold when this file starts. `beforeAll` therefore seeds
 * Monday-Friday 09:00-17:00 and `enabled: true` itself, through `updateCalendarSettings` — the same real
 * writer `booking.spec.ts` and `calendar-meeting-settings.spec.ts` already use for exactly this reason —
 * and `afterAll` restores whatever it found before touching anything. Seeding real hours, not merely
 * enabling the calendar, is what keeps test 2 honest: `emptyDayTitle` picks its "closed" title from
 * `closedDayKeys` alone, so a day chosen only because it had NO hours to begin with would read "Closed
 * this day." whether or not the closed-day override did anything at all — the vacuous-test shape this
 * project's memory names.
 *
 * ORDER (serial; the seed and the picked day are shared). Test 1 is fully self-contained — closes,
 * reads both surfaces, undoes, reads again — and leaves the switch open behind it. Test 2 then plans one
 * closed day 7–13 days out, confirms the booking page, and removes it again through the same card's own
 * Remove action.
 *
 * RESTORE. `afterAll` always runs. If the switch is not open, it is reopened THROUGH THE MENU — there is
 * no direct-write fallback: service_role holds no UPDATE on `business_status` — polled until it reads
 * open. Any closed day this file added is removed through the Calendar page's own Remove button; if that
 * is unusable, `deleteClosedDay` (service_role holds DELETE on `closed_days`) is the fallback. The
 * calendar's own prior `enabled`/`open_hours` are restored last, through `updateCalendarSettings`.
 * Problems are collected and thrown together at the end (`ai-disclosure.spec.ts:146-202`'s shape).
 */
test.describe.configure({ mode: "serial", timeout: 60_000 });
test.use({ storageState: "e2e/.auth/client-state.json" });

type ClientFixture = { accountId: string; clerkUserId: string };
const CLIENT_FIXTURE_FILE = "e2e/.auth/client-fixture.json";

function readFixture(): ClientFixture | null {
  if (!existsSync(CLIENT_FIXTURE_FILE)) return null;
  const parsed = JSON.parse(readFileSync(CLIENT_FIXTURE_FILE, "utf-8")) as Partial<ClientFixture>;
  if (!parsed.accountId || !parsed.clerkUserId) return null;
  return parsed as ClientFixture;
}

const ACTOR = "e2e-one-switch-spec";
const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** The booking page's own day-chip label (`SlotPicker`'s `dayLabel`), minus the "(Today)" suffix no day
 *  7+ days out ever carries: fixed `en-US`/UTC, same `${key}T12:00:00Z` construction, so a date key
 *  never crosses a calendar day under this process's own clock. */
function publicDayLabel(dayKeyStr: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${dayKeyStr}T12:00:00Z`));
}

/** `dayKey`/`addDays` are calendar-day arithmetic only (no zone lookup); the day of week for such a key
 *  is plain UTC-midnight math — the same technique `range-format.ts`'s own `weekdayOf` uses. */
function weekdayKeyOf(dayKeyStr: string): (typeof DOW)[number] {
  const [y, mo, d] = dayKeyStr.split("-").map(Number) as [number, number, number];
  return DOW[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]!;
}

/** The booking page's own loading state (`.bis-booking-skeletons`) — waiting for it to leave the DOM,
 *  never a fixed delay, the same reason `booking.spec.ts`'s identical helper gives. */
async function waitForSlotsSettled(page: Page): Promise<void> {
  await expect(page.locator(".bis-booking-skeletons")).toHaveCount(0, { timeout: 15_000 });
}

let fixtureRef: ClientFixture | null = null;
let accountId = "";
let timezone = "America/Chicago";
let skipReason: string | null = null;

let calendarPublicId = "";
let calendarSeeded = false;
let priorCalendarEnabled = false;
let priorOpenHours: Record<string, [string, string][]> = {};

let closedFromKey = "";
let addedClosedDayId: string | null = null;

/** The same reader `BusinessStatusCard` and `data.ts`'s `loadClosureView` use, read fresh every call —
 *  never cached across a poll. `hours: null` is safe here: `effectiveStatus`'s OPEN-vs-closed branch
 *  (`active()`) never consults `hours`, only `row`, `closedDays`, `timezone` and `now` — hours only
 *  shapes the REOPENING wording inside an already-closed branch. */
async function readEffectiveState(): Promise<EffectiveStatus["state"]> {
  const db = serviceDb();
  const row = await getBusinessStatusRow(db, accountId);
  const closedDays = await listClosedDaysFrom(db, accountId, dayKey(new Date(), timezone));
  return effectiveStatus({ row, closedDays, hours: null, timezone, now: new Date() }).state;
}

test.beforeAll(async () => {
  const fixture = readFixture();
  if (!fixture) {
    skipReason = "No client fixture — the setup project creates it; run the full suite.";
    test.skip(true, skipReason);
    return;
  }
  fixtureRef = fixture;
  accountId = fixture.accountId;
  const db = serviceDb();

  await ensureBusinessStatusRow(db, accountId);
  timezone = (await readAccountTimezone(db, accountId)) ?? "America/Chicago";

  const state = await readEffectiveState();
  if (state !== "open") {
    skipReason = `one-switch e2e: the fixture's business status reads "${state}", not open, before this `
      + "file touched anything — refusing to run on a dirty fixture.";
    test.skip(true, skipReason);
    return;
  }

  // Deviation from the brief (see this file's own doc comment, and the t15 report): seed a live
  // calendar with real weekday hours so test 2's booking-page check is meaningful and so /b/<publicId>
  // does not 404 outright on the disabled calendar `booking.spec.ts` leaves behind.
  const calendar = await getOrCreateCalendar(db, accountId, ACTOR);
  calendarPublicId = calendar.public_id;
  priorCalendarEnabled = calendar.enabled;
  priorOpenHours = calendar.open_hours;
  await updateCalendarSettings(db, accountId, {
    enabled: true,
    openHours: {
      mon: [["09:00", "17:00"]], tue: [["09:00", "17:00"]], wed: [["09:00", "17:00"]],
      thu: [["09:00", "17:00"]], fri: [["09:00", "17:00"]],
    },
  }, ACTOR);
  calendarSeeded = true;

  // S-47d spec §7 e2e: a weekday 7-13 days ahead on which the (now-seeded) calendar has hours — read
  // back fresh rather than trusting the patch just sent, same discipline every mutation test in this
  // project re-reads its own write.
  const refreshed = await getCalendarForAccount(db, accountId);
  const hours = refreshed?.open_hours ?? {};
  const today = dayKey(new Date(), timezone);
  let picked: string | null = null;
  for (let offset = 7; offset <= 13; offset++) {
    const candidate = addDays(today, offset);
    const dow = weekdayKeyOf(candidate);
    if (dow === "sat" || dow === "sun") continue;
    if ((hours[dow] ?? []).length > 0) {
      picked = candidate;
      break;
    }
  }
  if (!picked) {
    skipReason = "one-switch e2e: no weekday 7-13 days ahead has open hours on the fixture calendar — "
      + "cannot test the booking page's closed-day title.";
    test.skip(true, skipReason);
    return;
  }
  closedFromKey = picked;
});

test.afterAll(async ({ browser }) => {
  if (!fixtureRef) return;
  const db = serviceDb();
  const problems: string[] = [];
  const fail = (line: string) => {
    console.error(line);
    problems.push(line);
  };

  // The switch: restored to open THROUGH THE MENU when a failed test left it otherwise — service_role
  // holds no UPDATE on `business_status` (0097's own grants), so there is no direct-write fallback.
  try {
    if ((await readEffectiveState()) !== "open") {
      const context = await browser.newContext({ storageState: "e2e/.auth/client-state.json", baseURL: BASE_URL });
      try {
        const page = await context.newPage();
        await page.goto(`/dashboard/accounts/${accountId}/dashboard`);
        await page.locator("header").getByRole("button", { name: m["business.menu.trigger"] }).click();
        await page.getByRole("menuitemradio", { name: m["business.menu.open"] }).click();
        await expect.poll(readEffectiveState, { timeout: 10_000 }).toBe("open");
      } finally {
        await context.close();
      }
    }
  } catch (e) {
    fail(`one-switch e2e cleanup: restoring the switch to open through the UI failed: ${String(e)}`);
  }

  // The closed day this file added, if either test left it behind — through the Calendar page's own
  // Remove button first, `deleteClosedDay` (service_role holds DELETE on `closed_days`) only as the
  // fallback when the UI itself is unusable.
  if (addedClosedDayId) {
    const idToRemove = addedClosedDayId;
    let removedThroughUi = false;
    try {
      const context = await browser.newContext({ storageState: "e2e/.auth/client-state.json", baseURL: BASE_URL });
      try {
        const page = await context.newPage();
        await page.goto(`/dashboard/accounts/${accountId}/calendar`);
        const rangeLabel = formatClosedDayRange(closedFromKey, closedFromKey, "en");
        const row = page.locator("#closed-days li").filter({ hasText: rangeLabel });
        await row.getByRole("button", { name: m["closedDays.remove"] }).click({ timeout: 10_000 });
        await expect.poll(async () => {
          const rows = await listClosedDaysFrom(db, accountId, closedFromKey);
          return rows.some((r) => r.id === idToRemove);
        }, { timeout: 10_000 }).toBe(false);
        removedThroughUi = true;
      } finally {
        await context.close();
      }
    } catch (e) {
      fail(`one-switch e2e cleanup: removing the closed day through the UI failed: ${String(e)}`);
    }
    if (!removedThroughUi) {
      try {
        const removed = await deleteClosedDay(db, accountId, idToRemove);
        if (!removed) fail(`one-switch e2e cleanup: deleteClosedDay found no row for id ${idToRemove}`);
      } catch (e) {
        fail(`one-switch e2e cleanup: deleteClosedDay fallback threw: ${String(e)}`);
      }
    }
    const remaining = await listClosedDaysFrom(db, accountId, closedFromKey);
    if (remaining.some((r) => r.id === idToRemove)) {
      fail(`one-switch e2e cleanup: closed day ${idToRemove} still exists after cleanup`);
    }
  }

  // The calendar: restored to whatever this file found it as, through the real writer
  // (`updateCalendarSettings`, service_role — `booking.spec.ts`'s own `resetCalendar()` does the same).
  if (calendarSeeded) {
    try {
      await updateCalendarSettings(db, accountId, { enabled: priorCalendarEnabled, openHours: priorOpenHours }, ACTOR);
    } catch (e) {
      fail(`one-switch e2e cleanup: restoring the calendar failed: ${String(e)}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`one-switch e2e cleanup left the fixture dirty:\n${problems.join("\n")}`);
  }
});

test("an Owner closes for the day from the topbar, and Undo reopens it", async ({ page }) => {
  test.skip(skipReason !== null, skipReason ?? "");

  await page.goto(`/dashboard/accounts/${accountId}/dashboard`);
  const topbar = page.locator("header");

  await topbar.getByRole("button", { name: m["business.menu.trigger"] }).click();
  await page.getByRole("menuitemradio", { name: m["business.menu.closedToday"] }).click();

  const closedToast = page.locator("[data-sonner-toast]").filter({ hasText: m["business.toast.closedToday"] });
  await expect(closedToast).toBeVisible();
  await expect(topbar.getByTestId("topbar-presence")).toContainText(m["business.state.closedToday"]);
  await expect(page.locator("#business-status")).toContainText(m["business.state.closedToday"]);

  // Within the 10s Undo window (UNDO_WINDOW_MS) — a Playwright click lands in well under one second.
  await closedToast.getByRole("button", { name: m["common.undo"] }).click();

  await expect(page.locator("[data-sonner-toast]").filter({ hasText: m["business.toast.undone"] })).toBeVisible();
  await expect(topbar.getByTestId("topbar-presence")).toContainText(m["business.topbar.open"]);
  await expect(page.locator("#business-status")).toContainText(m["business.card.openToday"]);

  await expect.poll(readEffectiveState, { timeout: 10_000 }).toBe("open");
});

// Fix round D4: "Back on a date…" lets the menu close and opens the dialog after it, so the two modal
// layers never stack. Esc must hand focus back to the topbar trigger and must not leave `pointer-events:
// none` on <body> (the stacked-modal failure: every click on the page then silently does nothing). Writes
// nothing: the dialog is dismissed before its one primary button is pressed.
test("the storm date dialog opens after the menu closes, and Esc returns focus to the trigger with the page still clickable", async ({ page }) => {
  test.skip(skipReason !== null, skipReason ?? "");

  await page.goto(`/dashboard/accounts/${accountId}/dashboard`);
  const trigger = page.locator("header").getByRole("button", { name: m["business.menu.trigger"] });
  await trigger.click();
  // By keyboard, the menu's own arrow-key path (spec 5.6.1: "arrow keys move"): a pointer jump from the
  // Storm row to its sub-menu leaves Radix's pointer grace area, so the sub-menu closes under a click.
  await page.getByRole("menuitem", { name: m["business.menu.storm"] }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menuitemradio", { name: m["business.menu.stormOpenEnded"] })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitemradio", { name: m["business.menu.stormBackOn"] })).toBeFocused();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: m["business.storm.title"] });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(m["business.storm.description"]);
  await expect(page.getByRole("menu")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).pointerEvents)).not.toBe("none");
  // The page is really clickable again: the same trigger opens its menu on a plain click.
  await trigger.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(readEffectiveState, { timeout: 5_000 }).toBe("open");
});

test("a closed day planned on the Calendar page closes the public booking page for that one date", async ({ page }) => {
  test.skip(skipReason !== null, skipReason ?? "");

  await page.goto(`/dashboard/accounts/${accountId}/calendar`);
  const card = page.locator("#closed-days");

  await card.getByLabel(m["closedDays.from"]).fill(closedFromKey);
  await card.getByRole("combobox", { name: m["closedDays.reason"] }).click();
  await page.getByRole("option", { name: m["business.reason.holiday"] }).click();
  await card.getByRole("button", { name: m["closedDays.add"] }).click();

  await expect(page.locator("[data-sonner-toast]").filter({ hasText: m["closedDays.added"] })).toBeVisible();

  await expect.poll(async () => {
    const rows = await listClosedDaysFrom(serviceDb(), accountId, closedFromKey);
    return rows.filter((r) => r.starts_on === closedFromKey && r.ends_on === closedFromKey).length;
  }, { timeout: 10_000 }).toBe(1);

  const added = (await listClosedDaysFrom(serviceDb(), accountId, closedFromKey))
    .find((r) => r.starts_on === closedFromKey && r.ends_on === closedFromKey);
  if (!added) throw new Error("one-switch e2e: the closed day vanished right after the poll confirmed it");
  addedClosedDayId = added.id;

  await page.goto(`/b/${calendarPublicId}`);
  await waitForSlotsSettled(page);
  await page.getByRole("button", { name: "Next week" }).click();
  await waitForSlotsSettled(page);
  await page.getByRole("button", { name: publicDayLabel(closedFromKey) }).click();
  await waitForSlotsSettled(page);
  await expect(page.locator(".bis-booking-empty-title")).toHaveText("Closed this day.");

  await page.goto(`/dashboard/accounts/${accountId}/calendar`);
  const rangeLabel = formatClosedDayRange(closedFromKey, closedFromKey, "en");
  const row = card.locator("li").filter({ hasText: rangeLabel });
  await row.getByRole("button", { name: m["closedDays.remove"] }).click();

  await expect(page.locator("[data-sonner-toast]").filter({ hasText: m["closedDays.removed"] })).toBeVisible();

  await expect.poll(async () => {
    const rows = await listClosedDaysFrom(serviceDb(), accountId, closedFromKey);
    return rows.length;
  }, { timeout: 10_000 }).toBe(0);
  addedClosedDayId = null;
});
