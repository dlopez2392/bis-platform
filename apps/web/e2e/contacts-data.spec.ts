import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb } from "@bis/db";
import { readClientFixture } from "./support";

// Same two paths, same reason, as every other spec that talks to Supabase from
// the Playwright runner process directly rather than through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/** Mirrors contacts/page.tsx. A change there should fail this, loudly. */
const PAGE_SIZE = 50;

/**
 * Enough to need a second page, deliberately not the plan's 120. Every seeded
 * row is re-imported in flow 3, and each one costs a match + an updateContact
 * + a ledger write, so 120 doubles this spec's wall clock to prove nothing 60
 * does not: 60 still renders one FULL page plus a partial second, which is the
 * property the paging flow actually tests.
 */
const SEEDED = 60;

/** The export's column contract (contacts/export/route.ts). */
const CSV_HEADER = "first_name,last_name,email,phone,company_name,source,tags";

const BOM = "\uFEFF";

// One linear journey: flow 2 exports what flow 1 seeded, flow 3 re-imports
// exactly what flow 2 downloaded, and flow 4 measures against the count flow 3
// left behind. Splitting them would mean re-deriving that state per test.
test.describe.configure({ mode: "serial", timeout: 180_000 });

const stamp = Date.now();
const seedEmail = (i: number) => `e2e-import-${stamp}-${i}@example.com`;
const EMAIL_PREFIX = `e2e-import-${stamp}-`;

let accountId = "";
let contactsUrl = "";
let exportedCsv = "";

/** Rows on the account the importer can actually match on. A row with neither
 *  an email nor a phone is rejected by mapRows, so it can never be "updated" —
 *  counting it would make flow 3's expected number wrong. Queried rather than
 *  assumed, because the fixture account is not guaranteed to start empty. */
async function importableCount(): Promise<number> {
  const { count, error } = await serviceDb().from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .or("email.not.is.null,phone.not.is.null");
  if (error) throw new Error(`importableCount failed: ${error.message}`);
  return count ?? 0;
}

async function totalCount(): Promise<number> {
  const { count, error } = await serviceDb().from("contacts")
    .select("id", { count: "exact", head: true }).eq("account_id", accountId);
  if (error) throw new Error(`totalCount failed: ${error.message}`);
  return count ?? 0;
}

test.beforeAll(async () => {
  const fixture = readClientFixture();
  test.skip(!fixture, "No client fixture — the setup project creates it; run the full suite.");
  accountId = fixture!.accountId;
  contactsUrl = `/dashboard/accounts/${accountId}/contacts`;

  const rows = Array.from({ length: SEEDED }, (_, i) => ({
    account_id: accountId,
    first_name: `Seed${i}`,
    last_name: "Import",
    email: seedEmail(i),
  }));
  const { error } = await serviceDb().from("contacts").insert(rows);
  if (error) throw new Error(`seeding failed: ${error.message}`);
});

test.afterAll(async () => {
  if (!accountId) return;
  // The fixture account is torn down after the run, but leaving 60+ rows for
  // that teardown to trip over is not something to rely on.
  await serviceDb().from("contacts").delete()
    .eq("account_id", accountId).like("email", `${EMAIL_PREFIX}%`);
});

test("pages the list without stacking two pagers", async ({ page }) => {
  const total = await totalCount();
  await page.goto(contactsUrl);

  await expect(page.getByText(`${total} contacts`)).toBeVisible();

  // A row is not an anchor — clicking it opens the drawer (DESIGN.md's record
  // pattern), so the contact id on the row is the identity to compare, not an
  // href. `data-contact-row` is the attribute contacts-table.tsx already
  // renders for exactly this kind of addressing.
  const rows = page.locator("[data-contact-row]");
  await expect(rows).toHaveCount(PAGE_SIZE);
  const firstId = await rows.first().getAttribute("data-contact-row");

  await page.getByRole("link", { name: "Older" }).click();
  await expect(page).toHaveURL(/[?&]before=/);
  await expect(rows.first()).not.toHaveAttribute("data-contact-row", firstId!);

  await page.getByRole("link", { name: "Newer" }).click();
  await expect(rows).toHaveCount(PAGE_SIZE);
  await expect(rows.first()).toHaveAttribute("data-contact-row", firstId!);
});

