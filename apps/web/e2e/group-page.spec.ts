import { test, expect } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, createContact, createGroupWithMember, addContactToGroup,
  getOrCreateCalendar, createBooking, assignPhoneNumber, startCallRow, finishCallRow, addNote,
} from "@bis/db";
import { m } from "../src/lib/messages";
import { recordPage } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * S-03 part 2, 2a (spec §11.1): the household page, opened BY URL (2a ships no link to it, R2).
 * 2b (Task 18) adds the two links IN (the contact header's household words, the Groups card's
 * Open) and a merged timeline of its own: one row per member (a receptionist call for Ana, a
 * booking-page booking for Luis, a note for Maria written as the signed-in e2e user), proving
 * each row names the right person AND keeps its author mark (DESIGN.md, Provenance; spec C6/C8/C9).
 * ON THE PER-RUN FIXTURE ACCOUNT ONLY, never Test Client One (CLAUDE.md). Three contacts "<First>
 * García <stamp>" with random phones and the household "Familia García <stamp>" (never "E2E …":
 * this file deletes its own rows, fixture-names.test.ts needs no admission; groups.spec's
 * precedent). afterAll deletes the call, its number and the booking (`on delete restrict`, before
 * the contacts) first, then the group (its memberships cascade) and the contacts, each error
 * checked.
 */
test.describe.configure({ mode: "serial", timeout: 60_000 });

const FIXTURE_FILE = "e2e/.auth/client-fixture.json";
const fixture = (): { accountId: string; clerkUserId: string } => {
  if (!existsSync(FIXTURE_FILE)) throw new Error(`client fixture missing at ${FIXTURE_FILE}: run the full suite (the "setup" project).`);
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf-8"));
};
// The spec runs as the AGENCY user (playwright.config's storageState is AUTH_FILE, agency_admin),
// so a note meant to read "You" carries that user's Clerk id, not the client fixture's (which reads
// "E2E Client"). Read as preferences.spec.ts does (final review I1).
const AGENCY_FIXTURE_FILE = "e2e/.auth/agency-fixture.json";
const agencyClerkUserId = (): string => {
  if (!existsSync(AGENCY_FIXTURE_FILE)) throw new Error(`agency fixture missing at ${AGENCY_FIXTURE_FILE}: run the full suite (the "setup" project).`);
  return (JSON.parse(readFileSync(AGENCY_FIXTURE_FILE, "utf-8")) as { clerkUserId: string }).clerkUserId;
};
const stamp = Date.now();
const ACTOR = "e2e-group-page";
const LAST = `García ${stamp}`;
const phone = () => `+1956292${String(Math.floor(Math.random() * 9000) + 1000)}`;
let cancelToken = "";
const made: { ana?: string; luis?: string; maria?: string; group?: string; call?: string; phoneNumber?: string } = {};
const url = (q = "") => `/dashboard/accounts/${fixture().accountId}/groups/${made.group}${q}`;
const contactUrl = (contactId: string, q = "") => `/dashboard/accounts/${fixture().accountId}/contacts/${contactId}${q}`;

test.beforeAll(async () => {
  const { accountId } = fixture();
  const db = serviceDb();
  for (const first of ["Ana", "Luis", "Maria"] as const) {
    const c = await createContact(db, accountId, { firstName: first, lastName: LAST, phone: phone() }, ACTOR);
    if (c.existing) throw new Error(`group-page e2e: ${first} matched an existing contact; refusing to use (or delete) it.`);
    made[first.toLowerCase() as "ana" | "luis" | "maria"] = c.id;
  }
  const g = await createGroupWithMember(db, accountId, made.ana!, "household", `Familia ${LAST}`, null, ACTOR);
  if (g.status !== "ok") throw new Error(`group-page e2e: ${g.status}`);
  made.group = g.groupId;
  for (const id of [made.luis!, made.maria!]) {
    const r = await addContactToGroup(db, accountId, id, g.groupId, null, ACTOR);
    if (r.status !== "ok") throw new Error(`group-page e2e: ${r.status}`);
  }
  // One timeline row per member, each through the app's own writer so it carries the author that
  // writer stamps (0073): a receptionist call for Ana (kind "ai"), a booking-page booking for Luis
  // (kind "customer", `createBooking`'s "public"/"system" actor), and a note for Maria stamped with
  // the signed-in AGENCY user's Clerk id (kind "person", resolving to "You" for the session this spec
  // runs as; agency-fixture.json, written by auth.setup.ts).
  const number = await assignPhoneNumber(db, accountId, { e164: `+1557${String(stamp).slice(-7)}`, status: "testing" }, ACTOR);
  made.phoneNumber = number.id;
  made.call = (await startCallRow(db, accountId, { phoneNumberId: number.id, callerE164: phone() })).id;
  await finishCallRow(db, accountId, made.call, {
    outcome: "booked", endedAt: new Date(), durationSecs: 120, turnCount: 0, transcript: [],
    summary: `Household call. Ref ${stamp}`, language: "en", contactId: made.ana!,
  });
  // Sixty days out: past the calendar's 30-day booking horizon, so booking.spec never offers this slot.
  const cal = await getOrCreateCalendar(db, accountId, ACTOR);
  const start = new Date(Date.now() + 60 * 86_400_000);
  start.setUTCHours(16, stamp % 60, 0, 0);
  const booked = await createBooking(db, accountId, {
    calendarId: cal.id, contactId: made.luis!, startsAt: start, endsAt: new Date(start.getTime() + 3_600_000), ipHash: `e2e-group-${stamp}`,
  }, "public", "system");
  cancelToken = booked.cancelToken;
  await addNote(db, accountId, made.maria!, `Household note ${stamp}`, agencyClerkUserId());
});

