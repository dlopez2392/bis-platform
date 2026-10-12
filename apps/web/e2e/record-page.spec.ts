import { test, expect } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact, addPlace, getOrCreateCalendar } from "@bis/db";
import { m } from "../src/lib/messages";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * S-03 part 1, 1a (spec §12.1): the contact record page on the kit. ON THE PER-RUN FIXTURE ACCOUNT
 * ONLY, never Test Client One (CLAUDE.md). Two contacts with a stamped last name ("Record" with a
 * phone, an email, an addressed property and an upcoming booking; "Bare" with nothing), deleted in
 * afterAll. The property goes with its contact (places cascade on contacts.id); the booking does NOT
 * (bookings.contact_id is `on delete restrict`, 0017 and 0050), so it is deleted first.
 * Spanish is the QA override `?locale=es`, so no person's language is written. Serial: one setup.
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
const CANCEL_TOKEN = `e2e-record-${stamp}`;
const made: { full?: string; bare?: string } = {};
const PHONE_ORDER = ["summary", "next-up", "timeline", "groups", "properties", "deals", "details", "tags", "related-people"];
const url = (id: string, q = "") => `/dashboard/accounts/${fixture().accountId}/contacts/${id}${q}`;
/** A card's phone disclosure: the button in its title (h2), never a control inside its body. */
const disclosure = (id: string) => `[data-record-card="${id}"] h2 > button[aria-expanded]`;

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
  const { error } = await db.from("bookings").insert({
    account_id: accountId, calendar_id: cal.id, contact_id: made.full,
    starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3_600_000).toISOString(), cancel_token: CANCEL_TOKEN,
  });
  if (error) throw new Error(`record-page e2e: booking seed failed: ${error.message}`);
});

test.afterAll(async () => {
  const { accountId } = fixture();
  const db = serviceDb();
  const ids = [made.full, made.bare].filter((x): x is string => Boolean(x));
  // The booking first: bookings.contact_id is `on delete restrict`, so the contact delete below
  // would fail while it stands.
  const booking = await db.from("bookings").delete().eq("account_id", accountId).eq("cancel_token", CANCEL_TOKEN);
  if (booking.error) console.error(`record-page e2e: booking cleanup failed (the fixture sweep takes it): ${booking.error.message}`);
  const { error } = await db.from("contacts").delete().eq("account_id", accountId).in("id", ids);
  if (error) console.error(`record-page e2e: cleanup failed (the fixture sweep takes it): ${error.message}`);
  const { data: left } = await db.from("contacts").select("id").in("id", ids);
  expect(left ?? []).toEqual([]);
  const { data: leftBooking } = await db.from("bookings").select("id").eq("cancel_token", CANCEL_TOKEN);
  expect(leftBooking ?? []).toEqual([]);
});

test("at 1280px the three columns hold their cards, and Call is the one primary", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(url(made.full!));
  const who = page.locator('[data-record-column="who"]');
  const happening = page.locator('[data-record-column="happening"]');
  const have = page.locator('[data-record-column="have"]');
  await expect(happening.locator('[data-record-card="summary"]')).toBeVisible();
  await expect(have.locator('[data-record-card="deals"]')).toBeVisible();
  await expect(who.locator('[data-record-card="details"]')).toBeVisible();
  const [w, h, v] = await Promise.all([who.boundingBox(), happening.boundingBox(), have.boundingBox()]);
  expect(w!.x).toBeLessThan(h!.x);
  expect(h!.x).toBeLessThan(v!.x);
  const actions = page.locator("[data-record-actions]");
  await expect(actions.locator('[data-variant="default"]')).toHaveCount(1);
  await expect(actions.locator('[data-record-action="call"]')).toHaveAttribute("data-variant", "default");
  await expect(actions.locator('[data-record-action="call"]')).toHaveAttribute("href", `tel:${PHONE}`);
  // The desk opens the "have" cards after hydration (phone-first server render, plan Task 4).
  await expect(page.locator("[data-groups-card]")).toBeVisible();
  await expect(page.locator('[data-record-card="groups"] h2 > button')).toHaveCount(0);
});

