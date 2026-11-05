import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { test, expect, type Page } from "./fixtures/test";
import { serviceDb, createContact } from "@bis/db";
import { m } from "../src/lib/messages";
import { formatPhone } from "../src/lib/document-requests/customer-state";
import { recordPage, e2eAuthor } from "./support";

// Same two paths, same reason, as every other spec that talks to Supabase from
// the Playwright runner process rather than through a Next.js request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * F-115 plan Task 9 (record history and trash, S-04): the one real-browser proof that a changed
 * phone shows on the contact record's timeline with "Was"/"Now", that "Put back" writes a real row
 * and reverts the field, and that the toast's own "Undo" reverts the Put back in turn. The SQL
 * capture (0111/0112) is proven by packages/db's schema tests; `change-item.test.ts` proves the
 * row's own rendering with no DOM. This file is the one place the whole chain — an inline edit, the
 * capture trigger, the timeline reader, Put back and Undo — runs for real against a production
 * build.
 *
 * ON THE PER-RUN CLIENT FIXTURE ACCOUNT ONLY (auth.setup.ts creates it, auth.teardown.ts deletes it
 * unconditionally) — never `Test Client One` (CLAUDE.md hard rule). The contact this file seeds is
 * made through the app's own writer, `createContact` (the same function the "Add contact" action
 * calls), so its own creation lands a real `record_changes` insert row too, rather than a raw
 * service insert that would bypass the capture trigger's client/server split entirely. The phone
 * EDIT itself runs through the signed-in browser session (the "setup" project's one real Clerk
 * user), so the capture trigger's CLIENT path fires and that row is authored "person" by the SAME
 * viewer running this test — the author mark then reads "You" (`provenance.you`).
 *
 * TIMING NOTE. `change-item.tsx`'s own Put back toast sets no `duration`, so it lives for Sonner's
 * default 4 seconds (`TOAST_LIFETIME`, `sonner/dist/index.mjs`) — unlike a few other Undo-bearing
 * toasts in this app (`holding-move-handlers.ts`, `suggestion-handlers.ts`) that explicitly ask for
 * 10. Between the toast becoming visible and clicking its own "Undo", this file does exactly one
 * fast, non-polling database read and nothing else, so the 4-second default is never at risk; every
 * heavier check (the folded group's three Was/Now lines) runs AFTER Undo, with no toast left to
 * race.
 */
test.describe.configure({ timeout: 60_000 });

const FIXTURE_FILE = "e2e/.auth/client-fixture.json";
function fixture(): { accountId: string } {
  if (!existsSync(FIXTURE_FILE)) throw new Error(`client fixture missing at ${FIXTURE_FILE}: run the full suite (the "setup" project).`);
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf-8")) as { accountId: string };
}

const STAMP = Date.now();
const ACTOR = "e2e-record-history";
// "956 555" (McAllen, TX), the same unambiguous-US prefix `contacts-merge.spec.ts` seeds with —
// `phone.ts`'s own `validUnder` reads it as US and not MX, so no country-unconfirmed flag ever
// complicates this file's own phone math.
const PHONE_BEFORE = `+1956555${String(STAMP).slice(-4)}`;
const PHONE_AFTER = `+1956555${String(STAMP + 1).slice(-4)}`;
const PHONE_BEFORE_DISPLAY = formatPhone(PHONE_BEFORE);
const PHONE_AFTER_DISPLAY = formatPhone(PHONE_AFTER);

let contactId = "";
const url = (q = "") => `/dashboard/accounts/${fixture().accountId}/contacts/${contactId}${q}`;

/** For a RegExp built from catalogue copy (contact-detail.spec.ts's own helper). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The newest sonner toast whose text matches (contacts-merge.spec.ts's own idiom): never a bare
 *  `getByText`, which a second toast still on screen (or the same words sitting in the row itself)
 *  could also satisfy. */
function toastWith(page: Page, text: string) {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

/** The timeline card, inside the rendered page (never the streamed hidden copy — support.ts's own
 *  RECORD_PAGE convention: this record route has a loading.tsx). */
const timelineCard = (page: Page) => recordPage(page).locator('[data-record-card="timeline"]');

/** The live phone column, read on the service client — the ground truth Put back/Undo must move,
 *  decoupled from whatever the Details card's own client-side field state happens to be showing. */
async function readPhone(): Promise<string | null> {
  const { accountId } = fixture();
  const { data, error } = await serviceDb().from("contacts").select("phone")
    .eq("account_id", accountId).eq("id", contactId).maybeSingle();
  if (error) throw new Error(`record-history e2e: phone read failed: ${error.message}`);
  return (data as { phone: string | null } | null)?.phone ?? null;
}

test.beforeAll(async () => {
  const { accountId } = fixture();
  const db = serviceDb();
  const made = await createContact(db, accountId, { firstName: "History", lastName: `Hx ${STAMP}`, phone: PHONE_BEFORE }, ACTOR);
  if (made.existing) throw new Error(`record-history e2e: ${PHONE_BEFORE} matched an existing contact; refusing to use (or delete) it.`);
  contactId = made.id;
});

test.afterAll(async () => {
  const { accountId } = fixture();
  const db = serviceDb();
  const { error } = await e2eAuthor(db.from("contacts").delete()).eq("account_id", accountId).eq("id", contactId);
  if (error) console.error(`record-history e2e: cleanup failed (the fixture sweep takes it): ${error.message}`);
});

test("a changed phone shows Was/Now on the timeline, Put back reverts it, and Undo reverts the Put back", async ({ page }) => {
  // Step 1: the contact already exists (beforeAll); open its record page.
  await page.goto(url());
  const rec = recordPage(page);
  const details = rec.locator('[data-record-card="details"]');

  // Step 2: edit the phone inline (DESIGN.md record-view rule: click the value, edit, save on
  // blur/Enter) and confirm the save landed.
  const editPhone = m["inline.edit"].replace("{label}", m["contacts.phone"]);
  await details.getByRole("button", { name: new RegExp(`^${escapeRegExp(editPhone)}`) }).click();
  await details.getByRole("textbox", { name: m["contacts.phone"], exact: true }).fill(PHONE_AFTER_DISPLAY);
  await page.keyboard.press("Enter");
  await expect(page.getByText(m["inline.saved"].replace("{label}", m["contacts.phone"])).first()).toBeVisible();
  await expect.poll(readPhone).toBe(PHONE_AFTER);

  // The inline save does not itself refresh the server-rendered Activity card — reload once for a
  // clean render, the one place this file leans on a reload rather than Put back/Undo's own
  // router.refresh() (change-item.tsx's `onDone`).
  await page.reload();

  // Step 3: the timeline row carries the author mark and "changed phone"; its disclosure shows
  // Was/Now for the edit. DESIGN.md Provenance: a row with no mark is a defect.
  const tl = timelineCard(page);
  const changeRow = tl.locator('[data-timeline-item="change"]').first();
  await expect(changeRow.locator('[data-author-mark="person"]')).toHaveText(m["provenance.you"]);
  await expect(changeRow).toContainText(m["history.verb.changed"].replace("{fields}", m["history.field.phone"]));
  const phoneLines = changeRow.locator('[data-change-field="phone"]');
  await expect(phoneLines).toHaveCount(1);
  await changeRow.locator("[data-change-detail] summary").click();
  await expect(phoneLines.first()).toContainText(`${m["history.was"]} ${PHONE_BEFORE_DISPLAY}`);
  await expect(phoneLines.first()).toContainText(`${m["history.now"]} ${PHONE_AFTER_DISPLAY}`);

  // Step 4: Put back. A fast, single (non-polling) read proves the field itself moved back before
  // the toast's own 4-second default has any chance to lapse (see the file header's Timing note).
  await phoneLines.first().getByRole("button", { name: m["history.putBack"], exact: true }).click();
  const putBackToast = toastWith(page, m["history.putBack.done"].replace("{field}", m["history.label.phone"]));
  await expect(putBackToast).toBeVisible();
  expect(await readPhone()).toBe(PHONE_BEFORE);

  // Step 5: Undo, from the SAME toast, before anything else could dismiss it. This is the toast's
  // own action — itself another Put back, on the row Put back just wrote (`putBackOne`,
  // change-item.tsx) — never a second "Put back" click standing in for it.
  await putBackToast.getByRole("button", { name: m["history.undo"], exact: true }).click();
  await expect.poll(readPhone).toBe(PHONE_AFTER);

  // Now that nothing is racing a toast, the heavier UI proof: the group folded (same author,
  // well under the 10-minute window) into one row carrying all three writes — the edit, the Put
  // back, and Undo's own Put back of THAT — each its own Was/Now line, oldest first.
  await expect(phoneLines).toHaveCount(3);
  await expect(phoneLines.nth(0)).toContainText(`${m["history.was"]} ${PHONE_BEFORE_DISPLAY}`);
  await expect(phoneLines.nth(0)).toContainText(`${m["history.now"]} ${PHONE_AFTER_DISPLAY}`);
  await expect(phoneLines.nth(1)).toContainText(`${m["history.was"]} ${PHONE_AFTER_DISPLAY}`);
  await expect(phoneLines.nth(1)).toContainText(`${m["history.now"]} ${PHONE_BEFORE_DISPLAY}`);
  await expect(phoneLines.nth(2)).toContainText(`${m["history.was"]} ${PHONE_BEFORE_DISPLAY}`);
  await expect(phoneLines.nth(2)).toContainText(`${m["history.now"]} ${PHONE_AFTER_DISPLAY}`);

  // Step 6: the Spanish reader preference (`?locale=es`, the suite's own QA override —
  // request-locale.ts, BIS_I18N_QA set in playwright.config.ts's webServer env) reads the SAME
  // group's mark and verb in Spanish. `change-rows.test.ts`/`change-item.test.ts` already prove
  // every other string on this card with no DOM; this one live check stands in for the rest.
  await page.goto(url("?locale=es"));
  await expect(rec).toHaveAttribute("lang", "es");
  const esChangeRow = timelineCard(page).locator('[data-timeline-item="change"]').first();
  await expect(esChangeRow.locator('[data-author-mark="person"]')).toHaveText(m["provenance.you.es"]);
  await expect(esChangeRow).toContainText(m["history.verb.changed.es"].replace("{fields}", m["history.field.phone.es"]));
});