test.afterAll(async () => {
  const { accountId } = fixture();
  const db = serviceDb();
  const step = async (label: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await run();
    if (error) console.error(`group-page e2e: ${label} cleanup failed (the fixture sweep takes it): ${error.message}`);
  };
  if (made.call) await step("call", () => db.from("calls").delete().eq("account_id", accountId).eq("id", made.call!));
  if (made.phoneNumber) await step("phone number", () => db.from("phone_numbers").delete().eq("account_id", accountId).eq("id", made.phoneNumber!));
  // bookings.contact_id is `on delete restrict`: the booking goes before its contact.
  if (cancelToken) await step("booking", () => db.from("bookings").delete().eq("account_id", accountId).eq("cancel_token", cancelToken));
  if (made.group) await step("group", () => db.from("client_groups").delete().eq("account_id", accountId).eq("id", made.group!));
  const ids = [made.ana, made.luis, made.maria].filter((x): x is string => Boolean(x));
  await step("contacts", () => db.from("contacts").delete().eq("account_id", accountId).in("id", ids));
  // A failed read must fail the check, not read as "nothing left" (final review minor 3).
  const { data: left, error: leftError } = await db.from("contacts").select("id").in("id", ids);
  expect(leftError).toBeNull();
  expect(left).toEqual([]);
  if (cancelToken) {
    const { data: leftBooking } = await db.from("bookings").select("id").eq("cancel_token", cancelToken);
    expect(leftBooking ?? []).toEqual([]);
  }
});

test("asks who we call first, then Call Ana is the one primary, and Undo puts the question back (R1, D4)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(url());
  const rec = recordPage(page);
  await expect(rec.locator("h1")).toHaveText(`Familia ${LAST}`);
  await expect(rec.locator("[data-people-prompt]")).toHaveText(m["groupPage.people.choosePrimary"]);
  await expect(rec.locator('[data-record-action="call"]')).toHaveCount(0);
  const anaRow = rec.locator(`[data-people-row]`, { hasText: `Ana ${LAST}` });
  await anaRow.getByRole("button", { name: m["groupPage.people.makePrimaryContact"] }).click();
  await expect(page.getByText(m["groupPage.people.primaryContactSet"].replace("{name}", `Ana ${LAST}`))).toBeVisible();
  const call = rec.locator('[data-record-action="call"]');
  await expect(call).toHaveText(m["groupPage.action.call"].replace("{name}", "Ana"));
  await expect(rec.locator('[data-record-actions] [data-variant="default"]')).toHaveCount(1);
  await expect(call).toHaveAttribute("data-variant", "default");
  // The fixture account has no approved A2P registration (record-page.spec.ts:190): no Text.
  await expect(rec.locator('[data-record-action="text"]')).toHaveCount(0);
  await expect(rec.locator("[data-people-prompt]")).toHaveCount(0);
  await page.getByRole("button", { name: m["common.undo"] }).click();
  await expect(rec.locator("[data-people-prompt]")).toBeVisible();
  await expect(rec.locator('[data-record-action="call"]')).toHaveCount(0);
});

