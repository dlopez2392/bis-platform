import { test, expect } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, createContact, assignPhoneNumber, getOrCreateCalendar, createBooking, setBookingStatus,
} from "@bis/db";
import { m } from "../src/lib/messages";
import { readClientFixture, e2eAuthor, recordPage } from "./support";

// Same two paths, same reason, as every other spec that talks to Supabase from the Playwright runner
// process directly (seeding, cleanup), not through a Next request (work-queue.spec.ts, ai-acts.spec.ts).
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * F-077 part 1, plan Task 7: the two new To do rows a failed transfer's "Called back" (+ Undo) and a
 * booking act's "Accept" (+ Undo) — and the one thing the plan's review (correction C1) was written to
 * protect: Accept never touches the booking, so the record page's OWN Undo of that same act still works
 * after an Accept. No jsdom in this repo (plan Global Constraints), so this is the only place either
 * button's real effect (server action, revalidated row list, Sonner toast, the record's own popover) is
 * proven against a real browser and a real database.
 *
 * CANNOT RUN YET. Migration 0114 (`calls.transfer_failed_at`/`transfer_failed_reason`/
 * `transfer_followup_at`/`transfer_followup_by`; `ai_acts.accepted_at`/`accepted_by`) exists only in this
 * branch — it is not on `bis-ci` (lands only after F-115's own 0113 is on production, not before
 * 2026-11-11, per the plan's Global Constraints and Orchestrator checklist). A local run against bis-ci
 * fails before this spec's first assertion: every seed write below names a column bis-ci's `calls` and
 * `ai_acts` tables do not yet have. CI's `e2e` job is separately blocked by the same migration-history
 * check (`ci-migrations-applied.sh`) until the orchestrator pushes 0113 then 0114. This file is written
 * and typechecked now, per plan Task 7, and is not run until both land (see this file's own header and
 * the plan's Orchestrator checklist).
 *
 * FIXTURE DISCIPLINE. Every write lands on the per-run CLIENT fixture account (auth.setup.ts /
 * auth.teardown.ts) and NEVER on `Test Client One` (a real account with a real report recipient) or any
 * other live account — both new rows are read-only on `Test Client One` and mutating here. `calls` and
 * `ai_acts` are NOT in F-115's `record_changes` Q1 set (0111/0112 wire the trigger onto `contacts`,
 * `client_groups`, `client_group_members`, `places`, `equipment`, `opportunities`, `contact_relationships`
 * and `contact_tags` only — confirmed by reading both files' own `create trigger` statements; neither
 * names `calls`, `ai_acts` nor `bookings`), so the raw service-client writes below to those three tables
 * carry no `x-bis-author` header — the same thing `ai-acts.spec.ts`'s own `seedAct` helper and
 * `work-queue.spec.ts`'s own booking seed already do with no header. The one write that DOES need it is
 * the contact (`contacts` IS in Q1): `createContact` stamps its own author internally, and this file's one
 * raw `contacts` read needs none since a read carries no header at all.
 *
 * SESSION. No `test.use` override: the default chromium project session (`e2e/.auth/state.json`) is the
 * agency admin `auth.setup.ts` signs in as, who can reach any account's /tasks and /contacts/:id (the same
 * session `work-queue.spec.ts`'s "It happened" block and `ai-acts.spec.ts` decide through).
 *
 * SEED (service client, bypassing the UI for rows it cannot create): one phone number; one failed-transfer
 * call with NO contact and a withheld `caller_e164` (so `failedTransfers`' own "served since" re-check,
 * keyed on `caller_e164`, never has anything to match and can never clear this row from under the test —
 * work-queue.ts:231-236) and a real `callback_number`, `transfer_failed_at`/`transfer_failed_reason` set,
 * `transfer_followup_at` null; one contact with a real future booking, cancelled through the exact path
 * Sofía's own `cancel_appointment` tool takes (`setBookingStatus(..., "cancelled", ..., { onlyFrom:
 * "booked" })`, capturing `updatedAt`), with a `booking_cancelled` ai_acts row whose `before`/`after.version`
 * match that cancellation exactly — the same shape `bookingCancelledKind.stillSafe` (kinds/booking-
 * cancelled.ts) requires for the record's OWN Undo to read "available" rather than "blocked" or "changed".
 *
 * ORDER (serial; the seed is shared, so each test's start is the previous test's end).
 *   1. Both rows appear in Waiting, each with its one button.
 *   2. "Called back" → row gone, Undo toast → Undo → row back (queue's own round trip; proves the call
 *      itself, not merely the UI, moved transfer_followup_at and then cleared it).
 *   3. "Accept" → row gone, Undo toast → Undo → row back (the matching round trip for `accepted_at`).
 *   4. "Accept" again, left accepted this time → the record page's OWN Undo of the SAME act (never the
 *      queue's Accept/Undo) still reads "available" and still succeeds — the assertion plan review C1
 *      exists for: had the dropped "not both accepted and undone" CHECK shipped instead, this exact click
 *      would raise 23514 and the toast would read failure, not success.
 */
test.describe.configure({ mode: "serial", timeout: 90_000 });

const stamp = Date.now();
const ACTOR = "e2e-work-queue-actions";
const numberE164 = `+1556${String(stamp).slice(-7)}`;
const callbackNumber = `9565${String(stamp).slice(-6)}`;
const contactFirstName = "E2E";
const contactLastName = `WorkQueueActions ${stamp}`;
const contactName = `${contactFirstName} ${contactLastName}`;

let accountId = "";
let phoneNumberId = "";
let failedCallId = "";
let contactId = "";
let bookingId = "";
let bookingStartsAt = "";
let bookingEndsAt = "";
let actId = "";

const tasksUrl = () => `/dashboard/accounts/${accountId}/tasks`;
const contactUrl = () => `/dashboard/accounts/${accountId}/contacts/${contactId}`;

/** The Waiting bucket's own section (`data-bucket="waiting"`, work-list.tsx) scoped to <main> — the
 *  route has a loading.tsx (support.ts's RECORD_PAGE convention; the same streamed-duplicate reason
 *  work-queue.spec.ts's own `row` locator is scoped to <main> for), and a row found by the text unique
 *  to THIS run's seed, never positionally. */
function waitingRow(page: import("@playwright/test").Page, text: string) {
  return page.getByRole("main").locator('[data-bucket="waiting"] [data-work-row]').filter({ hasText: text });
}

/** The booking act's own row on the record page, by its id (`data-ai-act-id`) — never by its words, the
 *  same reason `ai-acts.spec.ts`'s own `rowOf` helper gives. */
function actRow(page: import("@playwright/test").Page) {
  return recordPage(page).locator(`[data-ai-act-row][data-ai-act-id="${actId}"]`);
}

test.beforeAll(async () => {
  const fixture = readClientFixture();
  if (!fixture) {
    test.skip(true, "No client fixture — the setup project creates it; run the full suite.");
    return;
  }
  accountId = fixture.accountId;
  const db = serviceDb();

  const number = await assignPhoneNumber(db, accountId, { e164: numberE164, status: "testing" }, ACTOR);
  phoneNumberId = number.id;

  // The failed-transfer row: a caller who asked for a person and reached nobody. `caller_e164` is
  // withheld (null) on purpose — the one case `failedTransfers`' own "served since" re-check can never
  // clear (work-queue.ts:233: "if (!c.caller_e164) return true;"), so this row cannot vanish out from
  // under the test no matter what else runs on this account concurrently. No contact: this is also the
  // one case the plan's own Correction 3 and spec §9 item 5 name (an unidentified caller) — proving the
  // row renders its BARE-NUMBER form, not that it requires a contact.
  const { data: failedCall, error: callErr } = await db.from("calls").insert({
    account_id: accountId, phone_number_id: phoneNumberId,
    caller_e164: null, callback_number: callbackNumber, outcome: "abandoned",
    transfer_failed_at: new Date().toISOString(), transfer_failed_reason: "no_answer",
  }).select("id").single();
  if (callErr || !failedCall) throw new Error(`work-queue-actions e2e: seeding the failed-transfer call failed: ${callErr?.message ?? "no row"}`);
  failedCallId = (failedCall as { id: string }).id;

  // The booking-act row: a real contact, a real future booking, cancelled through the EXACT path
  // Sofía's own cancel_appointment tool takes (registry.ts:904-920) — setBookingStatus with
  // onlyFrom: "booked", capturing the real updatedAt — so the seeded act's after.version is not a
  // guess but the literal value bookingCancelledKind.stillSafe (kinds/booking-cancelled.ts:22)
  // compares against (`sameInstant(b.updatedAt, act.after.version)`). Get this wrong and the record
  // page's own Undo reads "blocked: changed" instead of "available" — the exact failure mode this
  // spec's last test exists to rule out.
  const contact = await createContact(db, accountId, { firstName: contactFirstName, lastName: contactLastName }, ACTOR);
  if (contact.existing) throw new Error("work-queue-actions e2e: contact matched an existing contact; refusing to use it.");
  contactId = contact.id;

  const calendar = await getOrCreateCalendar(db, accountId, ACTOR);
  const starts = new Date(Date.now() + 10 * 86_400_000);
  const ends = new Date(starts.getTime() + 30 * 60_000);
  bookingStartsAt = starts.toISOString();
  bookingEndsAt = ends.toISOString();
  const booking = await createBooking(db, accountId, { calendarId: calendar.id, contactId, startsAt: starts, endsAt: ends }, "voice", "ai");
  bookingId = booking.id;

  const { updatedAt: cancelledAt } = await setBookingStatus(
    db, accountId, bookingId, "cancelled", "voice", "ai", { onlyFrom: "booked" },
  );

  // A real call row is required: ai_acts_source (0091) enforces (actor = 'voice') = (call_id is not
  // null), so an act with actor "voice" and no call_id is rejected before this spec ever opens a page.
  const { data: actCall, error: actCallErr } = await db.from("calls").insert({
    account_id: accountId, phone_number_id: phoneNumberId, contact_id: contactId,
    caller_e164: null, outcome: "booked",
  }).select("id").single();
  if (actCallErr || !actCall) throw new Error(`work-queue-actions e2e: seeding the act's call failed: ${actCallErr?.message ?? "no row"}`);

  const { data: act, error: actErr } = await db.from("ai_acts").insert({
    account_id: accountId, actor: "voice", call_id: (actCall as { id: string }).id, chat_id: null,
    contact_id: contactId, kind: "booking_cancelled", target: { bookingId },
    before: { startsAt: bookingStartsAt, endsAt: bookingEndsAt }, after: { version: cancelledAt },
  }).select("id").single();
  if (actErr || !act) throw new Error(`work-queue-actions e2e: seeding the booking_cancelled act failed: ${actErr?.message ?? "no row"}`);
  actId = (act as { id: string }).id;
});

