import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { test, expect, type Page } from "./fixtures/test";
import { serviceDb, deleteContacts } from "@bis/db";
import { MIN_PHONE_SEARCH_DIGITS } from "@bis/db/contact-search";
import { m } from "../src/lib/messages";

// Same two paths, same reason, as every other spec that talks to Supabase from
// the Playwright runner process rather than through a Next.js request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * WHY THIS FILE EXISTS.
 *
 * Plan Task 13 (F-092 part 1, 2026-10-31): the ONLY real-browser, real-Postgres proof that a search
 * actually ignores accents, finds a full name in any word order, folds ñ to n, and finds a customer by
 * a handful of phone digits — against the real `contacts_search_trgm` index on a real build, not a
 * mocked database client. `contact-search.test.ts`, `contact-search-filter.test.ts` and
 * `contact-search-tiers.test.ts` prove the plan and the SQL filter with no database at all;
 * `highlighted-text.test.ts` and `command-palette.test.ts` prove the highlighting with no DOM renderer.
 * This file is the one place the whole path — RLS, the trigram index, the three tiers, and the mark
 * rendered in a real page — runs together.
 *
 * FIXTURE DISCIPLINE. Both contacts are seeded with the SERVICE client by a direct insert on the
 * per-run CLIENT FIXTURE account ("E2E Client Co …", auth.setup.ts creates it, auth.teardown.ts deletes
 * it unconditionally) — never `Test Client One` (CLAUDE.md hard rule, and its own Maria Garcia carries
 * no accent, so it could never stand in for this case anyway). A direct insert, not `createContact`:
 * this file only needs two rows with exact folded names and a known phone, not that helper's own
 * dedupe behaviour. Both contacts carry a run-stamped email so no run's rows can ever collide with
 * another's by the stripped-+tag email key (contacts-merge.spec.ts's own reasoning), and both are
 * deleted in `afterAll` regardless of how the test finishes — belt-and-suspenders alongside the
 * account-wide teardown, since other specs mutate this same account before it runs.
 */
test.describe.configure({ timeout: 120_000 });

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
// Exactly MIN_PHONE_SEARCH_DIGITS — the owner's Q2 floor — so this term is itself proof that the floor,
// not just a longer digit run, is enough to find a customer by phone. Never taken FROM the stamp (a run of
// STAMP would be guaranteed to sit inside both seeded emails, which embed it whole), and never left to
// chance either (F-092 final review M-3): a plain random draw still lands inside String(STAMP) about one
// run in a thousand — and then the search finds Inés by her stamped email, step 4's "Inés is absent"
// fails — or inside Maria's own "52899123", where it would match (and be marked) somewhere other than
// the last four. So the draw is REDRAWN until it occurs in neither the stamp nor Maria's phone digits
// anywhere but their end.
const MARIA_PHONE_PREFIX_DIGITS = "52899123";
function drawPhoneDigits(): string {
  for (;;) {
    const d = String(1000 + Math.floor(Math.random() * 9000));
    const full = MARIA_PHONE_PREFIX_DIGITS + d;
    if (!String(STAMP).includes(d) && full.indexOf(d) === full.length - d.length) return d;
  }
}
const PHONE_DIGITS = drawPhoneDigits();
const MARIA_PHONE = `+52 899 123 ${PHONE_DIGITS}`;
const MARIA_FIRST = "María";
const MARIA_LAST = "García López";
const MARIA_NAME = `${MARIA_FIRST} ${MARIA_LAST}`;
const INES_FIRST = "Inés";
const INES_LAST = "Peña";
const INES_NAME = `${INES_FIRST} ${INES_LAST}`;
const NONSENSE_TERM = "zzqx";

let accountId = "";
let mariaId = "";
let inesId = "";

test.beforeAll(async () => {
  accountId = fullFixture().accountId;
  const svc = serviceDb();

  const { data: maria, error: mariaErr } = await svc.from("contacts")
    .insert({
      account_id: accountId, first_name: MARIA_FIRST, last_name: MARIA_LAST,
      phone: MARIA_PHONE, email: `search-${STAMP}-maria@example.com`,
    })
    .select("id").single();
  if (mariaErr || !maria) throw new Error(`contacts-search e2e: seeding María failed: ${mariaErr?.message ?? "no row"}`);
  mariaId = (maria as { id: string }).id;

  const { data: ines, error: inesErr } = await svc.from("contacts")
    .insert({
      account_id: accountId, first_name: INES_FIRST, last_name: INES_LAST,
      email: `search-${STAMP}-ines@example.com`,
    })
    .select("id").single();
  if (inesErr || !ines) throw new Error(`contacts-search e2e: seeding Inés failed: ${inesErr?.message ?? "no row"}`);
  inesId = (ines as { id: string }).id;
});

test.afterAll(async () => {
  if (!accountId) return;
  const svc = serviceDb();
  const ids = [mariaId, inesId].filter((id) => id.length > 0);
  if (ids.length === 0) return;
  const result = await deleteContacts(svc, accountId, ids, { serviceDb: svc });
  if (result.deleted !== ids.length) {
    throw new Error(
      `contacts-search e2e cleanup: deleteContacts deleted ${result.deleted} of ${ids.length} ` +
      `(skippedBlocked ${result.skippedBlocked}, skippedFiles ${result.skippedFiles})`,
    );
  }
});

