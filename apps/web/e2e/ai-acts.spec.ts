import { test, expect } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, createContact, assignPhoneNumber, startCallRow, finishCallRow,
  getOrCreateCalendar, createBooking, setBookingStatus, ensureConversation, createMessage,
  recordAutomationLog, ensureCallbackTask,
  type SupabaseClient,
} from "@bis/db";
import type { NewAiAct } from "@bis/db/ai-act-rules";
import { m, type MessageKey } from "../src/lib/messages";
import { readClientFixture, recordPage } from "./support";
import { clipFailure } from "./overflow-check";

// Same two paths, same reason, as every other spec that talks to Supabase from the Playwright runner
// process directly (seeding, cleanup), not through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * Item 8c (plan Task 7): the e2e proof that one of Sofía's live acts reads on the record's timeline and
 * that its Undo does exactly what the act-kind registry promises — a booking undone without a false claim
 * of telling the customer, a filled field put back then restored from the toast, an overtaken act's own
 * reason with no control to press, and an untouched customer removed through the typed-name dialog, the
 * call left in Calls unlinked. No jsdom in this repo (plan Global Constraints), so this is the only place
 * the Undo controls' real effect (the popover, the dialog, the toasts, the Spanish reader, 360 px) is
 * proven against a real browser and a real database.
 *
 * FIXTURE DISCIPLINE. Every write lands on the per-run CLIENT fixture account (auth.setup.ts /
 * auth.teardown.ts), never on `Test Client One` or any other live account. `readClientFixture()` skips
 * the whole file with a clear reason when the fixture is missing.
 *
 * SESSION. No `test.use` override: the default chromium project session (agency_admin) is the Owner for
 * any account (`requireAccountAccess`'s `isAgency` satisfies `requireAccountOwner`'s `canManage`), so the
 * contact removal's Owner-only gate is satisfied without a second login — the same session the
 * suggestions, bulk-action-bar and documents specs decide through.
 *
 * SEED (service client, bypassing `insertAiActs` to recover each row's id with one `.select("id")`, the
 * exact shape its own `toRow` writes): a phone number and two calls (K on contact C, K2 on contact D).
 * On C: a future booked booking B1 with a `booking_created` act; a filled-email act (C's own `email`
 * column equals the act's `after.value`, written directly rather than through `fillContactBlanksReport`,
 * which is Task 3's own path); a second booking B2, booked then immediately cancelled by a plain
 * `setBookingStatus` (standing in for "something else cancelled it since"), with its own, now-overtaken
 * `booking_created` act. On D: nothing but call K2's own AI-authored summary message (the same
 * `ensureConversation`/`createMessage` pair `finishCall` itself writes, actor "voice"/"ai"), the two other
 * rows `finishCall` writes for a real call (final review I-1): its `automation_log` row (source "voice",
 * subject "call:<K2>", `finish-call.ts` ~:699) and its open callback To-do on K2 (`ensureCallbackTask`,
 * ~:808), and a `contact_created` act — `ai_contact_held_by`'s clean case once 0092 counts her own call's
 * log row as hers, so D's removal is still safe.
 *
 * ORDER (serial; the seed is shared, so each test's start is the previous test's end). The six behaviours
 * the plan names are covered, but NOT in the plan's own listed order: test 1 here opens B1's still-
 * available booking popover to measure 360 px/pseudo overflow, because once the real Booking Undo test
 * consumes B1, no booking act on this page is ever "available" again (B2 is permanently blocked, there is
 * no third booking in this seed) and no popover would be left to measure. The field act's own button
 * reappears after its toast's Undo redoes it (ambiguity F), so the Spanish reader's "Deshacer" is proven
 * on it near the end, after it has already been undone and redone once — proving it is "available" again,
 * not merely never touched.
 *   1. 360 px, pseudo-locale: open B1's popover, measure it, the rows and the overtaken (blocked) row; then
 *      open D's typed-name dialog, measure it, and close it untouched.
 *   2. Booking undo, "Let them know" unticked: consumes B1.
 *   3. Field undo, then its toast's own Undo (the redo): consumes then restores the field act.
 *   4. Overtaken: B2, untouched by anything above.
 *   5. Spanish reader: the field act's restored button ("Deshacer"), B2's reason ("Ya se canceló").
 *   6. Contact removal: D, through the typed-name dialog.
 *
 * EXACT NAMES. Every role-name locator passes `exact: true` (suggestions.spec.ts's own reason: "Undo"
 * is a substring of nothing else here, but the booking popover's own trigger and the toast's action share
 * the same word, and a loose match would catch whichever rendered first).
 *
 * MAIN, EXCEPT PORTALS. The contact record route has a loading.tsx (support.ts's RECORD_PAGE
 * convention), so every row read goes through `recordPage(page)`. The popover and the dialog are
 * portals — rendered outside <main> by design (suggestions.spec.ts's own note) — so they, and every
 * toast, stay page-wide.
 */
test.describe.configure({ mode: "serial", timeout: 90_000 });

const stamp = Date.now();
const ACTOR = "e2e-ai-acts-spec";
const numberE164 = `+1557${String(stamp).slice(-7)}`;
const callerE164C = `+1558${String(stamp).slice(-7)}`;
const callerE164D = `+1559${String(stamp).slice(-7)}`;
const cFirstName = "E2E";
const cLastName = `AiActs C ${stamp}`;
const dFirstName = "E2E";
const dLastName = `AiActs D ${stamp}`;
const contactNameC = `${cFirstName} ${cLastName}`;
const contactNameD = `${dFirstName} ${dLastName}`;
const emailC = `e2e-ai-acts-${stamp}@example.com`;

/** `m`'s own `.es` twin, with `{param}` substitution — the same tiny helper suggestions.spec.ts uses. */
function w(key: MessageKey, lang: "en" | "es" = "en", params: Record<string, string | number> = {}): string {
  const raw = (lang === "es" ? (m as Record<string, string>)[`${key}.es`] : undefined) ?? m[key];
  return Object.entries(params).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), raw);
}