test.afterAll(async () => {
  if (!accountId) return;
  const db = serviceDb();
  const step = async (what: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await run();
    if (error) console.error(`work-queue-actions e2e cleanup: ${what} failed: ${error.message}`);
  };

  if (actId) await step("ai_acts", () => db.from("ai_acts").delete().eq("account_id", accountId).eq("id", actId));
  if (bookingId) await step("bookings", () => db.from("bookings").delete().eq("account_id", accountId).eq("id", bookingId));
  if (contactId) {
    await step("calls (by contact)", () => db.from("calls").delete().eq("account_id", accountId).eq("contact_id", contactId));
  }
  if (failedCallId) await step("calls (failed transfer)", () => db.from("calls").delete().eq("account_id", accountId).eq("id", failedCallId));
  if (phoneNumberId) await step("phone_numbers", () => db.from("phone_numbers").delete().eq("account_id", accountId).eq("id", phoneNumberId));
  if (contactId) await step("contacts", () => e2eAuthor(db.from("contacts").delete()).eq("account_id", accountId).eq("id", contactId));
});

test("both new rows appear in Waiting, each with its one button", async ({ page }) => {
  await page.goto(tasksUrl());

  const transferRow = waitingRow(page, callbackNumber);
  await expect(transferRow).toBeVisible();
  // The assertion that fails if the predicate regresses to the pre-round-2 shape (handoff_requested_at
  // + outcome = 'abandoned'): a call still being handled, or one whose transfer actually succeeded,
  // would then also match. This row's own text proves the NUMBERED sentence, not the bare fallback —
  // callback_number was set, so m["work.failedTransfer.bare"] must never appear here.
  await expect(transferRow).toContainText(m["work.failedTransfer"].replace("{number}", callbackNumber));
  await expect(transferRow.getByRole("button", { name: m["work.failedTransfer.done"], exact: true })).toBeVisible();

  const actRowOnQueue = waitingRow(page, contactName);
  await expect(actRowOnQueue).toBeVisible();
  await expect(actRowOnQueue.getByRole("button", { name: m["work.act.accept"], exact: true })).toBeVisible();
  // Exactly one button per row (plan's own DESIGN.md citation, work-row-actions.tsx:10-21): neither
  // row ever grows a second action in this part (no "Not now" — owner ruling 4).
  expect(await actRowOnQueue.getByRole("button").count()).toBe(1);
});

