import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { test, expect, type Page } from "./fixtures/test";
import { serviceDb } from "@bis/db";
import { m } from "../src/lib/messages";

// Same two paths, same reason, as every other spec that talks to Supabase from
// the Playwright runner process rather than through a Next.js request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * WHY THIS FILE EXISTS.
 *
 * F-006 part 1 (plan Task 12, 2026-10-29). The ONLY real-browser proof of the whole merge path: a
 * database-trigger-filed pair shows up under a record's header, the compare screen merges it with one
 * click, the toast and the timeline both name the kept record, a deep link to the merged-away record's
 * old URL redirects to the kept one, "Undo merge" on the timeline puts the pair back exactly where it
 * was, and the Possible duplicates view's own "Not the same person" (and ITS Undo) round-trips too.
 * `contact-dedupe-schema.test.ts`/`contact-merge-schema.test.ts` prove the SQL; `merge-screen.test.ts` and
 * friends prove the client wiring with no DOM renderer; this file is the one place the whole thing runs
 * for real, against a production build.
 *
 * FIXTURE DISCIPLINE. Both contacts are seeded with the SERVICE client by a DIRECT insert on the per-run
 * CLIENT FIXTURE account ("E2E Client Co …", auth.setup.ts creates it, auth.teardown.ts deletes it
 * unconditionally) — never `Test Client One` or any other live account (CLAUDE.md hard rule). A direct
 * insert, not `createContact`: `createContact`'s own phone match would fold the second contact into the
 * first instead of creating two rows for the trigger to pair (plan Task 12, Step 2). Migration 0106's
 * `app.contacts_flag_pairs()` trigger files the pair on INSERT regardless of caller — no app code runs
 * to make that happen, which is the whole point of a database-level dedupe queue.
 *
 * Both contacts end the run live and unmerged (the merge is undone in the same test), so there is
 * nothing to delete by hand: `contact_merges` holds an undone row that cascades with the two contacts,
 * and the per-run fixture account is torn down whole by `auth.teardown.ts` regardless of how this test
 * finishes.
 */
test.describe.configure({ timeout: 180_000 });

type ClientFixtureFull = { accountId: string; clerkUserId: string };
const CLIENT_FIXTURE_FILE = "e2e/.auth/client-fixture.json";

/**
 * Copied from contacts-archive.spec.ts (not exported there). Read at RUN TIME, never at module scope:
 * Playwright evaluates module scope during COLLECTION, before the "setup" project has written this file.
 * Missing at run time is a FAILURE, not a skip — the "setup" project's dependency was bypassed.
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
const main = (page: Page) => page.locator("main");

let accountId = "";
const base = () => `/dashboard/accounts/${accountId}`;

const unoName = `Merge Uno ${STAMP}`;
const dosName = `Merge Dos ${STAMP}`;
let unoId = "";
let dosId = "";

test.beforeAll(async () => {
  accountId = fullFixture().accountId;

  // A phone unique to this run, shared by both contacts on purpose: the trigger's own phone match (0106
  // part A) is what files the pair, with reason `same_phone` (strength 1, the strongest). No last name
  // on either, so neither can also collect a `same_name` flag (nameKey needs one).
  const phone = `+1956555${String(STAMP).slice(-4)}`;
  const svc = serviceDb();

  // Two separate inserts, not one batched array: Uno must be the OLDER row by `created_at` (owner ruling
  // D4, the compare screen's own tiebreak) so step 3 below can assert it is the one marked "Keep this one".
  const { data: uno, error: unoErr } = await svc.from("contacts")
    .insert({ account_id: accountId, first_name: unoName, phone }).select("id").single();
  if (unoErr) throw new Error(`contacts-merge e2e: inserting Uno failed: ${unoErr.message}`);
  unoId = (uno as { id: string }).id;

  const { data: dos, error: dosErr } = await svc.from("contacts")
    .insert({ account_id: accountId, first_name: dosName, phone }).select("id").single();
  if (dosErr) throw new Error(`contacts-merge e2e: inserting Dos failed: ${dosErr.message}`);
  dosId = (dos as { id: string }).id;
});

/**
 * The header's real total, read off the page rather than assumed (contacts-archive.spec.ts's own
 * `readTotal`): the fixture account's contact count is whatever earlier specs in this run left, never a
 * literal.
 */