let accountId = "";
let phoneNumberId = "";
let contactCId = "";
let contactDId = "";
let callId = "";
let call2Id = "";
let conversationDId = "";
let booking1Id = "";
let booking2Id = "";
let booking1StartsAt = "";
let booking1EndsAt = "";
// Each seeded act's id: a row is found by `data-ai-act-id`, never by its words (CI found the pseudo-locale
// test waiting forever on an English "Already cancelled" filter).
let actB1Id = "";
let actB2Id = "";
let actDId = "";

const contactUrl = (id: string) => `/dashboard/accounts/${accountId}/contacts/${id}`;

/** Writes one row exactly as `insertAiActs`'s own `toRow` would, but with `.select("id")` so the seed can
 *  address each act by id afterwards — `insertAiActs` itself answers void (Task 3: one multi-row insert,
 *  no ids back, because its one caller, `recordAct`, never needs them). */
async function seedAct(db: SupabaseClient, act: NewAiAct): Promise<string> {
  const { data, error } = await db.from("ai_acts").insert({
    account_id: accountId, actor: act.actor, call_id: act.callId, chat_id: act.chatId, contact_id: act.contactId,
    kind: act.kind, target: act.target, before: act.before, after: act.after,
  }).select("id").single();
  if (error || !data) throw new Error(`ai-acts e2e: seedAct(${act.kind}) failed: ${error?.message ?? "no row"}`);
  return (data as { id: string }).id;
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

  const contactC = await createContact(db, accountId, { firstName: cFirstName, lastName: cLastName }, "voice", "ai");
  if (contactC.existing) throw new Error("ai-acts e2e: contact C matched an existing contact; refusing to use it.");
  contactCId = contactC.id;
  const contactD = await createContact(db, accountId, { firstName: dFirstName, lastName: dLastName }, "voice", "ai");
  if (contactD.existing) throw new Error("ai-acts e2e: contact D matched an existing contact; refusing to use it.");
  contactDId = contactD.id;

  const started = await startCallRow(db, accountId, { phoneNumberId, callerE164: callerE164C });
  callId = started.id;
  await finishCallRow(db, accountId, callId, {
    outcome: "booked", endedAt: new Date(), durationSecs: 90, turnCount: 2,
    transcript: [], summary: `Recorded: booked a time. Ref ${stamp}`, language: "en", contactId: contactCId,
  });

  const started2 = await startCallRow(db, accountId, { phoneNumberId, callerE164: callerE164D });
  call2Id = started2.id;
  // The same lead-treatment pair `finishCall` itself writes (`finish-call.ts`): a conversation, then her
  // own AI-authored summary message — the one message `ai_contact_held_by` counts as hers.
  const conversationD = await ensureConversation(db, accountId, contactDId, "voice", "ai");
  conversationDId = conversationD.id;
  await createMessage(db, accountId, {
    conversationId: conversationDId, channel: "voice", direction: "inbound",
    subject: "Phone call", body: `Recorded: a new caller introduced themselves. Ref ${stamp}`,
  }, "voice", "ai");
  const call2EndedAt = new Date();
  await finishCallRow(db, accountId, call2Id, {
    outcome: "lead", endedAt: call2EndedAt, durationSecs: 60, turnCount: 2,
    transcript: [], summary: `Recorded: a new caller introduced themselves. Ref ${stamp}`, language: "en",
    contactId: contactDId, conversationId: conversationDId,
  });
  // What `finishCall` also writes for every answered call (final review I-1): its own automation log row,
  // sent, as source "voice" on subject "call:<id>" ...
  await recordAutomationLog(db, {
    accountId, source: "voice", channel: "ai", contactId: contactDId,
    subjectKey: `call:${call2Id}`, status: "sent", reason: "",
  });
  // ... and, for a lead who wants a callback, the open callback To-do on that call, as Sofía ("voice"/"ai").
  await ensureCallbackTask(db, accountId, {
    callId: call2Id, contactId: contactDId, title: `Call back ${callerE164D}`, dueAt: call2EndedAt.toISOString(),
  }, "voice", "ai");

  const calendar = await getOrCreateCalendar(db, accountId, ACTOR);
  const start1 = new Date(Date.now() + 10 * 86_400_000);
  const end1 = new Date(start1.getTime() + 30 * 60_000);
  booking1StartsAt = start1.toISOString();
  booking1EndsAt = end1.toISOString();
  const b1 = await createBooking(db, accountId, { calendarId: calendar.id, contactId: contactCId, startsAt: start1, endsAt: end1 }, "voice", "ai");
  booking1Id = b1.id;

  const start2 = new Date(Date.now() + 17 * 86_400_000);
  const end2 = new Date(start2.getTime() + 30 * 60_000);
  const b2 = await createBooking(db, accountId, { calendarId: calendar.id, contactId: contactCId, startsAt: start2, endsAt: end2 }, "voice", "ai");
  booking2Id = b2.id;
  // Overtaken since the moment it is seeded: cancelled by a plain status change, not through Sofía's own
  // Undo — standing in for "a person (or the customer) cancelled it some other way since".
  await setBookingStatus(db, accountId, booking2Id, "cancelled", ACTOR, "user");

  // Directly, not through `fillContactBlanksReport` (Task 3's own path, exercised by its own unit tests):
  // the act's `after.value` must equal exactly what the column holds, so the display reads "available".
  const { error: emailErr } = await db.from("contacts").update({ email: emailC }).eq("account_id", accountId).eq("id", contactCId);
  if (emailErr) throw new Error(`ai-acts e2e: writing C's email failed: ${emailErr.message}`);

  actB1Id = await seedAct(db, {
    kind: "booking_created", target: { bookingId: booking1Id }, before: null,
    after: { startsAt: booking1StartsAt, endsAt: booking1EndsAt },
    actor: "voice", callId, chatId: null, contactId: contactCId,
  });
  await seedAct(db, {
    kind: "contact_field_filled", target: { field: "email" }, before: { value: null }, after: { value: emailC },
    actor: "voice", callId, chatId: null, contactId: contactCId,
  });
  actB2Id = await seedAct(db, {
    kind: "booking_created", target: { bookingId: booking2Id }, before: null,
    after: { startsAt: start2.toISOString(), endsAt: end2.toISOString() },
    actor: "voice", callId, chatId: null, contactId: contactCId,
  });
  actDId = await seedAct(db, {
    kind: "contact_created", target: {}, before: null, after: null,
    actor: "voice", callId: call2Id, chatId: null, contactId: contactDId,
  });
});