test("Called back: the row leaves Waiting with an Undo toast, and Undo brings it back", async ({ page }) => {
  await page.goto(tasksUrl());
  const row = waitingRow(page, callbackNumber);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: m["work.failedTransfer.done"], exact: true }).click();

  // THE assertion that fails if completeFailedTransfer regresses to a no-op: the row is gone, not
  // merely re-labelled, because failedTransfers' own predicate (transfer_followup_at is null) no
  // longer matches this call.
  await expect(row).toHaveCount(0);
  // Copy table (plan): the failed-transfer row's Done toast reuses the generic work.done.toast, not a
  // bespoke string — asserting the GENERIC key here is itself the check that nobody quietly gave it
  // its own wording that would then diverge from every other Done action's toast.
  const toast = page.getByText(m["work.done.toast"]);
  await expect(toast).toBeVisible();

  await page.getByRole("button", { name: m["common.undo"], exact: true }).click();
  // THE assertion for the Undo half: clearTransferFollowup's own compare-and-swap actually cleared the
  // exact instant written, so the row is governed by its real column state again, not a client-only
  // re-add. A stale or mismatched Undo would leave transfer_followup_at set and this row absent.
  await expect(waitingRow(page, callbackNumber)).toBeVisible();

  const db = serviceDb();
  const { data, error } = await db.from("calls")
    .select("transfer_followup_at, transfer_followup_by").eq("account_id", accountId).eq("id", failedCallId).single();
  if (error) throw new Error(`work-queue-actions e2e: re-reading the failed-transfer call failed: ${error.message}`);
  expect((data as { transfer_followup_at: string | null }).transfer_followup_at).toBeNull();
  expect((data as { transfer_followup_by: string | null }).transfer_followup_by).toBeNull();
});