/**
 * The header's real total (contacts-archive.spec.ts's own `readTotal`), read off the page rather than
 * assumed: this spec runs alone, but never against an account presumed empty, since auth.setup.ts's
 * own canary contact ("E2E Fixture …") lives here too.
 */
async function readTotal(page: Page): Promise<number> {
  const text = await page.getByRole("main").getByText(/^\d+ contacts?$/).first().innerText();
  const n = Number(text.match(/\d+/)?.[0]);
  if (Number.isNaN(n)) throw new Error(`readTotal: unreadable header text "${text}"`);
  return n;
}

/** The row for `name`, scoped to `<main>` and to the row's own `data-*` identity — never a bare
 *  page-wide text match, since Next's streamed reveal can park a second, hidden copy of the list
 *  outside `<main>` (support.ts's own documented reason for this convention). */
function rowFor(page: Page, name: string) {
  return page.getByRole("main").locator("[data-contact-row]").filter({ hasText: name });
}

test(
  "search ignores accents, finds a full name in any word order, folds ñ to n, finds a phone by its last " +
  "4 digits, highlights the match in the list and in ⌘K, and offers archived customers when nothing matches",
  async ({ page }) => {
    const base = `/dashboard/accounts/${accountId}/contacts`;

    // --- Step 1: "garcia" (no accent) finds "García" in the list, with the matched letters marked -----
    await page.goto(`${base}?q=garcia`);
    const mariaByGarcia = rowFor(page, MARIA_NAME);
    await expect(mariaByGarcia).toBeVisible();
    await expect(mariaByGarcia.locator("[data-search-hit]").filter({ hasText: "García" })).toBeVisible();
    await expect(rowFor(page, INES_NAME)).toHaveCount(0);

    // --- Step 2: the two words of her full name, typed in the OTHER order, still find exactly her -----
    await page.goto(`${base}?q=${encodeURIComponent("garcia maria")}`);
    await expect(rowFor(page, MARIA_NAME)).toBeVisible();
    await expect.poll(() => readTotal(page)).toBe(1);

    // --- Step 3: "pena" (no ñ) finds "Peña" — the same fold, the other direction -----------------------
    await page.goto(`${base}?q=pena`);
    await expect(rowFor(page, INES_NAME)).toBeVisible();
    await expect(rowFor(page, MARIA_NAME)).toHaveCount(0);

    // --- Step 4: MIN_PHONE_SEARCH_DIGITS digits of her phone find her, with the digits marked ----------
    // Never an exact total here (unlike step 2's "all words present" search): a plain digit term is ALSO
    // a name token (contactSearchPlan folds digits through unchanged), so it can legitimately match any
    // OTHER row whose folded name happens to contain the same four digits somewhere — auth.setup.ts's own
    // canary contact ("E2E Fixture <stamp>") embeds a 13-digit Date.now() stamp of its own, close enough
    // in time to this file's STAMP that a coincidental 4-digit overlap is a real, observed risk, not a
    // theoretical one (first run of this spec hit exactly that: readTotal reported 2, correctly, because
    // the canary's name really did contain these four digits that run). The positive case plus Inés'
    // absence is the same proof without that coincidence: she has no phone and no digits in her name,
    // and her email's only digits are STAMP's, which drawPhoneDigits() never overlaps (final review M-3).
    await page.goto(`${base}?q=${PHONE_DIGITS}`);
    const mariaByPhone = rowFor(page, MARIA_NAME);
    await expect(mariaByPhone).toBeVisible();
    await expect(mariaByPhone.locator("[data-search-hit]").filter({ hasText: PHONE_DIGITS })).toBeVisible();
    await expect(rowFor(page, INES_NAME)).toHaveCount(0);

    // --- Step 5: ⌘K lists her too, with the same mark on "García" ---------------------------------------
    await page.goto(base);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");
    await palette.getByRole("combobox").fill("garcia");
    const hit = palette.getByRole("option", { name: new RegExp(MARIA_NAME, "i") });
    await expect(hit).toBeVisible({ timeout: 15_000 });
    await expect(hit.locator("[data-search-hit]").filter({ hasText: "García" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);

    // --- Step 6: a nonsense term finds nobody, says so by name, and — this session sees the whole ------
    // account — offers a way into the archived customers it never looked at, with no count (spec 6): the
    // link's own href carries this exact query and `view=archived`.
    await page.goto(`${base}?q=${NONSENSE_TERM}`);
    const title = m["contacts.search.noMatch.title"].replace("{query}", NONSENSE_TERM);
    await expect(page.getByRole("main").getByText(title, { exact: true })).toBeVisible();
    const archivedLink = page.getByRole("link", { name: m["contacts.search.lookInArchived"], exact: true });
    await expect(archivedLink).toBeVisible();
    const href = await archivedLink.getAttribute("href");
    expect(href, "the archived-search link carries an href").toBeTruthy();
    const qs = new URLSearchParams(href!.slice(1));
    expect(qs.get("view")).toBe("archived");
    expect(qs.get("q")).toBe(NONSENSE_TERM);
  },
);
