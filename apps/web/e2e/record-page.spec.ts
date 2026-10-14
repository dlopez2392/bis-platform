import { test, expect, type Page } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, createContact, addPlace, getOrCreateCalendar, createBooking, assignPhoneNumber, startCallRow, finishCallRow,
  addNote, createForm, createSubmission, linkSubmissionContact, ensureConversation, createMessage,
} from "@bis/db";
import { m } from "../src/lib/messages";
import { recordPage } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * S-03 part 1, 1a (spec §12.1): the contact record page on the kit. ON THE PER-RUN FIXTURE ACCOUNT
 * ONLY, never Test Client One (CLAUDE.md). Two contacts with a stamped last name ("Record" with a
 * phone, an email, an addressed property and an upcoming booking; "Bare" with nothing), deleted in
 * afterAll. The property goes with its contact (places cascade on contacts.id); the booking does NOT
 * (bookings.contact_id is `on delete restrict`, 0017 and 0050), so it is deleted first.
 * Spanish is the QA override `?locale=es`, so no person's language is written. Serial: one setup.
 *
 * 1b (the timeline): every row is seeded through the app's own writer, so it carries the author
 * that writer stamps (0073): the booking page's booking (customer), a receptionist call (AI), a
 * form submission plus the inbox's `form` copy of it (shown once, C4), and a third contact,
 * "Pager", with 31 notes (one more than a page). afterAll deletes children first: messages, the
 * conversation, the call, its number, the booking and the submission (both `on delete restrict`),
 * the form, then the contacts. The call is gone before the next file runs, so calls.spec's
 * "calls today" (which runs earlier) and the specs after this one never see it.
 */
test.describe.configure({ mode: "serial", timeout: 60_000 });

const FIXTURE_FILE = "e2e/.auth/client-fixture.json";
function fixture(): { accountId: string } {
  if (!existsSync(FIXTURE_FILE)) throw new Error(`client fixture missing at ${FIXTURE_FILE}: run the full suite (the "setup" project).`);
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf-8")) as { accountId: string };
}

const stamp = Date.now();
const ACTOR = "e2e-record-page";
const LAST = `Page ${stamp}`;
const PHONE = `+1956292${String(Math.floor(Math.random() * 9000) + 1000)}`;
let cancelToken = "";
const made: {
  full?: string; bare?: string; pager?: string; phone?: string; call?: string; form?: string; submission?: string; conversation?: string;
} = {};
/** The form answer: typed words, so the "shown once" check counts them on the timeline. */
const WORDS = `Fence quote ${stamp}`;
const PHONE_ORDER = ["summary", "next-up", "timeline", "groups", "properties", "deals", "documents", "details", "tags", "related-people"];
const url = (id: string, q = "") => `/dashboard/accounts/${fixture().accountId}/contacts/${id}${q}`;
/** A card's phone disclosure: the button in its title (h2), never a control inside its body. */
const disclosure = (id: string) => `[data-record-card="${id}"] h2 > button[aria-expanded]`;

/** The rendered page, never the whole document: see `recordPage` in support.ts for why. */
const record = recordPage;