test.afterAll(async () => {
  if (!accountId) return;
  const db = serviceDb();
  const step = async (what: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await run();
    if (error) console.error(`ai-acts e2e cleanup: ${what} failed: ${error.message}`);
  };

  // Defensive throughout: the contact-removal test's own Undo already deletes D's acts, message,
  // conversation and contact (0091's `undo_ai_contact_created`), cascading its ai_acts; this sweep is a
  // no-op on anything it already took, and the one path back if that test did not run or did not land.
  if (contactCId) await step("ai_acts (C)", () => db.from("ai_acts").delete().eq("account_id", accountId).eq("contact_id", contactCId));
  if (contactDId) await step("ai_acts (D, defensive)", () => db.from("ai_acts").delete().eq("account_id", accountId).eq("contact_id", contactDId));
  if (booking1Id || booking2Id) {
    await step("bookings", () => db.from("bookings").delete().eq("account_id", accountId).in("id", [booking1Id, booking2Id].filter(Boolean)));
  }
  if (call2Id) await step("tasks (K2, defensive)", () => db.from("tasks").delete().eq("account_id", accountId).eq("call_id", call2Id));
  if (call2Id) await step("automation_log (K2)", () => db.from("automation_log").delete().eq("account_id", accountId).eq("subject_key", `call:${call2Id}`));
  if (conversationDId) await step("messages (D, defensive)", () => db.from("messages").delete().eq("account_id", accountId).eq("conversation_id", conversationDId));
  if (contactDId) await step("conversations (D, defensive)", () => db.from("conversations").delete().eq("account_id", accountId).eq("contact_id", contactDId));
  if (callId) await step("calls (K)", () => db.from("calls").delete().eq("account_id", accountId).eq("id", callId));
  if (call2Id) await step("calls (K2)", () => db.from("calls").delete().eq("account_id", accountId).eq("id", call2Id));
  if (phoneNumberId) await step("phone_numbers", () => db.from("phone_numbers").delete().eq("account_id", accountId).eq("id", phoneNumberId));
  if (contactCId || contactDId) {
    await step("contacts", () => db.from("contacts").delete().eq("account_id", accountId).in("id", [contactCId, contactDId].filter(Boolean)));
  }

  const checks: Array<[string, () => Promise<number>]> = [
    ["ai_acts (C)", async () => (await db.from("ai_acts").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("contact_id", contactCId)).count ?? -1],
    ["ai_acts (D)", async () => (await db.from("ai_acts").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("contact_id", contactDId)).count ?? -1],
    ["bookings", async () => (await db.from("bookings").select("id", { count: "exact", head: true }).eq("account_id", accountId).in("id", [booking1Id, booking2Id].filter(Boolean))).count ?? -1],
    ["calls", async () => (await db.from("calls").select("id", { count: "exact", head: true }).eq("account_id", accountId).in("id", [callId, call2Id].filter(Boolean))).count ?? -1],
    ["contacts", async () => (await db.from("contacts").select("id", { count: "exact", head: true }).eq("account_id", accountId).in("id", [contactCId, contactDId].filter(Boolean))).count ?? -1],
  ];
  for (const [table, count] of checks) {
    const n = await count();
    if (n !== 0) console.error(`ai-acts e2e cleanup: ${table} still holds ${n} row(s) for this spec's seed`);
  }
});