test("lists the three people and each name opens that person", async ({ page }) => {
  await page.goto(url());
  const rec = recordPage(page);
  await expect(rec.locator("[data-people-name]")).toHaveText([`Ana ${LAST}`, `Luis ${LAST}`, `Maria ${LAST}`]);
  await rec.locator("[data-people-name]", { hasText: `Luis ${LAST}` }).click();
  await expect(page).toHaveURL(new RegExp(`/contacts/${made.luis}$`));
});

test("reaches the group page from a member's contact header link, and from the Groups card's Open (D2/C15/R2)", async ({ page }) => {
  await page.goto(contactUrl(made.ana!));
  const rec = recordPage(page);
  const subtitle = rec.locator("[data-record-subtitle]");
  await expect(subtitle).toHaveText(m["record.group.household"].replace("{group}", `Familia ${LAST}`));
  await expect(subtitle).toHaveAttribute("href", `/dashboard/accounts/${fixture().accountId}/groups/${made.group}`);
  await subtitle.click();
  await expect(page).toHaveURL(new RegExp(`/groups/${made.group}$`));

  await page.goto(contactUrl(made.ana!));
  const open = rec.locator("[data-group-open]");
  await expect(open).toHaveCount(1);
  await expect(open).toHaveAttribute("data-group-open", made.group!);
  await open.click();
  await expect(page).toHaveURL(new RegExp(`/groups/${made.group}$`));
});

test("the merged timeline names the right member on every row, each keeping its own author mark, and the summary counts all three", async ({ page }) => {
  await page.goto(url());
  const rec = recordPage(page);
  const tl = rec.locator('[data-record-card="timeline"]');
  const items = tl.locator("[data-timeline-item]");
  await expect(items).toHaveCount(3);
  // DESIGN.md, Provenance: a row with no mark is a defect; C6: a row with no member subject is too.
  await expect(tl.locator("[data-timeline-item]:not(:has([data-author-mark]))")).toHaveCount(0);
  await expect(tl.locator("[data-timeline-item]:not(:has([data-timeline-subject]))")).toHaveCount(0);

  const call = tl.locator('[data-timeline-item="call"]');
  await expect(call).toHaveCount(1);
  await expect(call.locator("[data-timeline-subject]")).toHaveText(`Ana ${LAST}`);
  await expect(call.locator("[data-author-mark]")).toHaveText(m["provenance.ai"].replace("{name}", "Sofía"));

  const booking = tl.locator('[data-timeline-item="booking"]');
  await expect(booking).toHaveCount(1);
  await expect(booking.locator("[data-timeline-subject]")).toHaveText(`Luis ${LAST}`);
  await expect(booking.locator("[data-author-mark]")).toHaveText(m["provenance.customer"]);

  const note = tl.locator('[data-timeline-item="note"]');
  await expect(note).toHaveCount(1);
  await expect(note.locator("[data-timeline-subject]")).toHaveText(`Maria ${LAST}`);
  await expect(note.locator("[data-author-mark]")).toHaveText(m["provenance.you"]);

  // The summary's people fact counts the whole set, and Next up names the member with the booking.
  await expect(rec.locator("[data-record-facts]")).toContainText(m["groupPage.facts.people"].replace("{count}", "3"));
  const nextUpBooking = rec.locator('[data-record-card="next-up"] [data-next-up-row="booking"]');
  await expect(nextUpBooking).toHaveCount(1);
  await expect(nextUpBooking.locator("[data-next-up-who]")).toContainText("Luis");
});

test("in Spanish a row reads Cliente and the fact reads personas", async ({ page }) => {
  await page.goto(url("?locale=es"));
  const rec = recordPage(page);
  await expect(rec).toHaveAttribute("lang", "es");
  const booking = rec.locator('[data-record-card="timeline"] [data-timeline-item="booking"]');
  await expect(booking.locator("[data-author-mark]")).toHaveText(m["provenance.customer.es"]);
  await expect(rec.locator("[data-record-facts]")).toContainText(m["groupPage.facts.people.es"].replace("{count}", "3"));
});

test("at 390px the middle column comes first, then Properties and Deals closed, above People (spec §7's phone order; plan deviation 13)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url());
  const rec = recordPage(page);
  const order = await rec.locator("[data-record-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-record-card")));
  // 2b: the summary, Next up and the timeline lead (GROUP_RECORD_CARDS); 2a's four follow.
  expect(order).toEqual(["summary", "next-up", "timeline", "properties", "deals", "people", "details"]);
  for (const id of ["properties", "deals"]) {
    await expect(rec.locator(`[data-record-card="${id}"] h2 > button[aria-expanded]`)).toHaveAttribute("aria-expanded", "false");
  }
});