test.beforeAll(async () => {
  const { accountId } = fixture();
  const db = serviceDb();
  // createContact answers an EXISTING contact on an email or phone match. Anything it did not just
  // make is someone else's, and afterAll must never delete it: refuse to run instead.
  const full = await createContact(db, accountId, { firstName: "Record", lastName: LAST, phone: PHONE, email: `record-${stamp}@example.com` }, ACTOR);
  if (full.existing) throw new Error(`record-page e2e: ${PHONE} matched an existing contact; refusing to use (or delete) it.`);
  made.full = full.id;
  const bare = await createContact(db, accountId, { firstName: "Bare", lastName: LAST }, ACTOR);
  if (bare.existing) throw new Error("record-page e2e: the bare contact matched an existing one; refusing to use (or delete) it.");
  made.bare = bare.id;
  await addPlace(db, accountId, { contactId: made.full, groupId: null }, {
    label: null, address: "1204 Nolana Ave", landmark: null, directions: null, city: "McAllen", region: "TX", postal_code: "78504", country: "US",
  }, { subjectId: made.full, actorId: ACTOR });
  // Sixty days out: past the calendar's 30-day booking horizon, so booking.spec never offers this slot.
  const cal = await getOrCreateCalendar(db, accountId, ACTOR);
  const start = new Date(Date.now() + 60 * 86_400_000);
  start.setUTCHours(15, stamp % 60, 0, 0);
  // The booking page's own writer, so the row is the customer's (0073: author_kind 'customer').
  const booked = await createBooking(db, accountId, {
    calendarId: cal.id, contactId: made.full, startsAt: start, endsAt: new Date(start.getTime() + 3_600_000), ipHash: `e2e-${stamp}`,
  }, "public", "system");
  cancelToken = booked.cancelToken;
  // A receptionist call (calls.spec's path): every calls row is hers.
  const number = await assignPhoneNumber(db, accountId, { e164: `+1557${String(stamp).slice(-7)}`, status: "testing" }, ACTOR);
  made.phone = number.id;
  made.call = (await startCallRow(db, accountId, { phoneNumberId: number.id, callerE164: PHONE })).id;
  await finishCallRow(db, accountId, made.call, {
    outcome: "booked", endedAt: new Date(), durationSecs: 180, turnCount: 0, transcript: [],
    summary: `Roof leak, booked. Ref ${stamp}`, language: "en", contactId: made.full,
  });
  // A form submission AND the inbox's copy of it: the timeline must show it once (C4).
  const form = await createForm(db, accountId, { name: `Record form ${stamp}` }, ACTOR);
  made.form = form.id;
  made.submission = (await createSubmission(db, accountId, form.id, { answers: [{ key: "message", label: "Message", value: WORDS }] })).id;
  await linkSubmissionContact(db, accountId, made.submission, made.full);
  made.conversation = (await ensureConversation(db, accountId, made.full, ACTOR)).id;
  await createMessage(db, accountId, { conversationId: made.conversation, channel: "form", direction: "inbound", body: WORDS }, "form", "system");
  // 31 notes on their own contact: one more than a page.
  const pager = await createContact(db, accountId, { firstName: "Pager", lastName: LAST }, ACTOR);
  if (pager.existing) throw new Error("record-page e2e: the pager contact matched an existing one; refusing to use (or delete) it.");
  made.pager = pager.id;
  for (let i = 1; i <= 31; i++) await addNote(db, accountId, made.pager, `Pager note ${i}`, ACTOR);
});

test.afterAll(async () => {
  const { accountId } = fixture();
  const db = serviceDb();
  // Every step checked and logged, none thrown before the last assertion: the fixture sweep takes leftovers.
  const step = async (label: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await run();
    if (error) console.error(`record-page e2e: ${label} cleanup failed (the fixture sweep takes it): ${error.message}`);
  };
  const ids = [made.full, made.bare, made.pager].filter((x): x is string => Boolean(x));
  if (made.conversation) {
    await step("messages", () => db.from("messages").delete().eq("account_id", accountId).eq("conversation_id", made.conversation!));
    await step("conversation", () => db.from("conversations").delete().eq("account_id", accountId).eq("id", made.conversation!));
  }
  if (made.call) await step("call", () => db.from("calls").delete().eq("account_id", accountId).eq("id", made.call!));
  if (made.phone) await step("phone number", () => db.from("phone_numbers").delete().eq("account_id", accountId).eq("id", made.phone!));
  // bookings.contact_id is `on delete restrict`: the booking goes before its contact.
  if (cancelToken) await step("booking", () => db.from("bookings").delete().eq("account_id", accountId).eq("cancel_token", cancelToken));
  // form_submissions.form_id is `on delete restrict`: the submission goes before its form.
  if (made.submission) await step("submission", () => db.from("form_submissions").delete().eq("account_id", accountId).eq("id", made.submission!));
  if (made.form) await step("form", () => db.from("forms").delete().eq("account_id", accountId).eq("id", made.form!));
  await step("contacts", () => db.from("contacts").delete().eq("account_id", accountId).in("id", ids));
  const { data: left } = await db.from("contacts").select("id").in("id", ids);
  expect(left ?? []).toEqual([]);
  if (cancelToken) {
    const { data: leftBooking } = await db.from("bookings").select("id").eq("cancel_token", cancelToken);
    expect(leftBooking ?? []).toEqual([]);
  }
});