async function readContactsTotal(page: Page): Promise<number> {
  const text = await main(page).getByText(/^\d+ contacts?$/).first().innerText();
  const n = Number(text.match(/\d+/)?.[0]);
  if (Number.isNaN(n)) throw new Error(`readContactsTotal: unreadable header text "${text}"`);
  return n;
}

/** The newest sonner toast whose text matches — never a bare `getByText`, which a second toast still on
 *  screen (or the same words sitting in a timeline row) could also satisfy (shared-number.spec.ts's own
 *  idiom, `[data-sonner-toast]`). */
function toastWith(page: Page, text: string) {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

test("find a duplicate, merge it, follow the old link, undo it and dismiss a pair, on the fixture account", async ({ page }) => {
  // Step 1: the list's header total before anything below touches it.
  await page.goto(`${base()}/contacts`);
  const beforeMerge = await readContactsTotal(page);

  // Step 2: Uno's own record carries the line and the way to the compare screen.
  await page.goto(`${base()}/contacts/${unoId}`);
  // Scoped to <main>: while a Suspense section streams in, Next.js briefly holds a hidden copy of it
  // outside <main> (CI run 41011103395 matched two spans here), and a page-wide getByText is strict.
  await expect(page.getByRole("main").getByText(m["contacts.duplicates.reason.samePhone"])).toBeVisible();
  const compareLink = page.getByRole("link", { name: m["contacts.duplicates.compare"], exact: true });
  await compareLink.click();

  // Step 3: the compare screen. Scoped to each person's own card (`div.rounded-xl`, merge-screen.tsx's
  // own class on that container — distinct from the conflict fieldset below it): a bare `getByText` for
  // either name would also match the "has no history to move" line, which names the kept record too.
  await expect(page.getByRole("heading", { name: m["contacts.merge.title"], exact: true })).toBeVisible();
  const keepCard = page.locator("div.rounded-xl", { hasText: unoName });
  await expect(keepCard).toContainText(m["contacts.merge.keep"]);
  const joinsCard = page.locator("div.rounded-xl", { hasText: dosName });
  await expect(joinsCard).toContainText(m["contacts.merge.joins"]);

  // Step 4: Merge. The toast names Uno (the kept record); the page lands on Uno's record; the timeline
  // carries the merge row (neither contact has any history to move, so it's the empty-list wording).
  await page.getByRole("button", { name: m["contacts.merge.action"], exact: true }).click();
  await expect(toastWith(page, m["contacts.merge.done"].replace("{name}", unoName))).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/contacts/${unoId}$`));
  await expect(page.getByRole("main").getByText(m["timeline.mergedEmpty"].replace("{name}", dosName))).toBeVisible();

  // Step 5: the list's total is one less than step 1 — relative, never absolute (another spec in this
  // run may have its own leftovers).
  await page.goto(`${base()}/contacts`);
  await expect.poll(() => readContactsTotal(page)).toBe(beforeMerge - 1);

  // Step 6: Dos's own old URL now redirects to the record it was merged into.
  await page.goto(`${base()}/contacts/${dosId}`);
  await expect(page).toHaveURL(new RegExp(`/contacts/${unoId}$`));

  // Step 7: "Undo merge" on the timeline (we're already on Uno's record, via the redirect). The toast
  // names Dos — the record the Undo gives back its own record — and the list's total returns to step 1's.
  await page.getByRole("button", { name: m["timeline.undoMerge"], exact: true }).click();
  await expect(toastWith(page, m["contacts.merge.undone"].replace("{name}", dosName))).toBeVisible();
  await page.goto(`${base()}/contacts`);
  await expect.poll(() => readContactsTotal(page)).toBe(beforeMerge);

  // Step 8: the Possible duplicates view lists the pair again (the Undo cleared the flag's `merge_id`);
  // "Not the same person" removes it at once with an Undo, which brings it straight back.
  await page.goto(`${base()}/contacts?view=duplicates`);
  const dupRow = page.getByRole("listitem").filter({ hasText: unoName }).filter({ hasText: dosName });
  await expect(dupRow).toBeVisible();
  await dupRow.getByRole("button", { name: m["contacts.duplicates.notSame"], exact: true }).click();
  const dismissedToast = toastWith(page, m["contacts.duplicates.dismissed"]);
  await expect(dismissedToast).toBeVisible();
  await expect(dupRow).toHaveCount(0);
  await dismissedToast.getByRole("button", { name: m["common.undo"], exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: unoName }).filter({ hasText: dosName })).toBeVisible();
});