test("at 390px the order is header, summary, Next up, timeline, the closed 'have' cards, then who they are", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url(made.full!));
  await expect(page.locator("[data-record-header]")).toBeVisible();
  const ids = await page.locator("[data-record-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-record-card")));
  expect(ids).toEqual(PHONE_ORDER);
  const headerFirst = await page.evaluate(() => {
    const header = document.querySelector("[data-record-header]")!;
    const first = document.querySelector("[data-record-card]")!;
    return Boolean(header.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(headerFirst).toBe(true);
  for (const id of ["groups", "properties", "deals"]) {
    await expect(page.locator(disclosure(id))).toHaveAttribute("aria-expanded", "false");
  }
  // A closed card mounts no body, so the Groups card's own section is not on the page at all.
  await expect(page.locator("[data-groups-card]")).toHaveCount(0);
  await expect(page.locator(disclosure("details"))).toHaveCount(0);
  await page.locator(disclosure("deals")).click();
  await expect(page.locator(disclosure("deals"))).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('[data-record-card="deals"]')).toContainText(m["contact.noOpportunities"]);
});

test("an action with nothing behind it is hidden, not disabled: no email, no address, no phone, and Text while the gate is closed", async ({ page }) => {
  await page.goto(url(made.bare!));
  await expect(page.locator("[data-record-header]")).toBeVisible();
  // Not rendered at all: no action, and no empty actions row either.
  await expect(page.locator("[data-record-action]")).toHaveCount(0);
  await expect(page.locator("[data-record-actions]")).toHaveCount(0);
  await page.goto(url(made.full!));
  await expect(page.locator('[data-record-action="call"]')).toBeVisible();
  await expect(page.locator('[data-record-action="email"]')).toBeVisible();
  await expect(page.locator('[data-record-action="email"]')).toHaveAttribute("href", "#compose-email");
  await expect(page.locator('[data-record-action="directions"]')).toHaveAttribute("href", /google\.com\/maps/);
  // The fixture account has no approved A2P registration, so the text gate is closed: no Text.
  await expect(page.locator('[data-record-action="text"]')).toHaveCount(0);
  // What is shown is live: nothing in the row is a disabled stand-in.
  await expect(page.locator("[data-record-action][aria-disabled], [data-record-action][disabled]")).toHaveCount(0);
});

test("Email lands on the email composer with its body focused; a #compose-sms deep link opens the Text tab", async ({ page }) => {
  await page.goto(url(made.full!));
  const emailTab = page.getByRole("button", { name: m["compose.email"], exact: true });
  await expect(emailTab).toHaveAttribute("aria-pressed", "false");
  await page.locator('[data-record-action="email"]').click();
  await expect(emailTab).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByPlaceholder(m["compose.emailPlaceholder"])).toBeFocused();
  // A cold load of the deep link (never a same-document hash change from the page above), so this
  // proves the composer reads the hash it was opened with, not only a hashchange.
  await page.goto("about:blank");
  await page.goto(url(made.full!, "#compose-sms"));
  await expect(page.getByRole("button", { name: m["compose.sms"], exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(emailTab).toHaveAttribute("aria-pressed", "false");
});

test("a seeded upcoming booking shows in Next up", async ({ page }) => {
  await page.goto(url(made.full!));
  await expect(page.locator('[data-record-card="next-up"] [data-next-up-row="booking"]')).toHaveCount(1);
});

test("in Spanish the converted parts read Spanish and the page says so", async ({ page }) => {
  await page.goto(url(made.full!, "?locale=es"));
  await expect(page.locator("[data-record-layout]")).toHaveAttribute("lang", "es");
  await expect(page.locator('[data-record-action="call"]')).toHaveText(m["record.action.call.es"]);
  await expect(page.getByRole("heading", { name: m["record.card.nextUp.es"] })).toBeVisible();
});