test("at 1280px the three columns hold their cards, and Call is the one primary", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(url(made.full!));
  const rec = record(page);
  const who = rec.locator('[data-record-column="who"]');
  const happening = rec.locator('[data-record-column="happening"]');
  const have = rec.locator('[data-record-column="have"]');
  await expect(happening.locator('[data-record-card="summary"]')).toBeVisible();
  await expect(have.locator('[data-record-card="deals"]')).toBeVisible();
  await expect(who.locator('[data-record-card="details"]')).toBeVisible();
  const [w, h, v] = await Promise.all([who.boundingBox(), happening.boundingBox(), have.boundingBox()]);
  expect(w!.x).toBeLessThan(h!.x);
  expect(h!.x).toBeLessThan(v!.x);
  const actions = rec.locator("[data-record-actions]");
  await expect(actions.locator('[data-variant="default"]')).toHaveCount(1);
  await expect(actions.locator('[data-record-action="call"]')).toHaveAttribute("data-variant", "default");
  await expect(actions.locator('[data-record-action="call"]')).toHaveAttribute("href", `tel:${PHONE}`);
  // The desk opens the "have" cards after hydration (phone-first server render, plan Task 4).
  await expect(rec.locator("[data-groups-card]")).toBeVisible();
  await expect(rec.locator('[data-record-card="groups"] h2 > button')).toHaveCount(0);
});