/** One act's row: the flat container `act-row.tsx` wraps every act in, filtered to the one carrying the
 *  given control — never positional, since a contact's acts render newest first and this seed's order is
 *  not the only thing a reader should have to track to find "the booking one" versus "the field one". */
function actRow(page: import("@playwright/test").Page, has: "booking" | "field" | "contact") {
  return recordPage(page).locator("[data-ai-act-row]").filter({ has: page.locator(`[data-ai-act-undo="${has}"]`) });
}
/** A row by its act's id (`data-ai-act-id`): the same in every language, the pseudo-locale included. */
function rowOf(page: import("@playwright/test").Page, actId: string) {
  return recordPage(page).locator(`[data-ai-act-row][data-ai-act-id="${actId}"]`);
}
function overtakenRow(page: import("@playwright/test").Page) {
  return rowOf(page, actB2Id);
}

test("at 360 px in the pseudo-locale, no element in an act row, the booking popover or the typed-name dialog overflows", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(`${contactUrl(contactCId)}?locale=pseudo`);
  const row = actRow(page, "booking");
  await expect(row).toBeVisible();
  await row.locator('[data-ai-act-undo="booking"]').click();
  const popover = page.locator("[data-ai-act-booking-popover]");
  await expect(popover).toBeVisible();

  // The same descendant sweep suggestions.spec.ts's own 360 px test uses: a screen-reader-only node is
  // clipped to 1px by design (its scrollWidth always exceeds its clientWidth), so it is excluded, never
  // counted as visible overflow.
  const noOverflow = async (scope: import("@playwright/test").Locator, label: string) => {
    const bad = await scope.evaluate((root) => [root, ...root.querySelectorAll("*")]
      .filter((n) => !n.closest(".sr-only"))
      .map((n) => ({
        tag: n.tagName, text: (n.textContent ?? "").slice(0, 60),
        scrollWidth: (n as HTMLElement).scrollWidth, clientWidth: (n as HTMLElement).clientWidth,
      }))
      .filter((n) => n.scrollWidth > n.clientWidth + 1));
    for (const b of bad) {
      expect(clipFailure(b.scrollWidth, b.clientWidth, `${label} <${b.tag.toLowerCase()}> "${b.text}"`)).toBeNull();
    }
  };
  // The overtaken row is found by its id and its state, never its words (the pseudo-locale pads them all).
  const overtaken = overtakenRow(page);
  await expect(overtaken).toHaveAttribute("data-ai-act-state", "blocked");
  await noOverflow(row, "booking act row");
  await noOverflow(actRow(page, "field"), "field act row");
  // Design I-3: a blocked row's reason sits under its source line, never squeezing the sentence.
  await noOverflow(overtaken, "overtaken (blocked) act row");
  await noOverflow(popover, "booking popover");

  // Closed without confirming (Escape, not the ghost Cancel — the pseudo-locale pads every string, so the
  // Cancel button's accessible name is not literally "Cancel" here): B1 stays "available" for the next test.
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();

  // The typed-name dialog, on D's record: opened, measured, closed untouched (Escape), so D's act is still
  // "available" for the contact-removal test.
  await page.goto(`${contactUrl(contactDId)}?locale=pseudo`);
  const contactRow = rowOf(page, actDId);
  await expect(contactRow).toHaveAttribute("data-ai-act-state", "available");
  await contactRow.locator('[data-ai-act-undo="contact"]').click();
  const dialog = page.locator("[data-ai-act-contact-dialog]");
  await expect(dialog).toBeVisible();
  await noOverflow(contactRow, "contact act row");
  await noOverflow(dialog, "typed-name dialog");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("Booking undo, \"Let them know\" unticked: no claim of telling the customer", async ({ page }) => {
  await page.goto(contactUrl(contactCId));
  const row = actRow(page, "booking");
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: m["common.undo"], exact: true }).click();

  const popover = page.locator("[data-ai-act-booking-popover]");
  await expect(popover).toBeVisible();
  const checkbox = popover.getByRole("checkbox", { name: w("aiActs.notify.label", "en", { name: contactNameC }), exact: true });
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await popover.getByRole("button", { name: m["common.undo"], exact: true }).click();

  const toast = page.locator("[data-sonner-toast]").filter({ hasText: m["aiActs.toast.bookingUndone"] });
  await expect(toast).toBeVisible();
  await expect(popover).toBeHidden();

  const db = serviceDb();
  const { data: booking, error: bErr } = await db.from("bookings").select("status").eq("account_id", accountId).eq("id", booking1Id).single();
  if (bErr) throw new Error(`ai-acts e2e: booking re-read failed: ${bErr.message}`);
  expect((booking as { status: string }).status).toBe("cancelled");

  const { data: act, error: aErr } = await db.from("ai_acts").select("undone_at, undone_by, undo_notified")
    .eq("account_id", accountId).eq("contact_id", contactCId).eq("kind", "booking_created")
    .contains("target", { bookingId: booking1Id }).single();
  if (aErr) throw new Error(`ai-acts e2e: act re-read failed: ${aErr.message}`);
  const a = act as { undone_at: string | null; undone_by: string | null; undo_notified: boolean };
  expect(a.undone_at).not.toBeNull();
  expect(a.undone_by).not.toBeNull();
  // No claim of telling the customer: the box was unticked, so no email was asked for.
  expect(a.undo_notified).toBe(false);

  // The row now reads "Undone by You · …" (authorLabel's own-viewer case, `provenance.you`). Found fresh by
  // its act's id, never through the earlier `row` reference: that locator's own filter (`has` a booking
  // Undo button) now matches nothing, so re-using it here would vacuously pass against an empty set.
  const undoneByYouPrefix = m["aiActs.undoneBy"].replace("{name}", m["provenance.you"]).split("{date}")[0]!.trim();
  const undoneRow = rowOf(page, actB1Id);
  await expect(undoneRow).toHaveAttribute("data-ai-act-state", "undone");
  await expect(undoneRow.locator("[data-ai-act-line]")).toContainText(undoneByYouPrefix);
  // Design M-1: focus moved to the row's new line, since the Undo that had it is gone.
  await expect(undoneRow.locator("[data-ai-act-line]")).toBeFocused();
  // No booking Undo button anywhere on the page any more (B1's is gone; B2 never had one).
  await expect(recordPage(page).locator('[data-ai-act-undo="booking"]')).toHaveCount(0);
});