test("Accept: the row leaves Waiting with an Undo toast, and Undo brings it back", async ({ page }) => {
  await page.goto(tasksUrl());
  const row = waitingRow(page, contactName);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: m["work.act.accept"], exact: true }).click();

  // THE assertion that fails if acceptBookingAct regresses to a no-op: listPendingBookingActs' own
  // predicate (accepted_at is null) no longer matches this act, so the row is gone, not re-labelled.
  await expect(row).toHaveCount(0);
  const toast = page.getByText(m["work.act.accept.toast"]);
  await expect(toast).toBeVisible();

  await page.getByRole("button", { name: m["common.undo"], exact: true }).click();
  await expect(waitingRow(page, contactName)).toBeVisible();

  const db = serviceDb();
  const { data, error } = await db.from("ai_acts")
    .select("accepted_at, accepted_by, undone_at").eq("account_id", accountId).eq("id", actId).single();
  if (error) throw new Error(`work-queue-actions e2e: re-reading the booking act failed: ${error.message}`);
  const row2 = data as { accepted_at: string | null; accepted_by: string | null; undone_at: string | null };
  expect(row2.accepted_at).toBeNull();
  expect(row2.accepted_by).toBeNull();
  // Accept's own Undo never touches the booking's real Undo: undone_at is untouched by either click
  // above, still null — the row came back because the QUEUE'S predicate matched again, not because
  // the act itself was ever "undone".
  expect(row2.undone_at).toBeNull();
});