test("at 390px the order is header, summary, Next up, timeline, the closed 'have' cards, then who they are", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url(made.full!));
  const rec = record(page);
  await expect(rec.locator("[data-record-header]")).toBeVisible();
  const ids = await rec.locator("[data-record-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-record-card")));
  expect(ids).toEqual(PHONE_ORDER);
  const headerFirst = await rec.evaluate((root) => {
    const header = root.querySelector("[data-record-header]")!;
    const first = root.querySelector("[data-record-card]")!;
    return Boolean(header.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(headerFirst).toBe(true);
  for (const id of ["groups", "properties", "deals", "documents"]) {
    await expect(rec.locator(disclosure(id))).toHaveAttribute("aria-expanded", "false");
  }
  // A closed card mounts no body, so the Groups card's own section is not on the page at all.
  await expect(rec.locator("[data-groups-card]")).toHaveCount(0);
  await expect(rec.locator(disclosure("details"))).toHaveCount(0);
  await rec.locator(disclosure("deals")).click();
  await expect(rec.locator(disclosure("deals"))).toHaveAttribute("aria-expanded", "true");
  await expect(rec.locator('[data-record-card="deals"]')).toContainText(m["contact.noOpportunities"]);
});

test("an action with nothing behind it is hidden, not disabled: no email, no address, no phone, and Text while the gate is closed", async ({ page }) => {
  await page.goto(url(made.bare!));
  // Positive control first: the bare contact's own page is rendered, so the absences below are its.
  await expect(record(page).locator("[data-record-header]")).toBeVisible();
  await expect(record(page).locator("h1")).toHaveText(`Bare ${LAST}`);
  // Not rendered at all: no action, and no empty actions row either.
  await expect(record(page).locator("[data-record-action]")).toHaveCount(0);
  await expect(record(page).locator("[data-record-actions]")).toHaveCount(0);
  await page.goto(url(made.full!));
  const rec = record(page);
  await expect(rec.locator('[data-record-action="call"]')).toBeVisible();
  await expect(rec.locator('[data-record-action="email"]')).toBeVisible();
  await expect(rec.locator('[data-record-action="email"]')).toHaveAttribute("href", "#compose-email");
  await expect(rec.locator('[data-record-action="directions"]')).toHaveAttribute("href", /google\.com\/maps/);
  // The fixture account has no approved A2P registration, so the text gate is closed: no Text.
  await expect(rec.locator('[data-record-action="text"]')).toHaveCount(0);
  // What is shown is live: nothing in the row is a disabled stand-in.
  await expect(rec.locator("[data-record-action][aria-disabled], [data-record-action][disabled]")).toHaveCount(0);
});

test("Email lands on the email composer with its body focused; a #compose-sms deep link opens the Text tab", async ({ page }) => {
  await page.goto(url(made.full!));
  const emailTab = record(page).getByRole("button", { name: m["compose.email"], exact: true });
  await expect(emailTab).toHaveAttribute("aria-pressed", "false");
  await record(page).locator('[data-record-action="email"]').click();
  await expect(emailTab).toHaveAttribute("aria-pressed", "true");
  await expect(record(page).getByPlaceholder(m["compose.emailPlaceholder"])).toBeFocused();
  // A cold load of the deep link (never a same-document hash change from the page above), so this
  // proves the composer reads the hash it was opened with, not only a hashchange.
  await page.goto("about:blank");
  await page.goto(url(made.full!, "#compose-sms"));
  await expect(record(page).getByRole("button", { name: m["compose.sms"], exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(emailTab).toHaveAttribute("aria-pressed", "false");
});

test("a seeded upcoming booking shows in Next up", async ({ page }) => {
  await page.goto(url(made.full!));
  await expect(record(page).locator('[data-record-card="next-up"] [data-next-up-row="booking"]')).toHaveCount(1);
});

test("in Spanish the converted parts read Spanish and the page says so", async ({ page }) => {
  await page.goto(url(made.full!, "?locale=es"));
  const rec = record(page);
  await expect(rec).toHaveAttribute("lang", "es");
  await expect(rec.locator('[data-record-action="call"]')).toHaveText(m["record.action.call.es"]);
  await expect(rec.getByRole("heading", { name: m["record.card.nextUp.es"] })).toBeVisible();
});

/** S-03 1b: the timeline card, inside the rendered page (never the streamed hidden copy). */
const timelineCard = (page: Page) => record(page).locator('[data-record-card="timeline"]');

test("every timeline row says who made it: the booking page's booking is the customer's, the call is the receptionist's", async ({ page }) => {
  await page.goto(url(made.full!));
  const tl = timelineCard(page);
  const items = tl.locator("[data-timeline-item]");
  await expect(items.first()).toBeVisible();
  // DESIGN.md, Provenance: a row with no mark is a defect.
  await expect(tl.locator("[data-timeline-item]:not(:has([data-author-mark]))")).toHaveCount(0);
  const booking = tl.locator('[data-timeline-item="booking"]');
  await expect(booking).toHaveCount(1);
  await expect(booking.locator('[data-author-mark="customer"]')).toHaveText(m["provenance.customer"]);
  await expect(booking).toContainText(m["timeline.booked"].split("{when}")[0]!.trim());
  const call = tl.locator('[data-timeline-item="call"]');
  await expect(call.locator('[data-author-mark="ai"]')).toHaveText(/ · AI$/);
  await expect(call).toContainText(m["timeline.answeredCall"]);
  await expect(call.getByRole("link", { name: m["timeline.openCall"] })).toHaveAttribute("href", new RegExp(`/calls/${made.call}$`));
});

test("a form submission appears once, not twice: the inbox's copy is not a timeline row (C4, D15)", async ({ page }) => {
  await page.goto(url(made.full!));
  const tl = timelineCard(page);
  await expect(tl.locator('[data-timeline-item="submission"]')).toHaveCount(1);
  await expect(tl.locator('[data-timeline-item="message"]')).toHaveCount(0);
  await expect(tl.getByText(WORDS, { exact: true })).toHaveCount(1);
});

test("Older pages the timeline on the server, and Newer returns to the head", async ({ page }) => {
  await page.goto(url(made.pager!));
  const tl = timelineCard(page);
  await expect(tl.locator("[data-timeline-item]")).toHaveCount(30);
  await expect(tl.locator("[data-timeline-pager]")).toHaveCount(1);
  await tl.getByRole("link", { name: m["timeline.older"] }).click();
  await expect(page).toHaveURL(/[?&]before=/);
  await expect(timelineCard(page).locator("[data-timeline-item]")).toHaveCount(1);
  await expect(timelineCard(page).getByText("Pager note 1", { exact: true })).toBeVisible();
  await timelineCard(page).getByRole("link", { name: m["timeline.newer"] }).click();
  await expect(page).not.toHaveURL(/[?&]before=/);
  await expect(timelineCard(page).locator("[data-timeline-item]")).toHaveCount(30);
});

test("in Spanish a row reads Cliente", async ({ page }) => {
  await page.goto(url(made.full!, "?locale=es"));
  await expect(timelineCard(page).locator('[data-timeline-item="booking"] [data-author-mark="customer"]')).toHaveText(m["provenance.customer.es"]);
});