test("Field undo, then its toast's own Undo: Sofía's value back over the person's", async ({ page }) => {
  await page.goto(contactUrl(contactCId));
  const row = actRow(page, "field");
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: m["common.undo"], exact: true }).click();

  const fieldWord = w("aiActs.field.email");
  // `concierge_profiles.persona_name` defaults to "Sofía" (0019); the fixture account never renames it.
  // The field was blank before her (`before.value` null), so the Undo REMOVED her value (design I-5).
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: w("aiActs.toast.fieldRemoved", "en", { field: fieldWord, persona: "Sofía" }) });
  await expect(toast).toBeVisible();

  const db = serviceDb();
  await expect.poll(async () =>
    (await db.from("contacts").select("email").eq("account_id", accountId).eq("id", contactCId).single()).data,
  ).toEqual({ email: null });

  await toast.getByRole("button", { name: m["common.undo"], exact: true }).click();
  const redoneToast = page.locator("[data-sonner-toast]").filter({ hasText: w("aiActs.toast.fieldRedone", "en", { persona: "Sofía", field: fieldWord }) });
  await expect(redoneToast).toBeVisible();

  await expect.poll(async () =>
    (await db.from("contacts").select("email").eq("account_id", accountId).eq("id", contactCId).single()).data,
  ).toEqual({ email: emailC });

  // Available again: the row carries an Undo button once more.
  await expect(actRow(page, "field").locator('[data-ai-act-undo="field"]')).toBeVisible();
});

