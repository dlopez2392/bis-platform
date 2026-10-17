import { test, expect, type Page } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { serviceDb } from "@bis/db";
import { m } from "../src/lib/messages";
import { readClientFixture } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * S-06 part 2 (spec "Tests": "add a Never record entry, see it, Undo it"; plan Task 10). As the agency,
 * on Settings' Sending address card, ON THE PER-RUN FIXTURE ACCOUNT ONLY, never Test Client One. Each
 * pattern is stamped; afterAll deletes every row this run could have left (checking the error), then
 * re-reads the table to confirm none is left. Entries are addressed by data-never-log-entry, never by
 * text: the toast repeats the pattern.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

const STAMP = `nr${Date.now()}`;
const ADDED = `${STAMP}-a.example.com`;
const REMOVED = `${STAMP}-b.example.com`;
let accountId = "";
const db = () => serviceDb();
const settings = () => `/dashboard/accounts/${accountId}/settings`;
const list = (page: Page) => page.locator("#sending-address [data-never-log]");
const entry = (page: Page, p: string) => list(page).locator(`[data-never-log-entry="${p}"]`);
const toastWith = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text });
const stored = async (p: string) => {
  const { count, error } = await db().from("inbound_never_log").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("pattern", p);
  expect(error).toBeNull();
  return count;
};

test.beforeAll(() => {
  const fixture = readClientFixture();
  if (!fixture) throw new Error("never-record.spec: no per-run fixture account (e2e/.auth/client-fixture.json). Run the full suite.");
  accountId = fixture.accountId;
});

test.afterAll(async () => {
  if (!accountId) return;
  const { error } = await db().from("inbound_never_log").delete().eq("account_id", accountId).like("pattern", `${STAMP}%`);
  expect(error).toBeNull();
  const { count, error: e2 } = await db().from("inbound_never_log").select("id", { count: "exact", head: true }).eq("account_id", accountId).like("pattern", `${STAMP}%`);
  expect(e2).toBeNull();
  expect(count).toBe(0);
});

async function add(page: Page, pattern: string) {
  await list(page).getByLabel(m["neverLog.inputLabel"]).fill(pattern);
  await list(page).getByRole("button", { name: m["neverLog.add"], exact: true }).click();
}

test("adding an entry shows it at once and stores it; Undo takes it off again", async ({ page }) => {
  await page.goto(settings());
  await add(page, ADDED);
  await expect(entry(page, ADDED)).toHaveCount(1);
  const toast = toastWith(page, m["neverLog.added"].replace("{pattern}", ADDED));
  await expect(toast).toBeVisible();
  expect(await stored(ADDED)).toBe(1);
  await toast.getByRole("button", { name: m["common.undo"] }).click();
  await expect(toastWith(page, m["neverLog.undone"])).toBeVisible();
  await expect(entry(page, ADDED)).toHaveCount(0);
  expect(await stored(ADDED)).toBe(0);
  await page.goto(settings());
  await expect(entry(page, ADDED)).toHaveCount(0);
});

test("a duplicate is refused in words; an invalid entry too; nothing extra is stored", async ({ page }) => {
  await page.goto(settings());
  await add(page, REMOVED);
  await expect(entry(page, REMOVED)).toHaveCount(1);
  await add(page, REMOVED.toUpperCase());
  await expect(list(page).getByRole("alert")).toHaveText(m["neverLog.duplicate"]);
  await add(page, "not a domain");
  await expect(list(page).getByRole("alert")).toHaveText(m["neverLog.invalid"]);
  expect(await stored(REMOVED)).toBe(1);
});

test("removing an entry takes it off at once; Undo puts it back", async ({ page }) => {
  await page.goto(settings());
  await expect(entry(page, REMOVED)).toHaveCount(1);
  await entry(page, REMOVED).getByRole("button", { name: m["neverLog.removeLabel"].replace("{pattern}", REMOVED) }).click();
  await expect(entry(page, REMOVED)).toHaveCount(0);
  const toast = toastWith(page, m["neverLog.removed"].replace("{pattern}", REMOVED));
  await toast.getByRole("button", { name: m["common.undo"] }).click();
  await expect(entry(page, REMOVED)).toHaveCount(1);
  expect(await stored(REMOVED)).toBe(1);
});