test("Accept again, left accepted — the record's OWN Undo of the same act still works (plan review C1)", async ({ page }) => {
  await page.goto(tasksUrl());
  const row = waitingRow(page, contactName);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: m["work.act.accept"], exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByText(m["work.act.accept.toast"])).toBeVisible();

  // Confirmed accepted, and NOT undone, before touching the record page at all — the starting state
  // the rest of this test depends on.
  const db = serviceDb();
  {
    const { data, error } = await db.from("ai_acts")
      .select("accepted_at, undone_at").eq("account_id", accountId).eq("id", actId).single();
    if (error) throw new Error(`work-queue-actions e2e: re-reading the booking act failed: ${error.message}`);
    const r = data as { accepted_at: string | null; undone_at: string | null };
    expect(r.accepted_at).not.toBeNull();
    expect(r.undone_at).toBeNull();
  }

  await page.goto(contactUrl());
  const recordRow = actRow(page);
  // THE assertion plan review C1 exists for: an accepted act still reads "available" on the record,
  // never "blocked" — had the dropped ai_acts_not_both_accepted_and_undone CHECK shipped, nothing
  // would differ here (it is undone_at, not accepted_at, that CHECK would have gated), but
  // stampAiActAccepted's own refusal of an already-undone act (the inverse direction) is proven by
  // this same state never regressing to "undone" after Accept.
  await expect(recordRow).toHaveAttribute("data-ai-act-state", "available");
  const undoButton = recordRow.locator('[data-ai-act-undo="booking"]');
  await expect(undoButton).toBeVisible();
  await undoButton.click();

  const popover = page.locator("[data-ai-act-booking-popover]");
  await expect(popover).toBeVisible();
  // THE assertion that would fail if the dropped CHECK (or any other new constraint) blocked an
  // accepted act's own Undo: undo_ai_booking_act's real update (undone_at/undone_by only, never
  // touching accepted_at) would raise 23514 instead of succeeding, and runBookingUndo's own `refuse`
  // path would show a failure toast here instead of success.
  await popover.getByRole("button", { name: m["common.undo"], exact: true }).click();
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: m["aiActs.toast.bookingUndone"] });
  await expect(toast).toBeVisible();
  await expect(popover).toBeHidden();

  const { data: booking, error: bErr } = await db.from("bookings").select("status").eq("account_id", accountId).eq("id", bookingId).single();
  if (bErr) throw new Error(`work-queue-actions e2e: re-reading the booking failed: ${bErr.message}`);
  // booking_cancelled's own Undo rebooks it (kinds/booking-cancelled.ts's own doc comment: "Undo books
  // it again"), so the DB-level proof that the record's Undo actually ran, not merely that a toast
  // appeared, is the booking's own status moving off "cancelled".
  expect((booking as { status: string }).status).toBe("booked");

  const { data: act2, error: aErr } = await db.from("ai_acts")
    .select("undone_at, undone_by, accepted_at").eq("account_id", accountId).eq("id", actId).single();
  if (aErr) throw new Error(`work-queue-actions e2e: re-reading the booking act failed: ${aErr.message}`);
  const a = act2 as { undone_at: string | null; undone_by: string | null; accepted_at: string | null };
  expect(a.undone_at).not.toBeNull();
  expect(a.undone_by).not.toBeNull();
  // Accept's own stamp is UNTOUCHED by the record's Undo — the two are independent columns, exactly as
  // the spec's §9 item 2 and the migration's own comment require: undo_ai_booking_act's final write
  // never clears accepted_at.
  expect(a.accepted_at).not.toBeNull();
});

// MUTATION PROBE (plan Task 7, to run later, not part of this file's own assertions): in a scratch
// copy of packages/db/src/work-queue.ts, drop `failedTransfers(db, accountId, opts.assignee)` and
// `listPendingBookingActs(db, accountId, opts.assignee)` from listAccountWork's own Promise.all fan-out
// (leaving only tasks/convos/bookings). Re-run this file's first test: it FAILS BY NAME — both
// `waitingRow(page, callbackNumber)` and `waitingRow(page, contactName)` time out with zero matches,
// because the two rows this whole file exists to prove never render in the first place. Revert before
// committing anything else.