test("Overtaken: the already-cancelled booking's row carries its reason, no Undo button", async ({ page }) => {
  await page.goto(contactUrl(contactCId));
  const row = overtakenRow(page);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-ai-act-state", "blocked");
  await expect(row.locator("[data-ai-act-line]")).toHaveText(w("aiActs.reason.alreadyCancelled"));
  await expect(row.locator("[data-ai-act-undo]")).toHaveCount(0);
});

test("the reader in Spanish", async ({ page }) => {
  await page.goto(`${contactUrl(contactCId)}?locale=es`);
  // The field act is "available" again (the previous test's redo), so its own control is this page's
  // one live "Deshacer" — proving the reader, not merely the never-touched case.
  await expect(actRow(page, "field").getByRole("button", { name: w("common.undo", "es"), exact: true })).toBeVisible();
  await expect(overtakenRow(page).locator("[data-ai-act-line]")).toHaveText(w("aiActs.reason.alreadyCancelled", "es"));
});

test("Contact removal: an untouched customer, typed name, the call stays in Calls unlinked", async ({ page }) => {
  await page.goto(contactUrl(contactDId));
  const row = rowOf(page, actDId);
  // Her own call's log row and its open callback To-do are hers (final review I-1, 0092): still safe.
  await expect(row).toHaveAttribute("data-ai-act-state", "available");
  await row.getByRole("button", { name: m["common.undo"], exact: true }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(w("aiActs.contactDialog.title", "en", { name: contactNameD }));
  const confirm = dialog.getByRole("button", { name: m["aiActs.contactDialog.confirm"], exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("textbox", { name: w("aiActs.contactDialog.label", "en", { name: contactNameD }), exact: true }).fill(contactNameD);
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // Final review I-2: the LIST, exactly — "/contacts" then the end, a query or a hash. The old pattern also
  // matched "/contacts/<D's id>", the record page the test started on.
  await expect(page).toHaveURL(new RegExp(`/dashboard/accounts/${accountId}/contacts/?(?:[?#]|$)`));
  await expect(page.getByRole("main").locator("[data-contact-row]").first()).toBeVisible();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: m["aiActs.toast.contactRemoved"] })).toBeVisible();

  const db = serviceDb();
  const { data: gone, error: goneErr } = await db.from("contacts").select("id").eq("account_id", accountId).eq("id", contactDId).maybeSingle();
  if (goneErr) throw new Error(`ai-acts e2e: contact re-read failed: ${goneErr.message}`);
  expect(gone, "contact removal must delete the contact row").toBeNull();
  const { data: callRow, error: callErr } = await db.from("calls").select("contact_id").eq("account_id", accountId).eq("id", call2Id).single();
  if (callErr) throw new Error(`ai-acts e2e: call re-read failed: ${callErr.message}`);
  expect((callRow as { contact_id: string | null }).contact_id, "the call stays in Calls, unlinked (D4)").toBeNull();
});