test("exports the whole view as CSV, byte-for-byte importable", async ({ page }) => {
  const total = await totalCount();
  await page.goto(contactsUrl);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Export CSV" }).click(),
  ]);
  exportedCsv = readFileSync(await download.path(), "utf8");

  // Read with fs, NOT Response.text() — fs does not strip the BOM, which is
  // exactly the reader the importer has to survive. If this assertion ever
  // fails, Excel is mangling accented names again.
  expect(exportedCsv.startsWith(BOM)).toBe(true);

  const lines = exportedCsv.slice(BOM.length).split("\n");
  expect(lines[0]).toBe(CSV_HEADER);
  expect(lines.length - 1).toBe(total);
});

test("re-importing our own export adds nobody and loses nothing", async ({ page }) => {
  const before = await totalCount();
  const expectedUpdates = await importableCount();

  await page.goto(`${contactsUrl}/import`);
  // The BOM rides along on purpose: this is the round trip the whole binding
  // exists for. A header of "\uFEFFfirst_name" that matched nothing would
  // silently drop that column and this flow would report additions.
  await page.locator('input[type="file"]').setInputFiles({
    name: "contacts.csv", mimeType: "text/csv", buffer: Buffer.from(exportedCsv, "utf8"),
  });

  await expect(page.getByText(/rows? ready to import/)).toBeVisible();
  await page.getByRole("button", { name: "Import" }).click();

  await expect(page.getByText(`Added 0, updated ${expectedUpdates}.`))
    .toBeVisible({ timeout: 120_000 });
  expect(await totalCount()).toBe(before);
});

/**
 * The operator's actual story: export, fix a cell, re-import. Changing the
 * FIRST column and reading the row back is what makes it an assertion rather
 * than a click-through — a first header that failed to map would show up here
 * as the edit silently not landing, which the round trip above cannot see
 * (it rewrites values identical to what is stored, so a dropped column changes
 * nothing observable and "Added 0" still holds).
 *
 * What this does NOT prove, measured rather than assumed: the BOM binding.
 * The CSV below leads with a BOM because our export does, but PAPAPARSE STRIPS
 * IT — `meta.fields[0]` comes back as "first_name", no BOM — so `autoMap`
 * never sees one on this path. Verified by mutation: breaking header
 * normalization so a BOM survives leaves this whole spec GREEN. The binding is
 * therefore real but unreachable through the shipped product, and csv.test.ts's
 * unit test is the only place it is provable. Do not "strengthen" this flow
 * into claiming otherwise.
 */
test("an edit made in the spreadsheet lands on the contact", async ({ page }) => {
  const target = seedEmail(0);
  const csv = BOM + [CSV_HEADER, `Renamed,Import,${target},,,,`].join("\n");

  await page.goto(`${contactsUrl}/import`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "edited.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8"),
  });
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText("Added 0, updated 1.")).toBeVisible({ timeout: 60_000 });

  const { data, error } = await serviceDb().from("contacts")
    .select("first_name").eq("account_id", accountId).eq("email", target).single();
  if (error) throw new Error(`read-back failed: ${error.message}`);
  expect(data.first_name).toBe("Renamed");
});

test("skips the rows nothing could match and imports the rest", async ({ page }) => {
  const before = await totalCount();
  const csv = [
    CSV_HEADER,
    `Good,One,${EMAIL_PREFIX}good1@example.com,,,,`,
    `Good,Two,${EMAIL_PREFIX}good2@example.com,,,,`,
    "Nameless,Nobody,,,,,",              // neither email nor phone
    "Bad,Email,not-an-email,,,,",        // malformed email
  ].join("\n");

  await page.goto(`${contactsUrl}/import`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "mixed.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8"),
  });

  await expect(page.getByText("2 rows have problems and will be skipped.")).toBeVisible();
  await page.getByRole("button", { name: "Import" }).click();

  await expect(page.getByText("Added 2, updated 0.")).toBeVisible({ timeout: 60_000 });
  expect(await totalCount()).toBe(before + 2);
});
